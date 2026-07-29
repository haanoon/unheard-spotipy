# Database Setup Guide

This guide walks you through setting up persistent data storage for Unheard Spotipy using **Supabase + Drizzle ORM**.

## Table of Contents
- [Why Database Storage?](#why-database-storage)
- [Step 1: Create Supabase Project](#step-1-create-supabase-project)
- [Step 2: Get Database Connection String](#step-2-get-database-connection-string)
- [Step 3: Configure Environment Variables](#step-3-configure-environment-variables)
- [Step 4: Push Database Schema](#step-4-push-database-schema)
- [Step 5: Verify Setup](#step-5-verify-setup)
- [Step 6: Deploy to Vercel](#step-6-deploy-to-vercel)
- [What Data Gets Stored](#what-data-gets-stored)
- [Database Management](#database-management)
- [Troubleshooting](#troubleshooting)

---

## Why Database Storage?

With persistent storage, your app can:
- **Build better recommendations** based on historical listening patterns
- **Track user feedback** (likes/skips) to improve algorithm
- **Show analytics** (top genres, listening trends over time)
- **Avoid re-fetching** data from Spotify API (faster, fewer rate limits)
- **Support multiple users** with isolated data

---

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **"New Project"**
3. Fill in:
   - **Project Name**: `unheard-spotipy` (or any name)
   - **Database Password**: Create a strong password (save this!)
   - **Region**: Choose closest to your users (e.g., US West, EU Central)
   - **Pricing Plan**: Free (500 MB storage, 2 GB bandwidth/month)
4. Click **"Create new project"** (takes ~2 minutes)

---

## Step 2: Get Database Connection String

1. In your Supabase dashboard, go to **Project Settings** (gear icon in sidebar)
2. Click **"Database"** in the left menu
3. Scroll down to **"Connection string"** section
4. Select **"URI"** mode (not "Transaction" or "Session")
5. Copy the connection string. It looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with the database password you created in Step 1

**Example:**
```
postgresql://postgres:MySecurePassword123@db.abcdefghijklmnop.supabase.co:5432/postgres
```

---

## Step 3: Configure Environment Variables

### Local Development

1. Create `.env.local` file in your project root (if it doesn't exist)
2. Add the database connection string:

```bash
# .env.local

# Existing Spotify & NextAuth variables
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000

# NEW: Add this line
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

3. Replace the `DATABASE_URL` value with your actual connection string from Step 2

---

## Step 4: Push Database Schema

This creates all the necessary tables in your Supabase database.

```bash
# Push schema to database (creates tables automatically)
npm run db:push
```

**Expected output:**
```
✓ Applying changes...
✓ Tables created successfully
```

**What this creates:**
- `users` - Spotify user profiles
- `tracks` - Track metadata (name, artists, genres, audio features)
- `listening_history` - When users played tracks
- `user_interactions` - Likes, skips, playlist adds
- `recommendations` - What was recommended to users
- `user_taste_profiles` - Precomputed genre preferences

---

## Step 5: Verify Setup

### Option 1: Check Supabase Dashboard

1. Go to your Supabase project
2. Click **"Table Editor"** in the sidebar
3. You should see 6 new tables: `users`, `tracks`, `listening_history`, `user_interactions`, `recommendations`, `user_taste_profiles`

### Option 2: Run the App

```bash
npm run dev
```

1. Open [http://localhost:3000](http://localhost:3000)
2. Log in with Spotify
3. Generate recommendations
4. Check Supabase **Table Editor** - you should see:
   - Your user in the `users` table
   - Tracks in the `tracks` table
   - Recommendations in the `recommendations` table

---

## Step 6: Deploy to Vercel

### Add Environment Variable to Vercel

1. Go to your Vercel project dashboard
2. Click **"Settings"** → **"Environment Variables"**
3. Add a new variable:
   - **Name**: `DATABASE_URL`
   - **Value**: Your Supabase connection string (same as `.env.local`)
   - **Environments**: Check all (Production, Preview, Development)
4. Click **"Save"**

### Deploy

```bash
git add .
git commit -m "Add database integration with Supabase"
git push
```

Vercel will automatically deploy with the new database connection.

---

## What Data Gets Stored

### Automatically (Non-Blocking)

When users use your app, this data is saved in the background:

1. **User Profile** - When they log in
   - Spotify ID, email, name, profile image

2. **Listening History** - From their Spotify data
   - Recently played tracks with timestamps

3. **Track Metadata** - When recommendations are generated
   - Track name, artists, album, genres, audio features (danceability, energy, etc.)

4. **Recommendations** - Each time recommendations are generated
   - What was recommended, when, and the match score

### Manual (Via API Endpoints)

You can track user interactions via the feedback API:

```javascript
// Example: Track when user likes a song
fetch('/api/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    trackId: 'spotify:track:abc123',
    interactionType: 'like', // 'like', 'skip', 'playlist_add', 'save'
    metadata: { playlistId: 'xyz789' } // optional
  })
});
```

---

## Database Management

### View Data in Supabase Dashboard

- Go to **Table Editor** to browse your data
- Go to **SQL Editor** to run custom queries

### Example Queries

```sql
-- See all users
SELECT * FROM users;

-- See recent recommendations for a user
SELECT r.*, t.name, t.artists 
FROM recommendations r
JOIN tracks t ON r.track_id = t.id
WHERE r.user_id = 'your_spotify_user_id'
ORDER BY r.recommended_at DESC
LIMIT 10;

-- Count tracks by genre
SELECT 
  jsonb_array_elements_text(genres) as genre,
  COUNT(*) as track_count
FROM tracks
GROUP BY genre
ORDER BY track_count DESC
LIMIT 20;
```

### Drizzle Studio (Local Database GUI)

```bash
npm run db:studio
```

Opens a visual interface at [https://local.drizzle.studio](https://local.drizzle.studio) to browse and edit data.

---

## API Endpoints

### Analytics API

Get user analytics and insights:

```bash
# Overview stats (last 30 days)
GET /api/analytics?type=overview&days=30

# Top genres
GET /api/analytics?type=genres&days=30

# Listening trends over time
GET /api/analytics?type=listening-trends&days=30

# Recommendation acceptance rate
GET /api/analytics?type=recommendation-stats
```

**Example Response:**
```json
{
  "overview": {
    "totalListens": 245,
    "totalLikes": 18,
    "totalSkips": 7,
    "totalRecommendations": 150,
    "period": "Last 30 days"
  }
}
```

### Feedback API

Track user interactions:

```bash
POST /api/feedback
Content-Type: application/json

{
  "trackId": "spotify:track:abc123",
  "interactionType": "like",
  "metadata": {}
}
```

**Interaction Types:**
- `like` - User liked the track
- `skip` - User skipped the track
- `playlist_add` - User added to playlist
- `save` - User saved to library

---

## Troubleshooting

### Error: "DATABASE_URL is not set"

**Solution:** Make sure you added `DATABASE_URL` to your `.env.local` file and restarted the dev server.

### Error: "relation 'users' does not exist"

**Solution:** You haven't pushed the schema yet. Run:
```bash
npm run db:push
```

### Error: "password authentication failed"

**Solution:** 
1. Check your connection string - the password might be wrong
2. In Supabase, go to **Project Settings** → **Database** → **Reset Database Password**
3. Update your `.env.local` and Vercel environment variables with the new password

### Error: "too many connections"

**Solution:** This happens in serverless environments. The code already handles this with connection pooling (`max: 1`). If it persists:
1. Check Supabase **Database** → **Connection pooling** is enabled
2. Use the "Connection pooling" connection string instead of direct connection

### Tables are empty after generating recommendations

**Check:**
1. Look at your server logs - do you see `[DB] User saved:` and `[DB] Saved X tracks`?
2. If not, the database writes might be failing silently
3. Check Supabase logs: **Logs** → **Postgres Logs** for errors

### Want to reset the database?

```bash
# Option 1: Drop and recreate tables (WARNING: deletes all data)
npm run db:push -- --force

# Option 2: Delete tables manually in Supabase Table Editor
```

---

## Cost & Scaling

### Free Tier (Current)
- **Storage**: 500 MB
- **Bandwidth**: 2 GB/month
- **Database size**: Up to 500 MB
- **Good for**: 100-200 active users

### When to Upgrade

Upgrade to **Pro ($25/month)** when:
- You hit 500 MB storage (~50,000 tracks + user data)
- You exceed 2 GB bandwidth/month (~1000 active users)
- You need automatic backups

### Estimate at Scale

**100 users actively using the app:**
- ~10,000 tracks in database (~5 MB)
- ~50,000 listening history entries (~10 MB)
- ~15,000 recommendations (~8 MB)
- **Total: ~25 MB** (well within free tier)

**1,000 users:**
- ~100,000 tracks (~50 MB)
- ~500,000 listening history (~100 MB)
- ~150,000 recommendations (~80 MB)
- **Total: ~230 MB** (still within free tier)

---

## Next Steps

Now that your database is set up:

1. ✅ Users are automatically saved when they log in
2. ✅ Recommendations are tracked automatically
3. ✅ Track metadata is cached to reduce Spotify API calls

**Optional enhancements:**

1. **Add feedback tracking to the UI** - Add like/skip buttons in your dashboard
2. **Build analytics dashboard** - Use the `/api/analytics` endpoint to show user insights
3. **Improve recommendations** - Use stored feedback to train better algorithm
4. **Implement caching** - Check if track exists in DB before calling Spotify API

---

## Database Schema Overview

```
users
├── id (Spotify user ID)
├── email
├── name
├── spotify_image
└── created_at, updated_at

tracks
├── id (Spotify track ID)
├── name, artists[], album_name, album_image
├── preview_url, external_url
├── genres[], popularity
├── audio features (danceability, energy, valence, etc.)
└── created_at, updated_at

listening_history
├── id
├── user_id → users.id
├── track_id → tracks.id
├── played_at
├── play_count
└── context

user_interactions
├── id
├── user_id → users.id
├── track_id → tracks.id
├── interaction_type (like, skip, playlist_add, save)
├── timestamp
└── metadata (JSON)

recommendations
├── id
├── user_id → users.id
├── track_id → tracks.id
├── recommended_at
├── cluster_score
├── added_reason
├── accepted (true/false/null for feedback)
└── algorithm_version

user_taste_profiles
├── user_id (primary key)
├── top_genres (JSON array)
├── audio_feature_preferences (JSON)
├── track_count
└── last_updated
```

---

## Support

If you run into issues:

1. Check this guide's [Troubleshooting](#troubleshooting) section
2. Check Supabase logs: **Logs** → **Postgres Logs**
3. Check your server logs: `npm run dev` output
4. Review the code in:
   - `db/schema.ts` - Database schema
   - `lib/db.ts` - Database connection
   - `lib/db-sync.ts` - Database operations

---

**Database setup complete! 🎉** Your app now has persistent storage for better recommendations and analytics.
