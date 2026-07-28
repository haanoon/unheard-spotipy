// @ts-nocheck
// Fallback recommendations using ONLY track metadata (no genres needed)
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

// Build artist frequency map (collaborative filtering lite)
function buildArtistFrequency(tracks: any[]): Map<string, number> {
  const artistFreq = new Map<string, number>();

  for (const track of tracks) {
    for (const artist of track.artists) {
      artistFreq.set(artist.id, (artistFreq.get(artist.id) || 0) + 1);
    }
  }

  return artistFreq;
}

// Recommendation strategy: Find tracks from your MOST-played artists that you haven't listened to much
export async function getPersonalizedRecommendationsWithProgress(
  accessToken: string,
  options: { limit?: number } = {},
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  const { limit = 30 } = options;

  console.log(`[MAIN] Starting fallback recommendation (no genres needed)`);

  onProgress({ stage: "initializing", progress: 0, message: "Starting recommendation engine..." });

  // Step 1: Get all tracks
  const allTracks = await getUserAllTracks(accessToken, onProgress);
  if (allTracks.length === 0) {
    throw new Error("No listening history found. Play some music on Spotify first.");
  }

  console.log(`[MAIN] Got ${allTracks.length} tracks from history`);

  onProgress({
    stage: "analyzing_patterns",
    progress: 30,
    message: "Analyzing your listening patterns...",
  });

  // Step 2: Build artist frequency (who you listen to most)
  const artistFreq = buildArtistFrequency(allTracks);

  // Get top artists (most played)
  const topArtists = Array.from(artistFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);

  console.log(`[MAIN] Top ${topArtists.length} artists identified`);

  onProgress({
    stage: "building_profile",
    progress: 45,
    message: `Analyzing tracks from your top ${topArtists.length} favorite artists...`,
  });

  // Step 3: Score tracks
  // Strategy: tracks from your top artists that have LOW popularity = hidden gems
  const scored: RecommendationResult[] = [];

  for (const track of allTracks) {
    // Check if track is from one of your top artists
    let isTopArtist = false;
    for (const artist of track.artists) {
      if (topArtists.includes(artist.id)) {
        isTopArtist = true;
        break;
      }
    }

    if (!isTopArtist) continue;

    const popularity = track.popularity || 50;

    // Score = inverse popularity (lower popularity = higher score = hidden gem)
    const hiddenGemScore = 100 - popularity;

    // Bonus for older tracks (classics you might have missed)
    const releaseDate = track.album?.release_date || "";
    const releaseYear = releaseDate ? parseInt(releaseDate.substring(0, 4)) : new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const ageBonus = Math.max(0, (currentYear - releaseYear) / 10); // Up to 1.0 bonus per decade

    const finalScore = hiddenGemScore + (ageBonus * 10);

    scored.push({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a: any) => a.name),
      albumName: track.album?.name || "",
      albumImage: track.album?.images?.[0]?.url || "",
      previewUrl: track.preview_url || null,
      externalUrl: track.external_urls?.spotify || "",
      addedReason: `Hidden gem from ${track.artists[0].name} (${releaseYear})`,
      matchScore: finalScore,
    });
  }

  if (scored.length === 0) {
    throw new Error("Could not find any recommendations. Try listening to more music on Spotify.");
  }

  onProgress({
    stage: "scoring",
    progress: 80,
    message: `Found ${scored.length} potential hidden gems...`,
  });

  // Sort by score and return top N
  scored.sort((a, b) => b.matchScore - a.matchScore);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: `Selecting top ${limit} recommendations...`,
  });

  console.log(`[MAIN] Returning ${Math.min(limit, scored.length)} recommendations`);

  return scored.slice(0, limit);
}