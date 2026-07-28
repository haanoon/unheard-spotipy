# Unheard Spotipy

A web app that finds songs you've never heard but will probably love based on your Spotify listening history.

## What it does

Analyzes your Spotify taste (what you listen to, audio features like tempo and energy) and recommends songs you haven't heard yet. Works with any language or genre.

## Setup

You'll need a Spotify Developer account (free).

1. Go to https://developer.spotify.com/dashboard and create a new app
2. Add redirect URI: `http://localhost:3000/api/auth/callback/spotify`
3. Copy your Client ID and Secret
4. Put them in `.env.local`:
```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

Then run:
```bash
npm install
npm run dev
```

Open http://localhost:3000, login with Spotify, and hit "Generate Recommendations".

## How it works

- Grabs your recently played tracks and top artists
- Calculates your audio preference profile
- Finds similar artists you haven't explored
- Recommends songs that match your taste but aren't in your history
- Lets you create a playlist with one click

Built with Next.js, NextAuth, and Spotify API.
