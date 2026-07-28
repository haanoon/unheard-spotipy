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

interface AudioFeatureProfile {
  danceability: number;
  energy: number;
  loudness: number;
  speechiness: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  valence: number;
  tempo: number;
}

interface UserProfile {
  mean: AudioFeatureProfile;
  stdDev: AudioFeatureProfile;
  topGenres: string[];
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

  // Fetch top tracks (all time ranges)
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

  // Fetch recently played
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

  // Fetch saved tracks (paginated)
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

// Build set of heard track IDs
async function getHeardTrackIds(
  accessToken: string,
  allTracks: any[]
): Promise<Set<string>> {
  const heard = new Set<string>();
  for (const track of allTracks) {
    heard.add(track.id);
  }
  return heard;
}

// Fetch audio features in batches
async function getAudioFeatures(
  accessToken: string,
  tracks: any[],
  onProgress: ProgressCallback
): Promise<Map<string, any>> {
  const cacheKey = 'audio-features';
  const cached = await getCached<Record<string, any>>(cacheKey);
  if (cached) {
    const featuresMap = new Map(Object.entries(cached));
    console.log(`[getAudioFeatures] Using cached data: ${featuresMap.size} features`);
    onProgress({
      stage: "analyzing_features",
      progress: 40,
      message: `Loaded ${featuresMap.size} audio features from cache`,
    });
    return featuresMap;
  }

  const spotify = getSpotifyClient(accessToken);
  const featuresMap = new Map<string, any>();
  const batchSize = 100; // Spotify allows up to 100 tracks per request

  console.log(`[getAudioFeatures] Starting to fetch features for ${tracks.length} tracks`);
  onProgress({
    stage: "analyzing_features",
    progress: 25,
    message: `Analyzing audio features for ${tracks.length} tracks...`,
  });

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const ids = batch.map((t) => t.id);

    console.log(`[getAudioFeatures] Fetching batch ${i / batchSize + 1}, IDs: ${ids.length} tracks`);
    try {
      const response = await spotify.getAudioFeaturesForTracks(ids);
      console.log(`[getAudioFeatures] Response status:`, response.statusCode);
      console.log(`[getAudioFeatures] Got ${response.body.audio_features?.length || 0} features back`);

      for (let j = 0; j < response.body.audio_features.length; j++) {
        const features = response.body.audio_features[j];
        if (features) {
          featuresMap.set(ids[j], features);
        }
      }

      console.log(`[getAudioFeatures] Total features collected so far: ${featuresMap.size}`);

      const progressPercent = 25 + ((i + batch.length) / tracks.length) * 15;
      onProgress({
        stage: "analyzing_features",
        progress: Math.min(40, progressPercent),
        message: `Analyzed ${Math.min(i + batch.length, tracks.length)}/${tracks.length} tracks...`,
      });
    } catch (err: any) {
      console.error(`[getAudioFeatures] Failed batch ${i / batchSize + 1}:`, {
        statusCode: err?.statusCode,
        message: err?.message,
        body: err?.body,
      });
    }
  }

  console.log(`[getAudioFeatures] Final feature count: ${featuresMap.size} out of ${tracks.length} tracks`);

  // Save to cache
  const cacheData = Object.fromEntries(featuresMap.entries());
  await setCache(cacheKey, cacheData);

  return featuresMap;
}

// Extract genres from tracks
async function extractGenres(
  accessToken: string,
  tracks: any[],
  onProgress: ProgressCallback
): Promise<Map<string, string[]>> {
  const cacheKey = 'artist-genres';
  const cached = await getCached<Record<string, string[]>>(cacheKey);
  if (cached) {
    const genreMap = new Map(Object.entries(cached));
    console.log(`[extractGenres] Using cached data: ${genreMap.size} artists`);
    onProgress({
      stage: "analyzing_features",
      progress: 41,
      message: `Loaded genres for ${genreMap.size} artists from cache`,
    });
    return genreMap;
  }

  const spotify = getSpotifyClient(accessToken);
  const genreMap = new Map<string, string[]>();

  // Collect unique artist IDs
  const artistIds = Array.from(
    new Set(tracks.flatMap((t) => t.artists.map((a: any) => a.id)))
  );

  console.log(`[extractGenres] Fetching genres for ${artistIds.length} unique artists`);
  onProgress({
    stage: "analyzing_features",
    progress: 40,
    message: `Fetching genres for ${artistIds.length} artists...`,
  });

  const batchSize = 50;
  for (let i = 0; i < artistIds.length; i += batchSize) {
    const batch = artistIds.slice(i, i + batchSize);
    console.log(`[extractGenres] Batch ${i / batchSize + 1}: ${batch.length} artists`);
    try {
      const response = await spotify.getArtists(batch);
      console.log(`[extractGenres] Response status:`, response.statusCode);
      console.log(`[extractGenres] Got ${response.body.artists?.length || 0} artists back`);

      for (const artist of response.body.artists) {
        if (artist) {
          genreMap.set(artist.id, artist.genres || []);
        }
      }
      console.log(`[extractGenres] Total artists with genres: ${genreMap.size}`);
    } catch (err: any) {
      console.error(`[extractGenres] Failed batch ${i / batchSize + 1}:`, {
        statusCode: err?.statusCode,
        message: err?.message,
        body: err?.body,
      });
    }
  }

  console.log(`[extractGenres] Final genre map size: ${genreMap.size} out of ${artistIds.length} artists`);

  // Save to cache
  const cacheData = Object.fromEntries(genreMap.entries());
  await setCache(cacheKey, cacheData);

  return genreMap;
}

// Build user taste profile
function buildUserProfile(
  tracks: any[],
  featuresMap: Map<string, any>,
  genreMap: Map<string, string[]>
): UserProfile {
  console.log(`[buildUserProfile] Building profile from ${tracks.length} tracks`);
  console.log(`[buildUserProfile] Features map has ${featuresMap.size} entries`);
  console.log(`[buildUserProfile] Genre map has ${genreMap.size} entries`);

  const validFeatures: any[] = [];

  for (const track of tracks) {
    const features = featuresMap.get(track.id);
    if (features) {
      validFeatures.push(features);
    }
  }

  console.log(`[buildUserProfile] Valid features found: ${validFeatures.length} out of ${tracks.length} tracks`);

  if (validFeatures.length === 0) {
    console.error(`[buildUserProfile] ERROR: No valid features found!`);
    console.error(`[buildUserProfile] Sample track IDs:`, tracks.slice(0, 5).map(t => t.id));
    console.error(`[buildUserProfile] Features map keys sample:`, Array.from(featuresMap.keys()).slice(0, 5));
    throw new Error("No audio features available for your tracks");
  }

  // Calculate mean
  const mean: any = {};
  const keys = [
    "danceability",
    "energy",
    "loudness",
    "speechiness",
    "acousticness",
    "instrumentalness",
    "liveness",
    "valence",
    "tempo",
  ];

  for (const key of keys) {
    const values = validFeatures.map((f) => f[key]).filter((v) => v != null);
    mean[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Calculate standard deviation
  const stdDev: any = {};
  for (const key of keys) {
    const values = validFeatures.map((f) => f[key]).filter((v) => v != null);
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean[key], 2), 0) / values.length;
    stdDev[key] = Math.sqrt(variance);
  }

  // Extract top genres
  const genreFreq = new Map<string, number>();
  for (const track of tracks) {
    for (const artist of track.artists) {
      const genres = genreMap.get(artist.id) || [];
      for (const genre of genres) {
        genreFreq.set(genre, (genreFreq.get(genre) || 0) + 1);
      }
    }
  }

  const topGenres = Array.from(genreFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([genre]) => genre);

  return {
    mean,
    stdDev,
    topGenres,
    trackCount: validFeatures.length,
  };
}

// Generate candidate tracks from Spotify catalog
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

  // Search by top genres
  const genresToSearch = profile.topGenres.slice(0, 20);
  const markets = ["US", "GB", "JP", "KR", "BR", "IN", "MX", "DE", "FR", "SE", "NG", "TR"];

  let processed = 0;
  const totalSearches = genresToSearch.length + markets.length;

  // Genre-based search
  for (const genre of genresToSearch) {
    try {
      const response = await spotify.searchTracks(`genre:"${genre}"`, {
        limit: 30,
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
      console.error(`Search failed for genre: ${genre}`, err);
    }
  }

  // Market-based search for diversity
  for (const market of markets) {
    try {
      const searchGenre = genresToSearch[0] || "pop";
      const response = await spotify.searchTracks(`genre:"${searchGenre}"`, {
        limit: 20,
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
      console.error(`Search failed for market: ${market}`, err);
    }
  }

  return candidates;
}

// Score candidates based on audio feature similarity
async function scoreCandidates(
  accessToken: string,
  candidates: any[],
  profile: UserProfile,
  genreMap: Map<string, string[]>,
  onProgress: ProgressCallback
): Promise<RecommendationResult[]> {
  const spotify = getSpotifyClient(accessToken);

  onProgress({
    stage: "scoring",
    progress: 65,
    message: `Scoring ${candidates.length} candidates...`,
  });

  // Fetch audio features for candidates
  const candidateFeatures = await getAudioFeatures(accessToken, candidates, (data) => {
    onProgress({
      stage: "scoring",
      progress: 65 + (data.progress - 25) * 0.5, // Map 25-40 to 65-72.5
      message: data.message,
    });
  });

  onProgress({
    stage: "scoring",
    progress: 75,
    message: "Computing similarity scores...",
  });

  const scored: RecommendationResult[] = [];

  for (const track of candidates) {
    const features = candidateFeatures.get(track.id);
    if (!features) continue;

    // Compute Euclidean distance normalized by standard deviation
    const keys = [
      "danceability",
      "energy",
      "speechiness",
      "acousticness",
      "instrumentalness",
      "liveness",
      "valence",
    ];

    let distance = 0;
    for (const key of keys) {
      const diff = features[key] - profile.mean[key];
      const normalized = diff / (profile.stdDev[key] || 1);
      distance += normalized * normalized;
    }

    // Tempo distance (separate scale)
    const tempoDiff = Math.abs(features.tempo - profile.mean.tempo);
    const tempoNormalized = tempoDiff / (profile.stdDev.tempo || 30);
    distance += tempoNormalized * tempoNormalized * 0.5; // Weight tempo lower

    distance = Math.sqrt(distance);

    // Convert distance to similarity score (0-1, higher is better)
    const similarityScore = 1 / (1 + distance);

    // Genre bonus
    let genreBonus = 0;
    for (const artist of track.artists) {
      const genres = genreMap.get(artist.id) || [];
      const overlap = genres.filter((g) => profile.topGenres.includes(g)).length;
      genreBonus += overlap;
    }
    genreBonus = Math.min(genreBonus * 0.05, 0.3);

    const finalScore = similarityScore + genreBonus;

    // Get primary genre for display
    let primaryGenre = "music";
    for (const artist of track.artists) {
      const genres = genreMap.get(artist.id) || [];
      if (genres.length > 0) {
        primaryGenre = genres[0];
        break;
      }
    }

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

  // Sort by score descending
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

  console.log(`[MAIN] ========== Starting recommendation generation ==========`);
  console.log(`[MAIN] Limit: ${limit}`);
  console.log(`[MAIN] Access token length: ${accessToken?.length || 0}`);

  onProgress({ stage: "initializing", progress: 0, message: "Starting recommendation engine..." });

  // Step 1: Fetch all listening history
  console.log(`[MAIN] Step 1: Fetching listening history...`);
  const allTracks = await getUserAllTracks(accessToken, onProgress);
  console.log(`[MAIN] Fetched ${allTracks.length} total tracks`);
  console.log(`[MAIN] Sample track:`, allTracks[0] ? {
    id: allTracks[0].id,
    name: allTracks[0].name,
    artists: allTracks[0].artists?.map((a: any) => a.name)
  } : 'none');

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

  // Step 2: Analyze audio features
  console.log(`[MAIN] Step 2: Fetching audio features...`);
  const featuresMap = await getAudioFeatures(accessToken, allTracks, onProgress);
  console.log(`[MAIN] Got features for ${featuresMap.size} tracks`);

  // Step 3: Extract genres
  console.log(`[MAIN] Step 3: Extracting genres...`);
  const genreMap = await extractGenres(accessToken, allTracks, onProgress);
  console.log(`[MAIN] Got genres for ${genreMap.size} artists`);

  // Step 4: Build taste profile
  onProgress({
    stage: "building_profile",
    progress: 42,
    message: "Building your taste profile...",
  });

  console.log(`[MAIN] Step 4: Building profile...`);
  const profile = buildUserProfile(allTracks, featuresMap, genreMap);

  onProgress({
    stage: "building_profile",
    progress: 44,
    message: `Profile complete: ${profile.trackCount} tracks, ${profile.topGenres.length} genres`,
  });

  // Step 5: Generate candidates
  const candidates = await getCandidateTracks(accessToken, profile, heardIds, onProgress);

  if (candidates.length === 0) {
    throw new Error("Could not find any candidate tracks. Try again in a moment.");
  }

  // Step 6: Score candidates
  const scored = await scoreCandidates(accessToken, candidates, profile, genreMap, onProgress);

  onProgress({
    stage: "finalizing",
    progress: 95,
    message: `Selecting top ${limit} recommendations...`,
  });

  return scored.slice(0, limit);
}