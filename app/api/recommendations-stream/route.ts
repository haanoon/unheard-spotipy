import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getPersonalizedRecommendationsWithProgress } from "@/lib/recommendations-dataset";

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token || !token.accessToken) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (token.error === "RefreshAccessTokenError") {
    return new Response(
      JSON.stringify({ error: "Token expired. Please log in again." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "30"), 50);

  const accessToken = token.accessToken as string;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        const recommendations = await getPersonalizedRecommendationsWithProgress(
          accessToken,
          { limit, userId: token.userId as string },
          send
        );

        send({
          stage: "complete",
          progress: 100,
          recommendations,
          count: recommendations.length,
        });
      } catch (error: any) {
        console.error("Streaming error:", error);
        send({
          stage: "error",
          progress: 0,
          error: error.message || "Failed to generate recommendations",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}