// @ts-nocheck
import { getSpotifyClient } from "./spotify";
import { getCached, setCache } from "./cache";

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

interface TrackMetadata {
  id: string;
  name: string;
  popularity: number;
  releaseYear: number;
  genres: string[];
  artists: string[];
}

interface UserProfile {
  genres: Map<string, number>; // genre -> frequency
  topGenres: string[];
  avgPopularity: number;
  popularityStdDev: number;
  yearRange: { min: number; max: number };
  avgYear: number;
  trackCount: number;
}

type ProgressCallback = (data: any) => void;

// Fetch complete listening history
async function getUserAllTracks(
  accessToken: string,
  onProgress: ProgressCallback
): Promise<any[]> {
  const cacheKey = 'user-all-tracks';
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

      if (offset % 100 === 0) {
        onProgress({
          stage: "fetching_history",
          progress: 15 + Math.min(10, (offset / 500) * 10),
          message: `Fetched ${allTracks.length} tracks from your library...`,
        });
      }
    } catch (err) {
      console.error("Failed to fetch saved tracks:", err);
      break;
    }
  }

  await setCache(cacheKey, allTracks);
  return allTracks;
}

async function getHeardTrackIds(accessToken: string, allTracks: any[]): Promise<Set<string>> {
  const heard = new Set<string>();
  for (const track of allTracks) {
    heard.add(track.id);
  }
  return heard;
}

// Extract genres from artists
async function extractGenres(
  accessToken: string,
  tracks: any[],
  onProgress: ProgressCallback
): Promise<Map<string, string[]>> {
  const cacheKey = 'artist-genres-v2';
  const cached = await getCached<Record<string, string[]>>(cacheKey);
  if (cached) {
    const genreMap = new Map(Object.entries(cached));
    console.log(`[extractGenres] Using cached data: ${genreMap.size} artists`);
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

  console.log(`[extractGenres] Found genres for ${genreMap.size} out of ${artistIds.length} artists`);

  const cacheData = Object.fromEntries(genreMap.entries());
  await setCache(cacheKey, cacheData);

  return genreMap;
}

// Build track metadata with genres, popularity, release year
function buildTrackMetadata(
  tracks: any[],
  genreMap: Map<string, string[]>
): TrackMetadata[] {
  const metadata: TrackMetadata[] = [];

  for (const track of tracks) {
    const genres: string[] = [];
    for (const artist of track.artists) {
      const artistGenres = genreMap.get(artist.id) || [];
      genres.push(...artistGenres);
    }

    const releaseDate = track.album?.release_date || "";
    const releaseYear = releaseDate ? parseInt(releaseDate.substring(0, 4)) : new Date().getFullYear();

    metadata.push({
      id: track.id,
      name: track.name,
      popularity: track.popularity || 50,
      releaseYear,
      genres: Array.from(new Set(genres)), // deduplicate
      artists: track.artists.map((a: any) => a.name),
    });
  }

  return metadata;
}

// Build user taste profile from metadata
function buildUserProfile(metadata: TrackMetadata[]): UserProfile {
  console.log(`[buildUserProfile] Building profile from ${metadata.length} tracks`);

  const genreFreq = new Map<string, number>();
  const popularities: number[] = [];
  const years: number[] = [];

  for (const track of metadata) {
    for (const genre of track.genres) {
      genreFreq.set(genre, (genreFreq.get(genre) || 0) + 1);
    }
    popularities.push(track.popularity);
    years.push(track.releaseYear);
  }

  // Calculate popularity stats
  const avgPopularity = popularities.reduce((a, b) => a + b, 0) / popularities.length;
  const popVariance =
    popularities.reduce((sum, val) => sum + Math.pow(val - avgPopularity, 2), 0) / popularities.length;
  const popularityStdDev = Math.sqrt(popVariance);

  // Calculate year stats
  const avgYear = years.reduce((a, b) => a + b, 0) / years.length;
  const yearRange = { min: Math.min(...years), max: Math.max(...years) };

  // Top genres
  const topGenres = Array.from(genreFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([genre]) => genre);

  console.log(`[buildUserProfile] Profile built:`);
  console.log(`  - ${genreFreq.size} unique genres`);
  console.log(`  - Top 5 genres: ${topGenres.slice(0, 5).join(", ")}`);
  console.log(`  - Avg popularity: ${avgPopularity.toFixed(1)}`);
  console.log(`  - Avg year: ${avgYear.toFixed(0)}`);

  return {
    genres: genreFreq,
    topGenres,
    avgPopularity,
    popularityStdDev,
    yearRange,
    avgYear,
    trackCount: metadata.length,
  };
}

// Generate candidates from Spotify catalog
async function getCandidateTracks(
  accessToken: string,
  profile: UserProfile,
  heardIds: Set<string>,
  onProgress: ProgressCallback
): Promise<any[]> {
  const spotify = getSpotifyClient(accessToken);
  const candidates: any[] = [];
  const seen = new Set<string>(heardIds);

  onProgress({
    stage: "searching_candidates",
    progress: 45,
    message: `Searching for candidates across ${profile.topGenres.length} genres...`,
  });

  const genresToSearch = profile.topGenres.slice(0, 15);
  const markets = ["US", "GB", "JP", "KR", "BR", "IN", "MX", "DE", "FR", "SE", "NG", "TR"];

  let processed = 0;
  const totalSearches = genresToSearch.length + markets.length;

  for (const genre of genresToSearch) {
    try {
      const response = await spotify.searchTracks(`genre:"${genre}"`, {
        limit: 25,
        market: "from_token",
      });

      for (const track of response.body.tracks?.items || []) {
        if (!seen.has(track.id) && track.id) {
          seen.add(track.id);
          candidates.push(track);
        }
      }

      processed++;
      onProgress({
        stage: "searching_candidates",
        progress: 45 + (processed / totalSearches) * 20,
        message: `Found ${candidates.length} candidates so far...`,
      });
    } catch (err) {
      console.error(`Search failed for genre: ${genre}`);
    }
  }

  for (const market of markets) {
    try {
      const searchGenre = genresToSearch[0] || "pop";
      const response = await spotify.searchTracks(`genre:"${searchGenre}"`, {
        limit: 15,
        market,
      });

      for (const track of response.body.tracks?.items || []) {
        if (!seen.has(track.id) && track.id) {
          seen.add(track.id);
          candidates.push(track);
        }
      }

      processed++;
      onProgress({
        stage: "searching_candidates",
        progress: 45 + (processed / totalSearches) * 20,
        message: `Searching ${market} market... (${candidates.length} candidates)`,
      });
    } catch (err) {
      console.error(`Search failed for market: ${market}`);
    }
  }

  return candidates;
}

// Score candidates based on genre overlap, popularity, and release year
async function scoreCandidates(
  accessToken: string,
  candidates: any[],
  profile: UserProfile,
  genreMap: Map<string, string[]>,
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  onProgress({
    stage: "scoring",
    progress: 70,
    message: `Scoring ${candidates.length} candidates...`,
  });

  const candidateMetadata = buildTrackMetadata(candidates, genreMap);

  onProgress({
    stage: "scoring",
    progress: 80,
    message: "Computing similarity scores...",
  });

  const scored: RecommendationResult[] = [];

  for (let i = 0; i < candidateMetadata.length; i++) {
    const meta = candidateMetadata[i];
    const track = candidates[i];

    // Genre overlap score
    let genreScore = 0;
    for (const genre of meta.genres) {
      const userFreq = profile.genres.get(genre) || 0;
      genreScore += userFreq / profile.trackCount;
    }
    genreScore = Math.min(genreScore, 1.0);

    // Popularity score (closer to user's average = better)
    const popDiff = Math.abs(meta.popularity - profile.avgPopularity);
    const popScore = 1 / (1 + popDiff / profile.popularityStdDev);

    // Year score (prefer within user's range)
    let yearScore = 1.0;
    if (meta.releaseYear < profile.yearRange.min - 5) {
      yearScore = 0.6;
    } else if (meta.releaseYear > profile.yearRange.max + 2) {
      yearScore = 0.8;
    }

    // Combined score (weighted)
    const finalScore = genreScore * 0.7 + popScore * 0.2 + yearScore * 0.1;

    if (finalScore > 0.1) {
      // Only include tracks with some relevance
      const primaryGenre = meta.genres[0] || "music";
      scored.push({
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        albumName: track.album?.name || "",
        albumImage: track.album?.images?.[0]?.url || "",
        previewUrl: track.preview_url || null,
        externalUrl: track.external_urls?.spotify || "",
        addedReason: `${Math.round(finalScore * 100)}% match · ${primaryGenre}`,
        matchScore: finalScore,
      });
    }
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);

  return scored;
}

// Main export with progress tracking
export async function getPersonalizedRecommendationsWithProgress(
  accessToken: string,
  options: { limit?: number } = {},
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  const { limit = 30 } = options;

  console.log(`[MAIN] ========== Starting recommendation generation (Genre-based) ==========`);

  onProgress({ stage: "initializing", progress: 0, message: "Starting recommendation engine..." });

  const allTracks = await getUserAllTracks(accessToken, onProgress);

  if (allTracks.length === 0) {
    throw new Error("No listening history found. Play some music on Spotify first.");
  }

  onProgress({
    stage: "fetching_history",
    progress: 20,
    message: `Collected ${allTracks.length} tracks from your complete history`,
  });

  const heardIds = await getHeardTrackIds(accessToken, allTracks);
  console.log(`[MAIN] Total heard IDs: ${heardIds.size}`);

  const genreMap = await extractGenres(accessToken, allTracks, onProgress);
  console.log(`[MAIN] Got genres for ${genreMap.size} artists`);

  onProgress({
    stage: "building_profile",
    progress: 42,
    message: "Building your taste profile...",
  });

  const metadata = buildTrackMetadata(allTracks, genreMap);
  const profile = buildUserProfile(metadata);

  onProgress({
    stage: "building_profile",
    progress: 44,
    message: `Profile complete: ${profile.trackCount} tracks, ${profile.topGenres.length} genres`,
  });

  const candidates = await getCandidateTracks(accessToken, profile, heardIds, onProgress);

  if (candidates.length === 0) {
    throw new Error("Could not find any candidate tracks. Try again in a moment.");
  }

  const scored = await scoreCandidates(accessToken, candidates, profile, genreMap, onProgress);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: `Selecting top ${limit} recommendations...`,
  });

  return scored.slice(0, limit);
}