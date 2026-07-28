# Using Datasets for Audio Features

Since Spotify's `/v1/audio-features` endpoint is blocked (403 Forbidden), we need to use external datasets.

## Quick Start

### Option 1: Download Spotify Dataset from Kaggle

1. **Install Kaggle CLI** (if you have a Kaggle account):
   ```bash
   pip install kaggle
   # Set up Kaggle API token from https://www.kaggle.com/settings
   kaggle datasets download yamaerenay/spotify-dataset-19212020-600k-tracks
   unzip spotify-dataset-19212020-600k-tracks.zip -d data/
   ```

2. **Or download manually**:
   - Go to: https://www.kaggle.com/datasets/yamaerenay/spotify-dataset-19212020-600k-tracks
   - Download the dataset
   - Extract CSV to `data/` directory

### Option 2: Use Alternative Dataset Sources

**LastFM Dataset**:
- URL: http://millionsongdataset.com/lastfm/
- Contains track metadata and tags

**FMA (Free Music Archive)**:
- URL: https://github.com/mdeff/fma
- Audio features for 100K+ tracks
- Free download

## Expected Dataset Format

The code expects a CSV file with these columns:
```
id,name,artists,danceability,energy,key,loudness,mode,speechiness,acousticness,instrumentalness,liveness,valence,tempo,duration_ms,popularity,year
```

## Current Status

Your cached tracks are ready at: `.cache/user-all-tracks.json` (250 tracks)

Once you have the dataset CSV in `data/tracks.csv`, the recommendation engine will:
1. Load the dataset
2. Match your 250 tracks to the dataset
3. Build your taste profile from matched features
4. Generate recommendations

## Next Steps

1. Download a dataset using one of the options above
2. Place the CSV file in `data/tracks.csv`
3. Run recommendations - it will automatically use the dataset