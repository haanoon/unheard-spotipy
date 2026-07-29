import SpotifyProvider from "next-auth/providers/spotify";
import type { NextAuthOptions } from "next-auth";
import { saveUser } from "./db-sync";

const scopes = [
  "user-read-email",
  "user-read-private",
  "user-top-read",
  "user-library-read",
  "user-read-recently-played",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

async function refreshAccessToken(token: any) {
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.SPOTIFY_CLIENT_ID +
              ":" +
              process.env.SPOTIFY_CLIENT_SECRET
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: scopes,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        console.log('New account login - scopes granted:', account.scope);
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.scope = account.scope;
        token.userId = profile.id;

        // Save user to database
        try {
          await saveUser({
            id: profile.id as string,
            email: profile.email as string,
            name: profile.display_name as string,
            image: (profile as any).images?.[0]?.url,
          });
        } catch (error) {
          console.error('[Auth] Failed to save user to DB:', error);
        }
      }

      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as string | undefined;
      session.scope = token.scope as string | undefined;
      session.userId = token.userId as string;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};