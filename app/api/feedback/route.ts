import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { saveUserInteraction } from "@/lib/db-sync";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackId, interactionType, metadata } = body;

    if (!trackId || !interactionType) {
      return NextResponse.json(
        { error: "Missing required fields: trackId, interactionType" },
        { status: 400 }
      );
    }

    const validTypes = ['like', 'skip', 'playlist_add', 'save'];
    if (!validTypes.includes(interactionType)) {
      return NextResponse.json(
        { error: `Invalid interactionType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Save interaction to database
    await saveUserInteraction({
      userId: session.userId,
      trackId,
      interactionType,
      metadata,
    });

    return NextResponse.json({
      success: true,
      message: "Interaction saved successfully",
    });
  } catch (error: any) {
    console.error("Error saving feedback:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save feedback" },
      { status: 500 }
    );
  }
}
