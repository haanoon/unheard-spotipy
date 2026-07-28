import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPersonalizedRecommendations } from "@/lib/recommendations";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken) {
      return NextResponse.json(
        { error: "Unauthorized - Please log in with Spotify" },
        { status: 401 }
      );
    }

    // Check for token refresh errors
    if (session.error === "RefreshAccessTokenError") {
      return NextResponse.json(
        { error: "Failed to refresh access token. Please log in again." },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "30"), 50);

    console.log(`Generating ${limit} recommendations for user...`);

    // Generate recommendations using the recommendation engine
    const recommendations = await getPersonalizedRecommendations(
      session.accessToken,
      { limit }
    );

    console.log(`Generated ${recommendations.length} recommendations`);

    return NextResponse.json({
      success: true,
      count: recommendations.length,
      recommendations,
    });
  } catch (error: any) {
    console.error("Error in recommendations API:", error);

    // Handle Spotify API errors
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Spotify authentication failed. Please log in again." },
        { status: 401 }
      );
    }

    if (error.statusCode === 429) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again in a few moments." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error: error.message || "Failed to generate recommendations",
      },
      { status: 500 }
    );
  }
}
