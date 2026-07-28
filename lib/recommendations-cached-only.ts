// @ts-nocheck
// Genre-based recommendations using ONLY cached user data (no external search)
import { getSpotifyClient } from "./spotify";
import fs from "fs/promises";
import path from "path";

export interface RecommendationResult {
  id: string;
  name: string;
  artists: string[];
  albumName: string;
  albumImage: string;
  previewUrl: string | null;
  externalUrl: string;
  addedReason: string;
  matchScore: number;
}

type ProgressCallback = (data: any) => void;

const CACHE_DIR = path.join(process.cwd(), ".cache");

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function setCached<T>(key: string, data: T): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Failed to cache ${key}:`, err);
  }
}

// Fetch user's complete listening history with caching
async function getUserAllTracks(
  accessToken: string,
  onProgress: ProgressCallback
): Promise<any[]> {
  const cacheKey = "user-all-tracks";
  const cached = await getCached<any[]>(cacheKey);
  if (cached) {
    console.log(`[getUserAllTracks] Using cached data: ${cached.length} tracks`);
    onProgress({
      stage: "fetching_history",
      progress: 20,
      message: `Loaded ${cached.length} tracks from cache`,
    });
    return cached;
  }

  const spotify = getSpotifyClient(accessToken);
  const allTracks: any[] = [];
  const seen = new Set<string>();

  onProgress({ stage: "fetching_history", progress: 5, message: "Fetching your top tracks..." });

  const [short, medium, long] = await Promise.allSettled([
    spotify.getMyTopTracks({ limit: 50, time_range: "short_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "medium_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "long_term" }),
  ]);

  const addTracks = (items: any[]) => {
    for (const track of items) {
      if (!seen.has(track.id)) {
        seen.add(track.id);
        allTracks.push(track);
      }
    }
  };

  if (short.status === "fulfilled") addTracks(short.value.body.items);
  if (medium.status === "fulfilled") addTracks(medium.value.body.items);
  if (long.status === "fulfilled") addTracks(long.value.body.items);

  onProgress({
    stage: "fetching_history",
    progress: 10,
    message: `Found ${allTracks.length} top tracks. Fetching recently played...`,
  });

  try {
    const recent = await spotify.getMyRecentlyPlayedTracks({ limit: 50 });
    for (const item of recent.body.items) {
      if (!seen.has(item.track.id)) {
        seen.add(item.track.id);
        allTracks.push(item.track);
      }
    }
  } catch (err) {
    console.error("Failed to fetch recent tracks:", err);
  }

  onProgress({
    stage: "fetching_history",
    progress: 15,
    message: `${allTracks.length} tracks so far. Fetching saved tracks...`,
  });

  let offset = 0;
  const savedLimit = 50;
  let hasMore = true;

  while (hasMore && offset < 500) {
    try {
      const saved = await spotify.getMySavedTracks({ limit: savedLimit, offset });
      const items = saved.body.items;

      for (const item of items) {
        if (!seen.has(item.track.id)) {
          seen.add(item.track.id);
          allTracks.push(item.track);
        }
      }

      hasMore = items.length === savedLimit;
      offset += savedLimit;
    } catch (err) {
      console.error("Failed to fetch saved tracks:", err);
      break;
    }
  }

  await setCached(cacheKey, allTracks);
  return allTracks;
}

async function getHeardTrackIds(accessToken: string, allTracks: any[]): Promise<Set<string>> {
  const heard = new Set<string>();
  for (const track of allTracks) {
    heard.add(track.id);
  }
  return heard;
}

// Extract genres from user's tracks (using cached artist data)
async function extractGenres(
  accessToken: string,
  tracks: any[],
  onProgress: ProgressCallback
): Promise<Map<string, string[]>> {
  const cacheKey = "artist-genres-simple";
  const cached = await getCached<Record<string, string[]>>(cacheKey);
  if (cached) {
    const genreMap = new Map(Object.entries(cached));
    console.log(`[extractGenres] Using cached data: ${genreMap.size} artists`);
    onProgress({
      stage: "analyzing_metadata",
      progress: 30,
      message: `Loaded genres for ${genreMap.size} artists from cache`,
    });
    return genreMap;
  }

  const spotify = getSpotifyClient(accessToken);
  const genreMap = new Map<string, string[]>();

  const artistIds = Array.from(
    new Set(tracks.flatMap((t) => t.artists.map((a: any) => a.id)))
  );

  console.log(`[extractGenres] Fetching genres for ${artistIds.length} unique artists`);
  onProgress({
    stage: "analyzing_metadata",
    progress: 25,
    message: `Fetching genres for ${artistIds.length} artists...`,
  });

  const batchSize = 50;
  for (let i = 0; i < artistIds.length; i += batchSize) {
    const batch = artistIds.slice(i, i + batchSize);
    try {
      const response = await spotify.getArtists(batch);
      for (const artist of response.body.artists) {
        if (artist && artist.genres && artist.genres.length > 0) {
          genreMap.set(artist.id, artist.genres);
        }
      }

      const progress = 25 + ((i + batch.length) / artistIds.length) * 15;
      onProgress({
        stage: "analyzing_metadata",
        progress: Math.min(40, progress),
        message: `Fetched genres for ${i + batch.length}/${artistIds.length} artists...`,
      });
    } catch (err: any) {
      console.error(`[extractGenres] Failed batch:`, err?.message);
    }
  }

  const genreMapObj = Object.fromEntries(genreMap);
  await setCached(cacheKey, genreMapObj);

  console.log(`[extractGenres] Found genres for ${genreMap.size} out of ${artistIds.length} artists`);
  return genreMap;
}

// Build profile and generate recommendations from user's OWN tracks
// Strategy: Find tracks in your library that share genres but you listen to less
export async function getPersonalizedRecommendationsWithProgress(
  accessToken: string,
  options: { limit?: number } = {},
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  const { limit = 30 } = options;

  console.log(`[MAIN] Starting genre-only recommendation (cached data)`);

  onProgress({ stage: "initializing", progress: 0, message: "Starting recommendation engine..." });

  // Step 1: Get all tracks
  const allTracks = await getUserAllTracks(accessToken, onProgress);
  if (allTracks.length === 0) {
    throw new Error("No listening history found. Play some music on Spotify first.");
  }

  console.log(`[MAIN] Got ${allTracks.length} tracks from history`);

  const heardIds = await getHeardTrackIds(accessToken, allTracks);

  // Step 2: Get genres
  const genreMap = await extractGenres(accessToken, allTracks, onProgress);
  if (genreMap.size === 0) {
    throw new Error("Could not extract genre information. This is needed for recommendations.");
  }

  onProgress({
    stage: "building_profile",
    progress: 45,
    message: "Analyzing your taste profile...",
  });

  // Step 3: Build genre frequency map
  const genreFreq = new Map<string, number>();
  const trackGenres = new Map<string, string[]>();

  for (const track of allTracks) {
    const genres: string[] = [];
    for (const artist of track.artists) {
      const artistGenres = genreMap.get(artist.id) || [];
      genres.push(...artistGenres);
    }

    const uniqueGenres = Array.from(new Set(genres));
    trackGenres.set(track.id, uniqueGenres);

    for (const genre of uniqueGenres) {
      genreFreq.set(genre, (genreFreq.get(genre) || 0) + 1);
    }
  }

  const topGenres = Array.from(genreFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([g]) => g);

  console.log(`[MAIN] Top genres:`, topGenres.slice(0, 5));

  onProgress({
    stage: "searching_candidates",
    progress: 55,
    message: `Finding underplayed tracks with your favorite genres...`,
  });

  // Step 4: Score all tracks by genre match + inverse popularity (underplayed gems)
  const scored: RecommendationResult[] = [];

  for (const track of allTracks) {
    const genres = trackGenres.get(track.id) || [];
    if (genres.length === 0) continue;

    // Genre match score
    let genreScore = 0;
    for (const genre of genres) {
      const freq = genreFreq.get(genre) || 0;
      if (topGenres.includes(genre)) {
        genreScore += 1;
      }
    }

    if (genreScore === 0) continue;

    // Popularity penalty (favor underplayed)
    const popularity = track.popularity || 50;
    const popularityPenalty = (100 - popularity) / 100; // Higher score for lower popularity

    const finalScore = genreScore * (1 + popularityPenalty);

    // Get primary genre
    const primaryGenre = genres[0] || "music";

    scored.push({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a: any) => a.name),
      albumName: track.album?.name || "",
      albumImage: track.album?.images?.[0]?.url || "",
      previewUrl: track.preview_url || null,
      externalUrl: track.external_urls?.spotify || "",
      addedReason: `${Math.round((genreScore / topGenres.length) * 100)}% genre match · ${primaryGenre}`,
      matchScore: finalScore,
    });
  }

  onProgress({
    stage: "scoring",
    progress: 80,
    message: `Scored ${scored.length} tracks, selecting top ${limit}...`,
  });

  // Sort by score and return top N
  scored.sort((a, b) => b.matchScore - a.matchScore);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: `Returning top ${limit} recommendations...`,
  });

  return scored.slice(0, limit);
}