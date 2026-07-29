// @ts-nocheck
import { getSpotifyClient } from "./spotify";
import { buildTfidf, buildIdf, vectorize, kMeans, scoreAgainstCentroids } from "./kmeans";
import { saveTracks, saveRecommendations, saveListeningHistory } from "./db-sync";

export interface RecommendationResult {
  id: string;
  name: string;
  artists: string[];
  albumName: string;
  albumImage: string;
  previewUrl: string | null;
  externalUrl: string;
  addedReason: string;
  clusterScore: number;
}

// --- Phase 1: Build user taste profile ---

async function getUserTopTracks(accessToken: string): Promise<any[]> {
  const spotify = getSpotifyClient(accessToken);

  const [short, medium, long] = await Promise.allSettled([
    spotify.getMyTopTracks({ limit: 50, time_range: "short_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "medium_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "long_term" }),
  ]);

  const seen = new Set<string>();
  const tracks: any[] = [];

  const addTracks = (items: any[]) => {
    for (const t of items) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
    }
  };

  if (short.status === "fulfilled") addTracks(short.value.body.items);
  if (medium.status === "fulfilled") addTracks(medium.value.body.items);
  if (long.status === "fulfilled") addTracks(long.value.body.items);

  return tracks;
}

async function getUserHeardTrackIds(accessToken: string): Promise<Set<string>> {
  const spotify = getSpotifyClient(accessToken);
  const heard = new Set<string>();

  const [recent, short, medium, long, saved] = await Promise.allSettled([
    spotify.getMyRecentlyPlayedTracks({ limit: 50 }),
    spotify.getMyTopTracks({ limit: 50, time_range: "short_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "medium_term" }),
    spotify.getMyTopTracks({ limit: 50, time_range: "long_term" }),
    spotify.getMySavedTracks({ limit: 50 }),
  ]);

  if (recent.status === "fulfilled")
    recent.value.body.items.forEach((i) => heard.add(i.track.id));
  if (short.status === "fulfilled")
    short.value.body.items.forEach((t) => heard.add(t.id));
  if (medium.status === "fulfilled")
    medium.value.body.items.forEach((t) => heard.add(t.id));
  if (long.status === "fulfilled")
    long.value.body.items.forEach((t) => heard.add(t.id));
  if (saved.status === "fulfilled")
    saved.value.body.items.forEach((i) => heard.add(i.track.id));

  return heard;
}

// Fetch artist details in batches of 50 (Spotify limit)
async function getArtistGenres(
  accessToken: string,
  artistIds: string[]
): Promise<Map<string, string[]>> {
  const spotify = getSpotifyClient(accessToken);
  const map = new Map<string, string[]>();
  const unique = Array.from(new Set(artistIds));

  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    try {
      const res = await spotify.getArtists(batch);
      for (const artist of res.body.artists) {
        if (artist) map.set(artist.id, artist.genres || []);
      }
    } catch (err: any) {
      console.error(`getArtists batch failed (${batch.length} artists):`, err?.statusCode, err?.message);
    }
  }

  return map;
}

// Build genre list per track: all genres from all artists on the track
function trackGenres(track: any, genreMap: Map<string, string[]>): string[] {
  const genres: string[] = [];
  for (const artist of track.artists) {
    const g = genreMap.get(artist.id) || [];
    genres.push(...g);
  }
  return genres;
}

// --- Phase 2: Build candidate pool from Spotify genre search ---

async function getCandidateTracks(
  accessToken: string,
  topGenres: string[],
  heardIds: Set<string>
): Promise<any[]> {
  const spotify = getSpotifyClient(accessToken);

  // Use top genres (max 20) as search seeds
  const searchGenres = topGenres.slice(0, 20);
  const seen = new Set<string>(heardIds);
  const candidates: any[] = [];

  // Search in parallel, 5 genres at a time to avoid rate limiting
  for (let i = 0; i < searchGenres.length; i += 5) {
    const batch = searchGenres.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((genre) =>
        spotify.searchTracks(`genre:"${genre}"`, { limit: 25, market: "from_token" })
      )
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const tracks = result.value.body.tracks?.items || [];
      for (const track of tracks) {
        if (!seen.has(track.id) && track.id) {
          seen.add(track.id);
          candidates.push(track);
        }
      }
    }
  }

  // Also search with more specific genre combos to broaden discovery
  const globalMarkets = ["JP", "KR", "BR", "IN", "NG", "MX", "SE", "DE", "FR", "TR"];
  const broadSearches = [
    ...globalMarkets.map((market) =>
      spotify.searchTracks(`genre:"${searchGenres[0] || "pop"}"`, { limit: 15, market })
    ),
  ];

  const globalResults = await Promise.allSettled(broadSearches);
  for (const result of globalResults) {
    if (result.status !== "fulfilled") continue;
    const tracks = result.value.body.tracks?.items || [];
    for (const track of tracks) {
      if (!seen.has(track.id) && track.id) {
        seen.add(track.id);
        candidates.push(track);
      }
    }
  }

  return candidates;
}

// Fetch genres for candidate tracks (they come without artist genres from search)
async function enrichCandidatesWithGenres(
  accessToken: string,
  candidates: any[]
): Promise<{ track: any; genres: string[] }[]> {
  // Collect all unique artist IDs
  const artistIds = Array.from(
    new Set(candidates.flatMap((t) => t.artists.map((a: any) => a.id)))
  );

  const genreMap = await getArtistGenres(accessToken, artistIds);

  return candidates.map((track) => ({
    track,
    genres: trackGenres(track, genreMap),
  }));
}

// Extract top N genres by frequency across all user tracks
function extractTopGenres(genreLists: string[][], topN = 30): string[] {
  const freq = new Map<string, number>();
  for (const genres of genreLists) {
    for (const g of genres) {
      freq.set(g, (freq.get(g) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([g]) => g);
}

// --- Main export ---

export async function getPersonalizedRecommendations(
  accessToken: string,
  options: { limit?: number; userId?: string } = {}
): Promise<RecommendationResult[]> {
  const { limit = 30, userId } = options;

  console.log("Phase 1: Fetching user listening history...");
  const [userTracks, heardIds] = await Promise.all([
    getUserTopTracks(accessToken),
    getUserHeardTrackIds(accessToken),
  ]);

  if (userTracks.length === 0) {
    throw new Error("No listening history found. Listen to some music on Spotify first.");
  }

  console.log(`Found ${userTracks.length} tracks in history, ${heardIds.size} heard IDs.`);

  // Save listening history to database (non-blocking)
  if (userId) {
    console.log(`[DB] Attempting to save listening history for user ${userId}...`);
    Promise.allSettled(
      Array.from(heardIds).slice(0, 50).map(trackId => {
        const track = userTracks.find(t => t.id === trackId);
        if (track) {
          return saveListeningHistory({
            userId,
            trackId,
            playedAt: new Date(),
          });
        }
        return Promise.resolve();
      })
    ).then((results) => {
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected');
      console.log(`[DB] Listening history: ${succeeded} saved, ${failed.length} failed`);
      if (failed.length > 0) {
        console.error('[DB] Listening history errors:', failed.map(f => f.reason));
      }
    }).catch(err => console.error('[DB] Failed to save listening history:', err));
  } else {
    console.log('[DB] userId is undefined, skipping listening history save');
  }

  // Get genres for user's top tracks
  const userArtistIds = Array.from(
    new Set(userTracks.flatMap((t) => t.artists.map((a: any) => a.id)))
  );
  const userGenreMap = await getArtistGenres(accessToken, userArtistIds);
  console.log(`Genre map size: ${userGenreMap.size} / ${userArtistIds.length} artists. Sample:`,
    Array.from(userGenreMap.entries()).slice(0, 3).map(([id, g]) => `${id}: [${g.join(",")}]`)
  );
  const userGenreLists = userTracks.map((t) => trackGenres(t, userGenreMap));

  console.log("Phase 2: Building TF-IDF genre vectors and clustering...");
  const { matrix: userMatrix, vocab } = buildTfidf(userGenreLists);

  if (vocab.length === 0) {
    throw new Error("Could not extract genre information from your listening history.");
  }

  const idf = buildIdf(userGenreLists, vocab);
  const k = Math.min(3, userMatrix.length);
  const { centroids } = kMeans(userMatrix, k);

  console.log(`Formed ${k} taste clusters from ${vocab.length} genre dimensions.`);

  // Extract top genres to use as search seeds
  const topGenres = extractTopGenres(userGenreLists, 25);
  console.log(`Top genres: ${topGenres.slice(0, 8).join(", ")}...`);

  console.log("Phase 3: Fetching candidate tracks from Spotify catalog...");
  const rawCandidates = await getCandidateTracks(accessToken, topGenres, heardIds);
  console.log(`Found ${rawCandidates.length} raw candidates.`);

  if (rawCandidates.length === 0) {
    throw new Error("Could not find candidate tracks. Try again in a moment.");
  }

  console.log("Phase 4: Enriching candidates with genre data...");
  const enriched = await enrichCandidatesWithGenres(accessToken, rawCandidates);

  console.log("Phase 5: Scoring candidates against your taste clusters...");
  const scored = enriched
    .map(({ track, genres }) => {
      const vector = vectorize(genres, vocab, idf);
      const score = scoreAgainstCentroids(vector, centroids);
      return { track, genres, score };
    })
    .filter(({ score }) => score > 0) // Must have some genre overlap
    .sort((a, b) => b.score - a.score); // Best match first

  console.log(`${scored.length} candidates scored, returning top ${limit}.`);

  const results: RecommendationResult[] = scored
    .slice(0, limit)
    .map(({ track, genres, score }) => {
      const topGenreForTrack = genres[0] || "music";
      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        albumName: track.album?.name || "",
        albumImage: track.album?.images?.[0]?.url || "",
        previewUrl: track.preview_url || null,
        externalUrl: track.external_urls?.spotify || "",
        addedReason: `${Math.round(score * 100)}% taste match · ${topGenreForTrack}`,
        clusterScore: score,
      };
    });

  // Save tracks and recommendations to database (non-blocking)
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
          genres: enriched.find(e => e.track.id === r.id)?.genres || [],
        }))
      ),
      // Save recommendations
      saveRecommendations({
        userId,
        recommendations: results.map(r => ({
          trackId: r.id,
          clusterScore: r.clusterScore,
          addedReason: r.addedReason,
        })),
        algorithmVersion: 'v1',
      }),
    ]).then((results) => {
      results.forEach((result, index) => {
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