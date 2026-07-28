import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token || !token.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const accessToken = token.accessToken as string;

  // Test 1: Try to get audio features for a known track
  const testTrackId = "10JXoXw2mQ0mcpmDEubTAS"; // From your cache

  const tests: any = {
    token: {
      length: accessToken.length,
      expiresAt: token.expiresAt,
    },
    tests: {},
  };

  // Test audio features endpoint directly
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/audio-features/${testTrackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    tests.tests.audioFeaturesSingle = {
      status: response.status,
      statusText: response.statusText,
      success: response.ok,
      data: response.ok ? await response.json() : await response.text(),
    };
  } catch (err: any) {
    tests.tests.audioFeaturesSingle = {
      status: "error",
      message: err.message,
    };
  }

  // Test multiple audio features endpoint
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${testTrackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    tests.tests.audioFeaturesMultiple = {
      status: response.status,
      statusText: response.statusText,
      success: response.ok,
      data: response.ok ? await response.json() : await response.text(),
    };
  } catch (err: any) {
    tests.tests.audioFeaturesMultiple = {
      status: "error",
      message: err.message,
    };
  }

  // Test get artist endpoint
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/artists/0YC192cP3KPCRWx8zr8MfZ`, // Pritam
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = response.ok ? await response.json() : await response.text();
    tests.tests.getArtist = {
      status: response.status,
      statusText: response.statusText,
      success: response.ok,
      hasGenres: data.genres?.length > 0,
      genres: data.genres,
    };
  } catch (err: any) {
    tests.tests.getArtist = {
      status: "error",
      message: err.message,
    };
  }

  // Test get current user endpoint to see what scopes we have
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/me`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = response.ok ? await response.json() : await response.text();
    tests.tests.getCurrentUser = {
      status: response.status,
      success: response.ok,
      product: data.product,
    };
  } catch (err: any) {
    tests.tests.getCurrentUser = {
      status: "error",
      message: err.message,
    };
  }

  return NextResponse.json(tests, { status: 200 });
}