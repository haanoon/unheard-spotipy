import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

    if (!token || !token.accessToken) {
      return NextResponse.json(
        { error: "Unauthorized - Please log in with Spotify" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackIds, format = "uris" } = body;

    if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
      return NextResponse.json(
        { error: "At least one track ID is required" },
        { status: 400 }
      );
    }

    // Generate different export formats
    const trackUris = trackIds.map((id: string) => `spotify:track:${id}`);
    const trackUrls = trackIds.map((id: string) => `https://open.spotify.com/track/${id}`);

    // Create a Spotify URI that opens all tracks (for smaller lists)
    const spotifyUri = trackUris.join(',');

    return NextResponse.json({
      success: true,
      exports: {
        uris: trackUris,
        urls: trackUrls,
        spotifyUri: spotifyUri,
        trackCount: trackIds.length,
      },
    });
  } catch (error: any) {
    console.error("Error exporting tracks:", error);
    return NextResponse.json(
      { error: "Failed to export tracks", details: error.message },
      { status: 500 }
    );
  }
}