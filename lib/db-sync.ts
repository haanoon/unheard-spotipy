import { db } from './db';
import { users, tracks, listeningHistory, userInteractions, recommendations, userTasteProfiles } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Save or update user in database
 */
export async function saveUser(userData: {
  id: string;
  email: string;
  name?: string;
  image?: string;
}) {
  try {
    await db
      .insert(users)
      .values({
        id: userData.id,
        email: userData.email,
        name: userData.name || null,
        spotifyImage: userData.image || null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          name: userData.name || null,
          spotifyImage: userData.image || null,
          updatedAt: new Date(),
        },
      });

    console.log(`[DB] User saved: ${userData.email}`);
  } catch (error) {
    console.error('[DB] Error saving user:', error);
    throw error;
  }
}

/**
 * Save or update track metadata in database
 */
export async function saveTrack(trackData: {
  id: string;
  name: string;
  artists: string[];
  albumName: string;
  albumImage?: string;
  previewUrl?: string;
  externalUrl: string;
  durationMs?: number;
  popularity?: number;
  genres?: string[];
  audioFeatures?: {
    acousticness?: number;
    danceability?: number;
    energy?: number;
    instrumentalness?: number;
    key?: number;
    liveness?: number;
    loudness?: number;
    mode?: number;
    speechiness?: number;
    tempo?: number;
    timeSignature?: number;
    valence?: number;
  };
}) {
  try {
    await db
      .insert(tracks)
      .values({
        id: trackData.id,
        name: trackData.name,
        artists: trackData.artists,
        albumName: trackData.albumName,
        albumImage: trackData.albumImage || null,
        previewUrl: trackData.previewUrl || null,
        externalUrl: trackData.externalUrl,
        durationMs: trackData.durationMs || null,
        popularity: trackData.popularity || null,
        genres: trackData.genres || [],
        acousticness: trackData.audioFeatures?.acousticness || null,
        danceability: trackData.audioFeatures?.danceability || null,
        energy: trackData.audioFeatures?.energy || null,
        instrumentalness: trackData.audioFeatures?.instrumentalness || null,
        key: trackData.audioFeatures?.key || null,
        liveness: trackData.audioFeatures?.liveness || null,
        loudness: trackData.audioFeatures?.loudness || null,
        mode: trackData.audioFeatures?.mode || null,
        speechiness: trackData.audioFeatures?.speechiness || null,
        tempo: trackData.audioFeatures?.tempo || null,
        timeSignature: trackData.audioFeatures?.timeSignature || null,
        valence: trackData.audioFeatures?.valence || null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tracks.id,
        set: {
          name: trackData.name,
          artists: trackData.artists,
          albumName: trackData.albumName,
          albumImage: trackData.albumImage || null,
          popularity: trackData.popularity || null,
          genres: trackData.genres || [],
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    console.error(`[DB] Error saving track ${trackData.id}:`, error);
    // Don't throw - we don't want to break the recommendation flow
  }
}

/**
 * Batch save multiple tracks (more efficient)
 */
export async function saveTracks(tracksData: Parameters<typeof saveTrack>[0][]) {
  if (tracksData.length === 0) {
    console.log('[DB DEBUG] saveTracks called with 0 tracks, returning early');
    return;
  }

  console.log(`[DB DEBUG] saveTracks called with ${tracksData.length} tracks`);

  try {
    // Process in batches of 50 to avoid huge queries
    const batchSize = 50;
    for (let i = 0; i < tracksData.length; i += batchSize) {
      const batch = tracksData.slice(i, i + batchSize);
      console.log(`[DB DEBUG] Processing batch ${Math.floor(i / batchSize) + 1}, size: ${batch.length}`);
      const results = await Promise.allSettled(batch.map(track => saveTrack(track)));
      const batchSucceeded = results.filter(r => r.status === 'fulfilled').length;
      const batchFailed = results.filter(r => r.status === 'rejected').length;
      console.log(`[DB DEBUG] Batch results: ${batchSucceeded} succeeded, ${batchFailed} failed`);
    }
    console.log(`[DB] ✅ Saved ${tracksData.length} tracks`);
  } catch (error) {
    console.error('[DB] Error batch saving tracks:', error);
  }
}

/**
 * Save listening history
 * Note: The track must exist in the tracks table first (foreign key constraint)
 */
export async function saveListeningHistory(data: {
  userId: string;
  trackId: string;
  playedAt: Date;
  context?: string;
}) {
  console.log(`[DB DEBUG] saveListeningHistory called for trackId=${data.trackId}`);
  try {
    const values = {
      userId: data.userId,
      trackId: data.trackId,
      playedAt: data.playedAt,
      context: data.context || null,
    };
    console.log(`[DB DEBUG] Inserting into listening_history:`, JSON.stringify(values, null, 2));

    const result = await db.insert(listeningHistory).values(values);
    console.log(`[DB DEBUG] ✅ Successfully inserted listening history for track ${data.trackId}`);
    return result;
  } catch (error: any) {
    console.error(`[DB ERROR] Failed to save listening history for track ${data.trackId}:`, {
      code: error?.code,
      message: error?.message,
      detail: error?.detail,
    });

    // Check if it's a foreign key constraint error
    if (error?.code === '23503' || error?.message?.includes('foreign key')) {
      console.error(`[DB] ❌ Track ${data.trackId} does not exist in tracks table yet (foreign key violation)`);
    }
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Save user interaction (like, skip, playlist_add, save)
 */
export async function saveUserInteraction(data: {
  userId: string;
  trackId: string;
  interactionType: 'like' | 'skip' | 'playlist_add' | 'save';
  metadata?: Record<string, any>;
}) {
  try {
    await db.insert(userInteractions).values({
      userId: data.userId,
      trackId: data.trackId,
      interactionType: data.interactionType,
      metadata: data.metadata || null,
      timestamp: new Date(),
    });
    console.log(`[DB] Saved interaction: ${data.interactionType} for track ${data.trackId}`);
  } catch (error) {
    console.error('[DB] Error saving interaction:', error);
  }
}

/**
 * Save recommendations
 * Note: The tracks must exist in the tracks table first (foreign key constraint)
 */
export async function saveRecommendations(data: {
  userId: string;
  recommendations: Array<{
    trackId: string;
    clusterScore: number;
    addedReason: string;
  }>;
  algorithmVersion?: string;
}) {
  console.log(`[DB DEBUG] saveRecommendations called with ${data.recommendations.length} recommendations for user ${data.userId}`);

  try {
    const values = data.recommendations.map(rec => ({
      userId: data.userId,
      trackId: rec.trackId,
      clusterScore: rec.clusterScore,
      addedReason: rec.addedReason,
      algorithmVersion: data.algorithmVersion || 'v1',
      recommendedAt: new Date(),
    }));

    console.log(`[DB DEBUG] Prepared ${values.length} recommendation records`);
    console.log(`[DB DEBUG] First recommendation record:`, JSON.stringify(values[0], null, 2));

    const result = await db.insert(recommendations).values(values);
    console.log(`[DB] ✅ Saved ${values.length} recommendations for user ${data.userId}`);
    return result;
  } catch (error: any) {
    console.error('[DB ERROR] Error saving recommendations:', {
      code: error?.code,
      message: error?.message,
      detail: error?.detail,
    });

    // Check if it's a foreign key constraint error
    if (error?.code === '23503' || error?.message?.includes('foreign key')) {
      console.error('[DB] ❌ Some tracks do not exist in tracks table yet. Make sure tracks are saved first.');
    }
    throw error; // Re-throw so caller knows it failed
  }
}

/**
 * Update recommendation feedback
 */
export async function updateRecommendationFeedback(
  recommendationId: string,
  accepted: boolean
) {
  try {
    await db
      .update(recommendations)
      .set({
        accepted,
        feedbackAt: new Date(),
      })
      .where(eq(recommendations.id, recommendationId));

    console.log(`[DB] Updated recommendation feedback: ${recommendationId} = ${accepted}`);
  } catch (error) {
    console.error('[DB] Error updating recommendation feedback:', error);
  }
}

/**
 * Get user's taste profile
 */
export async function getUserTasteProfile(userId: string) {
  try {
    const profile = await db
      .select()
      .from(userTasteProfiles)
      .where(eq(userTasteProfiles.userId, userId))
      .limit(1);

    return profile[0] || null;
  } catch (error) {
    console.error('[DB] Error fetching taste profile:', error);
    return null;
  }
}

/**
 * Update user's taste profile
 */
export async function updateUserTasteProfile(data: {
  userId: string;
  topGenres: Array<{ genre: string; weight: number }>;
  audioFeaturePreferences?: {
    danceability?: number;
    energy?: number;
    valence?: number;
    acousticness?: number;
    instrumentalness?: number;
  };
  trackCount: number;
}) {
  try {
    await db
      .insert(userTasteProfiles)
      .values({
        userId: data.userId,
        topGenres: data.topGenres,
        audioFeaturePreferences: data.audioFeaturePreferences || null,
        trackCount: data.trackCount,
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: userTasteProfiles.userId,
        set: {
          topGenres: data.topGenres,
          audioFeaturePreferences: data.audioFeaturePreferences || null,
          trackCount: data.trackCount,
          lastUpdated: new Date(),
        },
      });

    console.log(`[DB] Updated taste profile for user ${data.userId}`);
  } catch (error) {
    console.error('[DB] Error updating taste profile:', error);
  }
}

/**
 * Get recommendations for a user (with track details)
 */
export async function getUserRecommendations(userId: string, limit = 30) {
  try {
    const results = await db
      .select({
        id: recommendations.id,
        trackId: recommendations.trackId,
        clusterScore: recommendations.clusterScore,
        addedReason: recommendations.addedReason,
        recommendedAt: recommendations.recommendedAt,
        accepted: recommendations.accepted,
        track: tracks,
      })
      .from(recommendations)
      .innerJoin(tracks, eq(recommendations.trackId, tracks.id))
      .where(eq(recommendations.userId, userId))
      .orderBy(desc(recommendations.recommendedAt))
      .limit(limit);

    return results;
  } catch (error) {
    console.error('[DB] Error fetching recommendations:', error);
    return [];
  }
}

/**
 * Check if track has been heard by user (exists in listening history or interactions)
 */
export async function hasUserHeardTrack(userId: string, trackId: string): Promise<boolean> {
  try {
    const [historyCount, interactionCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(listeningHistory)
        .where(and(
          eq(listeningHistory.userId, userId),
          eq(listeningHistory.trackId, trackId)
        )),
      db
        .select({ count: sql<number>`count(*)` })
        .from(userInteractions)
        .where(and(
          eq(userInteractions.userId, userId),
          eq(userInteractions.trackId, trackId)
        )),
    ]);

    return (historyCount[0]?.count || 0) > 0 || (interactionCount[0]?.count || 0) > 0;
  } catch (error) {
    console.error('[DB] Error checking if track heard:', error);
    return false;
  }
}
