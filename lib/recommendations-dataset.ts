// K-Means clustering recommendation engine with dataset
import { kMeans, cosineSimilarity, Vector } from "./kmeans";
import { getSpotifyClient } from "./spotify";
import { saveTracks, saveRecommendations, saveListeningHistory } from "./db-sync";
import fs from "fs/promises";
import path from "path";
import { parse } from "csv-parse/sync";

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

// Configurable weights for audio features
export const FEATURE_WEIGHTS = {
  danceability: 1.5,
  energy: 1.5,
  valence: 1.2,
  acousticness: 1.0,
  instrumentalness: 0.8,
  speechiness: 0.5,
  liveness: 0.7,
  tempo: 0.6, // Normalized tempo
};

// Configurable popularity filter
export const POPULARITY_FILTER = {
  min: 30,
  max: 80,
};

type ProgressCallback = (data: any) => void;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const DATASET_PATH = path.join(process.cwd(), "dataset", "spotify-tracks.csv");

interface DatasetTrack {
  track_id: string;
  artists: string;
  album_name: string;
  track_name: string;
  popularity: number;
  danceability: number;
  energy: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  tempo: number;
  track_genre: string;
}

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

// Load and parse dataset CSV
async function loadDataset(onProgress?: ProgressCallback): Promise<DatasetTrack[]> {
  const cacheKey = "dataset-parsed";
  const cached = await getCached<DatasetTrack[]>(cacheKey);
  if (cached) {
    console.log(`[loadDataset] Using cached dataset: ${cached.length} tracks`);
    onProgress?.({
      stage: "loading_dataset",
      progress: 5,
      message: `Loaded ${cached.length} tracks from cache`,
    });
    return cached;
  }

  onProgress?.({
    stage: "loading_dataset",
    progress: 2,
    message: "Parsing dataset CSV...",
  });

  const csvContent = await fs.readFile(DATASET_PATH, "utf-8");

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true, // Allow varying column counts
    cast: (value, context) => {
      // Cast numeric columns
      if (context.column === 'popularity' ||
          context.column === 'danceability' ||
          context.column === 'energy' ||
          context.column === 'valence' ||
          context.column === 'acousticness' ||
          context.column === 'instrumentalness' ||
          context.column === 'speechiness' ||
          context.column === 'liveness' ||
          context.column === 'tempo') {
        return parseFloat(value);
      }
      return value;
    }
  }) as DatasetTrack[];

  await setCached(cacheKey, records);

  console.log(`[loadDataset] Parsed ${records.length} tracks from CSV`);
  return records;
}

// Fetch user's listening history (NO CACHE - always fresh)
async function getUserTracks(accessToken: string, onProgress: ProgressCallback): Promise<any[]> {
  const spotify = getSpotifyClient(accessToken);
  const allTracks: any[] = [];
  const seen = new Set<string>();

  onProgress({ stage: "fetching_history", progress: 5, message: "Fetching your listening history..." });

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
    message: `${allTracks.length} tracks collected. Fetching saved tracks...`,
  });

  // Fetch saved tracks
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
          progress: 15 + Math.min(5, (offset / 500) * 5),
          message: `Collected ${allTracks.length} tracks from your library...`,
        });
      }
    } catch (err) {
      console.error("Failed to fetch saved tracks:", err);
      break;
    }
  }

  console.log(`[getUserTracks] Fetched ${allTracks.length} tracks (NO CACHE)`);
  return allTracks;
}

// Match user tracks to dataset by artist + track name (fuzzy)
function matchTracksToDataset(
  userTracks: any[],
  dataset: DatasetTrack[]
): Map<string, DatasetTrack> {
  const matched = new Map<string, DatasetTrack>();

  // Build lookup map for fast matching
  const datasetMap = new Map<string, DatasetTrack>();
  for (const track of dataset) {
    const key = `${track.artists.toLowerCase()}|${track.track_name.toLowerCase()}`;
    datasetMap.set(key, track);
  }

  for (const userTrack of userTracks) {
    const artistNames = userTrack.artists.map((a: any) => a.name.toLowerCase()).join(" ");
    const trackName = userTrack.name.toLowerCase();

    // Try exact match first
    const key = `${artistNames}|${trackName}`;
    if (datasetMap.has(key)) {
      matched.set(userTrack.id, datasetMap.get(key)!);
      continue;
    }

    // Try matching with first artist only
    const firstArtist = userTrack.artists[0]?.name.toLowerCase();
    const key2 = `${firstArtist}|${trackName}`;
    if (datasetMap.has(key2)) {
      matched.set(userTrack.id, datasetMap.get(key2)!);
      continue;
    }

    // Try fuzzy match (contains)
    for (const [datasetKey, datasetTrack] of datasetMap.entries()) {
      const [datasetArtist, datasetName] = datasetKey.split("|");

      // Check if artist and track name are similar
      if (datasetArtist.includes(firstArtist) || firstArtist.includes(datasetArtist)) {
        if (datasetName.includes(trackName.substring(0, 10)) ||
            trackName.includes(datasetName.substring(0, 10))) {
          matched.set(userTrack.id, datasetTrack);
          break;
        }
      }
    }
  }

  return matched;
}

// Build feature vector from track with weighted features
function buildFeatureVector(track: DatasetTrack): Vector {
  // Normalize tempo to 0-1 range (assuming tempo range 50-200)
  const normalizedTempo = (track.tempo - 50) / 150;

  return [
    track.danceability * FEATURE_WEIGHTS.danceability,
    track.energy * FEATURE_WEIGHTS.energy,
    track.valence * FEATURE_WEIGHTS.valence,
    track.acousticness * FEATURE_WEIGHTS.acousticness,
    track.instrumentalness * FEATURE_WEIGHTS.instrumentalness,
    track.speechiness * FEATURE_WEIGHTS.speechiness,
    track.liveness * FEATURE_WEIGHTS.liveness,
    Math.max(0, Math.min(1, normalizedTempo)) * FEATURE_WEIGHTS.tempo,
  ];
}

// Fetch album images and preview URLs from Spotify for final recommendations
async function enrichWithSpotifyData(
  accessToken: string,
  trackIds: string[],
  onProgress?: ProgressCallback
): Promise<Map<string, { albumImage: string; previewUrl: string | null }>> {
  const spotify = getSpotifyClient(accessToken);
  const enrichedData = new Map<string, { albumImage: string; previewUrl: string | null }>();

  onProgress?.({
    stage: "fetching_images",
    progress: 90,
    message: "Fetching album artwork from Spotify...",
  });

  // Spotify allows up to 50 tracks per request
  const batchSize = 50;
  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);

    try {
      const response = await spotify.getTracks(batch);

      for (const track of response.body.tracks) {
        if (track) {
          enrichedData.set(track.id, {
            albumImage: track.album?.images?.[0]?.url || "",
            previewUrl: track.preview_url || null,
          });
        }
      }
    } catch (err: any) {
      console.error(`[enrichWithSpotifyData] Failed to fetch batch:`, err?.message);
      // Continue with other batches even if one fails
    }
  }

  console.log(`[enrichWithSpotifyData] Enriched ${enrichedData.size} out of ${trackIds.length} tracks`);
  return enrichedData;
}

// Main recommendation function
export async function getPersonalizedRecommendationsWithProgress(
  accessToken: string,
  options: { limit?: number; userId?: string } = {},
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  const { limit = 30 } = options;

  console.log(`[MAIN] Starting K-Means dataset-based recommendations`);

  onProgress({ stage: "initializing", progress: 0, message: "Starting recommendation engine..." });

  // Step 1: Load dataset
  const dataset = await loadDataset(onProgress);
  console.log(`[MAIN] Dataset loaded: ${dataset.length} tracks`);

  onProgress({
    stage: "loading_dataset",
    progress: 10,
    message: `Loaded ${dataset.length} tracks from dataset`,
  });

  // Step 2: Load user's listening history (FRESH - no cache)
  const userTracks = await getUserTracks(accessToken, onProgress);
  console.log(`[MAIN] User has ${userTracks.length} tracks in history`);

  // Send user's tracks to frontend for display during analysis
  onProgress({
    stage: "fetching_history",
    progress: 20,
    message: `Collected ${userTracks.length} tracks from your complete history`,
    userTracks: userTracks.slice(0, 20).map(t => ({
      name: t.name,
      artists: t.artists.map((a: any) => a.name).join(", "),
      albumImage: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || "",
    })),
  });

  onProgress({
    stage: "matching_tracks",
    progress: 25,
    message: `Analyzing your listening patterns...`,
  });

  // Step 3: Match user tracks to dataset
  const matchedTracks = matchTracksToDataset(userTracks, dataset);
  console.log(`[MAIN] Matched ${matchedTracks.size} out of ${userTracks.length} user tracks`);

  if (matchedTracks.size < 10) {
    throw new Error(`Only matched ${matchedTracks.size} tracks to dataset. Need at least 10 for clustering.`);
  }

  onProgress({
    stage: "matching_tracks",
    progress: 20,
    message: `Matched ${matchedTracks.size} tracks with audio features`,
  });

  // Step 4: Build feature vectors for matched tracks
  const userFeatureVectors: Vector[] = [];
  for (const datasetTrack of matchedTracks.values()) {
    userFeatureVectors.push(buildFeatureVector(datasetTrack));
  }

  onProgress({
    stage: "clustering",
    progress: 25,
    message: "Running K-Means clustering (k=4) on your taste...",
  });

  // Step 5: Run K-Means clustering (k=4)
  const k = 4;
  const { centroids, assignments } = kMeans(userFeatureVectors, k);

  console.log(`[MAIN] K-Means complete: ${k} clusters found`);
  console.log(`[MAIN] Cluster sizes:`,
    Array.from({ length: k }, (_, i) => assignments.filter(a => a === i).length)
  );

  onProgress({
    stage: "clustering",
    progress: 35,
    message: `Found ${k} distinct taste modes in your listening history`,
  });

  // Step 6: Filter dataset - remove heard tracks + apply popularity filter
  const heardIds = new Set(userTracks.map(t => t.id));
  const heardTrackNames = new Set(
    Array.from(matchedTracks.values()).map(t => `${t.artists}|${t.track_name}`.toLowerCase())
  );

  const candidates = dataset.filter(track => {
    const trackKey = `${track.artists}|${track.track_name}`.toLowerCase();
    const isHeard = heardTrackNames.has(trackKey);
    const inPopularityRange =
      track.popularity >= POPULARITY_FILTER.min &&
      track.popularity <= POPULARITY_FILTER.max;

    return !isHeard && inPopularityRange;
  });

  console.log(`[MAIN] Candidates after filtering: ${candidates.length}`);

  onProgress({
    stage: "scoring",
    progress: 45,
    message: `Scoring ${candidates.length} unheard tracks...`,
  });

  // Step 7: Score each candidate against all centroids
  const scored: Array<{ track: DatasetTrack; score: number; cluster: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateVector = buildFeatureVector(candidate);

    // Find best matching cluster
    let bestScore = -Infinity;
    let bestCluster = 0;

    for (let c = 0; c < centroids.length; c++) {
      const similarity = cosineSimilarity(candidateVector, centroids[c]);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestCluster = c;
      }
    }

    scored.push({
      track: candidate,
      score: bestScore,
      cluster: bestCluster,
    });

    // Update progress every 10K tracks
    if (i % 10000 === 0 && i > 0) {
      const progress = 45 + (i / candidates.length) * 40;
      onProgress({
        stage: "scoring",
        progress: Math.min(85, progress),
        message: `Scored ${i}/${candidates.length} tracks...`,
      });
    }
  }

  onProgress({
    stage: "scoring",
    progress: 85,
    message: "Sorting by best matches...",
  });

  // Step 8: Sort by score and return top N
  scored.sort((a, b) => b.score - a.score);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: `Selecting top ${limit} recommendations...`,
  });

  // Deduplicate by track_id (dataset might have duplicates)
  const seen = new Set<string>();
  const deduplicated: typeof scored = [];

  for (const item of scored) {
    if (!seen.has(item.track.track_id) && item.track.track_id) {
      seen.add(item.track.track_id);
      deduplicated.push(item);

      if (deduplicated.length >= limit) {
        break;
      }
    }
  }

// Fetch album images using Spotify's public OEmbed API (no auth required)
async function fetchSpotifyAlbumArtwork(
  accessToken: string,
  trackIds: string[],
  onProgress: ProgressCallback
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();

  console.log(`[fetchSpotifyAlbumArtwork] Fetching artwork for ${trackIds.length} tracks using OEmbed API`);

  // Use Spotify's public OEmbed API which doesn't require authentication
  // Process in batches to avoid overwhelming the API
  const batchSize = 10;

  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);

    // Fetch all tracks in the batch concurrently
    const fetchPromises = batch.map(async (trackId) => {
      try {
        const response = await fetch(
          `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
          {
            headers: { 'Accept': 'application/json' },
          }
        );

        if (response.ok) {
          const data = await response.json();
          // OEmbed returns thumbnail_url with the album artwork
          if (data.thumbnail_url) {
            imageMap.set(trackId, data.thumbnail_url);
          }
        }
      } catch (err) {
        // Silently fail for individual tracks - they'll use fallback avatars
      }
    });

    await Promise.all(fetchPromises);

    const progress = 95 + ((i + batch.length) / trackIds.length) * 4;
    onProgress({
      stage: "finalizing",
      progress: Math.min(99, progress),
      message: `Loading album artwork ${Math.min(i + batch.length, trackIds.length)}/${trackIds.length}...`,
    });
  }

  console.log(`[fetchSpotifyAlbumArtwork] Successfully fetched ${imageMap.size} images out of ${trackIds.length} tracks`);
  return imageMap;
}

  // Step 9: Fetch album artwork using OEmbed API (public, no auth required)
  const trackIds = deduplicated.map(item => item.track.track_id);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: "Fetching album artwork...",
  });

  const albumImages = await fetchSpotifyAlbumArtwork(accessToken, trackIds, onProgress);

  const results: RecommendationResult[] = deduplicated.map((item) => {
    const track = item.track;

    // Use fetched image or fallback to letter avatar
    const albumImage = albumImages.get(track.track_id) ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(track.track_name.substring(0, 2))}&background=1DB954&color=fff&size=300&bold=true`;

    return {
      id: track.track_id,
      name: track.track_name,
      artists: track.artists.split(";").map(a => a.trim()),
      albumName: track.album_name,
      albumImage: albumImage,
      previewUrl: null,
      externalUrl: `https://open.spotify.com/track/${track.track_id}`,
      addedReason: `${Math.round(item.score * 100)}% match · Cluster ${item.cluster + 1} · ${track.track_genre}`,
      matchScore: item.score,
    };
  });

  console.log(`[MAIN] Returning ${results.length} recommendations`);
  console.log(`[MAIN] Top 3 scores:`, results.slice(0, 3).map(r => r.matchScore));

  // Save tracks and recommendations to database (non-blocking)
  const userId = options.userId;
  if (userId) {
    console.log(`[DB] Saving data for user ${userId}...`);
    Promise.allSettled([
      // Save track metadata
      saveTracks(
        results.map(r => ({
          id: r.id,
          name: r.name,
          artists: r.artists,
          albumName: r.albumName,
          albumImage: r.albumImage,
          previewUrl: r.previewUrl || undefined,
          externalUrl: r.externalUrl,
          genres: [], // Genre data not available in dataset
        }))
      ),
      // Save recommendations
      saveRecommendations({
        userId,
        recommendations: results.map(r => ({
          trackId: r.id,
          clusterScore: r.matchScore,
          addedReason: r.addedReason,
        })),
        algorithmVersion: 'dataset-v1',
      }),
    ]).then((saveResults) => {
      saveResults.forEach((result, index) => {
        const operation = index === 0 ? 'saveTracks' : 'saveRecommendations';
        if (result.status === 'rejected') {
          console.error(`[DB] ${operation} failed:`, result.reason);
        } else {
          console.log(`[DB] ${operation} succeeded`);
        }
      });
    }).catch(err => console.error('[DB] Failed to save recommendations:', err));
  } else {
    console.log('[DB] userId is undefined, skipping database save');
  }

  return results;
}