import SpotifyWebApi from "spotify-web-api-node";

/**
 * SPOTIFY API CLIENT HELPER
 *
 * This file provides a configured Spotify API client that can be used
 * throughout the application to make requests to Spotify's API
 */

/**
 * Creates a new Spotify API client instance
 * @param accessToken - The user's Spotify access token from their session
 * @returns Configured SpotifyWebApi client
 */
export function getSpotifyClient(accessToken: string) {
  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });

  // Set the access token for this user
  spotifyApi.setAccessToken(accessToken);

  return spotifyApi;
}

/**
 * Spotify API client with credentials (no access token)
 * Used for operations that don't require user authentication
 */
export function getSpotifyClientCredentials() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });
}
