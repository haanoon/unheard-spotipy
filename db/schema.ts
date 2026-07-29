import { pgTable, text, timestamp, integer, real, boolean, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table - stores Spotify user info
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Spotify user ID
  email: text('email').notNull(),
  name: text('name'),
  spotifyImage: text('spotify_image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: uniqueIndex('email_idx').on(table.email),
}));

// Tracks table - stores track metadata (deduplicated across all users)
export const tracks = pgTable('tracks', {
  id: text('id').primaryKey(), // Spotify track ID
  name: text('name').notNull(),
  artists: jsonb('artists').notNull().$type<string[]>(),
  albumName: text('album_name').notNull(),
  albumImage: text('album_image'),
  previewUrl: text('preview_url'),
  externalUrl: text('external_url').notNull(),
  durationMs: integer('duration_ms'),
  popularity: integer('popularity'),
  releaseDate: text('release_date'),

  // Audio features (for better recommendations)
  acousticness: real('acousticness'),
  danceability: real('danceability'),
  energy: real('energy'),
  instrumentalness: real('instrumentalness'),
  key: integer('key'),
  liveness: real('liveness'),
  loudness: real('loudness'),
  mode: integer('mode'),
  speechiness: real('speechiness'),
  tempo: real('tempo'),
  timeSignature: integer('time_signature'),
  valence: real('valence'),

  // Genre data (from artists)
  genres: jsonb('genres').notNull().$type<string[]>().default('[]'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Listening history - tracks user plays
export const listeningHistory = pgTable('listening_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  playedAt: timestamp('played_at').notNull(),
  playCount: integer('play_count').default(1).notNull(),
  context: text('context'), // playlist, album, artist, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userTrackIdx: index('user_track_idx').on(table.userId, table.trackId),
  playedAtIdx: index('played_at_idx').on(table.playedAt),
  userPlayedAtIdx: index('user_played_at_idx').on(table.userId, table.playedAt),
}));

// User interactions - likes, skips, playlist additions
export const userInteractions = pgTable('user_interactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  interactionType: text('interaction_type').notNull(), // 'like', 'skip', 'playlist_add', 'save'
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>(), // Extra context (e.g., playlist ID)
}, (table) => ({
  userTrackTypeIdx: index('user_track_type_idx').on(table.userId, table.trackId, table.interactionType),
  timestampIdx: index('interaction_timestamp_idx').on(table.timestamp),
}));

// Recommendations table - stores what was recommended to users
export const recommendations = pgTable('recommendations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  recommendedAt: timestamp('recommended_at').defaultNow().notNull(),
  clusterScore: real('cluster_score').notNull(),
  addedReason: text('added_reason').notNull(),

  // Feedback tracking
  accepted: boolean('accepted'), // null = no feedback yet, true = liked/saved, false = skipped
  feedbackAt: timestamp('feedback_at'),

  // A/B testing metadata
  algorithmVersion: text('algorithm_version').default('v1').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userRecommendedAtIdx: index('user_recommended_at_idx').on(table.userId, table.recommendedAt),
  feedbackIdx: index('feedback_idx').on(table.accepted),
}));

// User taste profile - precomputed genre preferences for faster recommendations
export const userTasteProfiles = pgTable('user_taste_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  topGenres: jsonb('top_genres').notNull().$type<Array<{ genre: string; weight: number }>>(),
  audioFeaturePreferences: jsonb('audio_feature_preferences').$type<{
    danceability?: number;
    energy?: number;
    valence?: number;
    acousticness?: number;
    instrumentalness?: number;
  }>(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  trackCount: integer('track_count').default(0).notNull(),
});

// Relations for Drizzle query capabilities
export const usersRelations = relations(users, ({ many, one }) => ({
  listeningHistory: many(listeningHistory),
  interactions: many(userInteractions),
  recommendations: many(recommendations),
  tasteProfile: one(userTasteProfiles),
}));

export const tracksRelations = relations(tracks, ({ many }) => ({
  listeningHistory: many(listeningHistory),
  interactions: many(userInteractions),
  recommendations: many(recommendations),
}));

export const listeningHistoryRelations = relations(listeningHistory, ({ one }) => ({
  user: one(users, { fields: [listeningHistory.userId], references: [users.id] }),
  track: one(tracks, { fields: [listeningHistory.trackId], references: [tracks.id] }),
}));

export const userInteractionsRelations = relations(userInteractions, ({ one }) => ({
  user: one(users, { fields: [userInteractions.userId], references: [users.id] }),
  track: one(tracks, { fields: [userInteractions.trackId], references: [tracks.id] }),
}));

export const recommendationsRelations = relations(recommendations, ({ one }) => ({
  user: one(users, { fields: [recommendations.userId], references: [users.id] }),
  track: one(tracks, { fields: [recommendations.trackId], references: [tracks.id] }),
}));

export const userTasteProfilesRelations = relations(userTasteProfiles, ({ one }) => ({
  user: one(users, { fields: [userTasteProfiles.userId], references: [users.id] }),
}));
