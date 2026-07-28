# Dataset-Based Recommendation Plan

## Current Situation
- ✅ We have 250 tracks from user's listening history (cached in `.cache/user-all-tracks.json`)
- ❌ Spotify's `/v1/audio-features` endpoint returns 403 Forbidden
- ✅ Artist genres endpoint works (but many artists have no genres)

## Solution: Use External Dataset

### Approach
1. Download Spotify audio features dataset (CSV/JSON)
2. Load it into memory or SQLite database
3. Match user's tracks to dataset by track ID or (name + artist)
4. Build taste profile from matched features
5. Score candidate tracks from dataset

### Dataset Options

**Option A: Kaggle Spotify Dataset (~600K tracks)**
- URL: https://www.kaggle.com/datasets/yamaerenay/spotify-dataset-19212020-600k-tracks
- Size: ~100MB
- Fields: danceability, energy, key, loudness, mode, speechiness, acousticness, instrumentalness, liveness, valence, tempo
- Match by: track_id, name, artist

**Option B: Million Song Dataset**
- URL: http://millionsongdataset.com/
- Size: Subset (10K tracks, ~2GB)
- Fields: tempo, loudness, key, time_signature, duration
- Match by: track_name, artist_name (fuzzy matching needed)

**Recommendation: Start with Option A (Kaggle)**
- Easier to integrate (CSV format)
- Better coverage for recent music
- Direct Spotify track ID matching

## Implementation Steps

1. **Download dataset** (manual or via kaggle API)
2. **Create dataset loader** (`lib/dataset.ts`)
   - Load CSV into Map<track_id, features>
   - Provide lookup function
3. **Update recommendations engine** (`lib/recommendations-with-dataset.ts`)
   - Match user tracks to dataset
   - Fall back to genre-only for unmatched tracks
4. **Test with cached user data**

## Next Steps
- Download Kaggle dataset
- Or use smaller sample dataset for testing
