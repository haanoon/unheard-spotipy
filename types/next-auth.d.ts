import { DefaultSession } from "next-auth";

/**
 * TYPE DEFINITIONS FOR NEXTAUTH
 *
 * These extend the default NextAuth types to include our custom properties
 * like the Spotify access token and potential error states
 */

declare module "next-auth" {
  /**
   * Extends the built-in session type
   * Now session.accessToken is available throughout the app
   */
  interface Session {
    accessToken?: string;
    error?: string;
    scope?: string;
    user: {
      /** The user's Spotify ID */
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  /**
   * Extends the JWT token type
   * Stores Spotify tokens and expiration time
   */
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
    scope?: string;
  }
}
