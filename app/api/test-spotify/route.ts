import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

    if (!token || !token.accessToken) {
      return NextResponse.json(
        { error: "Unauthorized - Please log in with Spotify" },
        { status: 401 }
      );
    }

    const accessToken = token.accessToken as string;
    const results: any = {
      tokenPresent: true,
      scopes: token.scope,
      tests: []
    };

    // Test 1: Get current user profile
    try {
      const userResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const userData = await userResponse.json();
      results.tests.push({
        name: "Get User Profile",
        status: userResponse.status,
        success: userResponse.ok,
        data: userData,
      });
      results.userId = userData.id;
      results.userEmail = userData.email;
      results.accountType = userData.product;
    } catch (err: any) {
      results.tests.push({
        name: "Get User Profile",
        success: false,
        error: err.message,
      });
    }

    // Test 2: Create a test playlist
    let testPlaylistId = null;
    try {
      const createResponse = await fetch(
        `https://api.spotify.com/v1/me/playlists`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `API Test - ${new Date().toISOString()}`,
            description: "Test playlist - safe to delete",
            public: false,
          }),
        }
      );
      const playlistData = await createResponse.json();
      results.tests.push({
        name: "Create Playlist",
        status: createResponse.status,
        success: createResponse.ok,
        data: playlistData,
      });
      if (createResponse.ok) {
        testPlaylistId = playlistData.id;
      }
    } catch (err: any) {
      results.tests.push({
        name: "Create Playlist",
        success: false,
        error: err.message,
      });
    }

    // Test 3: Add a single track to the playlist
    if (testPlaylistId) {
      try {
        const addResponse = await fetch(
          `https://api.spotify.com/v1/playlists/${testPlaylistId}/tracks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uris: ["spotify:track:4Jr0O3zgoKEk71sIlABkLp"],
            }),
          }
        );
        const addData = await addResponse.text();
        let parsedData;
        try {
          parsedData = JSON.parse(addData);
        } catch {
          parsedData = addData;
        }
        results.tests.push({
          name: "Add Track to Playlist",
          status: addResponse.status,
          success: addResponse.ok,
          data: parsedData,
          headers: Object.fromEntries(addResponse.headers.entries()),
        });
      } catch (err: any) {
        results.tests.push({
          name: "Add Track to Playlist",
          success: false,
          error: err.message,
        });
      }

      // Cleanup: Unfollow the test playlist
      try {
        const deleteResponse = await fetch(
          `https://api.spotify.com/v1/playlists/${testPlaylistId}/followers`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );
        results.tests.push({
          name: "Unfollow Test Playlist",
          status: deleteResponse.status,
          success: deleteResponse.ok,
        });
      } catch (err: any) {
        results.tests.push({
          name: "Unfollow Test Playlist",
          success: false,
          error: err.message,
        });
      }
    }

    return NextResponse.json(results, { status: 200 });
  } catch (error: any) {
    console.error("Test error:", error);
    return NextResponse.json(
      { error: "Test failed", details: error.message },
      { status: 500 }
    );
  }
}
