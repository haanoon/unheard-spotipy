import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";
import { listeningHistory, userInteractions, recommendations, tracks } from "@/db/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "overview";
    const days = parseInt(searchParams.get("days") || "30");

    const userId = session.userId;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    switch (type) {
      case "overview":
        return await getOverview(userId, sinceDate);

      case "genres":
        return await getTopGenres(userId, sinceDate);

      case "listening-trends":
        return await getListeningTrends(userId, sinceDate);

      case "recommendation-stats":
        return await getRecommendationStats(userId);

      default:
        return NextResponse.json(
          { error: "Invalid type. Use: overview, genres, listening-trends, recommendation-stats" },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}

async function getOverview(userId: string, sinceDate: Date) {
  const [totalListens, totalLikes, totalSkips, totalRecommendations] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(listeningHistory)
      .where(and(
        eq(listeningHistory.userId, userId),
        gte(listeningHistory.playedAt, sinceDate)
      )),

    db
      .select({ count: sql<number>`count(*)` })
      .from(userInteractions)
      .where(and(
        eq(userInteractions.userId, userId),
        eq(userInteractions.interactionType, 'like'),
        gte(userInteractions.timestamp, sinceDate)
      )),

    db
      .select({ count: sql<number>`count(*)` })
      .from(userInteractions)
      .where(and(
        eq(userInteractions.userId, userId),
        eq(userInteractions.interactionType, 'skip'),
        gte(userInteractions.timestamp, sinceDate)
      )),

    db
      .select({ count: sql<number>`count(*)` })
      .from(recommendations)
      .where(and(
        eq(recommendations.userId, userId),
        gte(recommendations.recommendedAt, sinceDate)
      )),
  ]);

  return NextResponse.json({
    overview: {
      totalListens: totalListens[0]?.count || 0,
      totalLikes: totalLikes[0]?.count || 0,
      totalSkips: totalSkips[0]?.count || 0,
      totalRecommendations: totalRecommendations[0]?.count || 0,
      period: `Last ${Math.floor((Date.now() - sinceDate.getTime()) / (1000 * 60 * 60 * 24))} days`,
    },
  });
}

async function getTopGenres(userId: string, sinceDate: Date) {
  // Get all tracks user listened to in the period
  const listenedTracks = await db
    .select({
      genres: tracks.genres,
    })
    .from(listeningHistory)
    .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
    .where(and(
      eq(listeningHistory.userId, userId),
      gte(listeningHistory.playedAt, sinceDate)
    ));

  // Count genre frequencies
  const genreCount = new Map<string, number>();
  for (const row of listenedTracks) {
    const genres = row.genres as string[];
    for (const genre of genres) {
      genreCount.set(genre, (genreCount.get(genre) || 0) + 1);
    }
  }

  const topGenres = Array.from(genreCount.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    topGenres,
  });
}

async function getListeningTrends(userId: string, sinceDate: Date) {
  const trends = await db
    .select({
      date: sql<string>`DATE(${listeningHistory.playedAt})`,
      count: sql<number>`count(*)`,
    })
    .from(listeningHistory)
    .where(and(
      eq(listeningHistory.userId, userId),
      gte(listeningHistory.playedAt, sinceDate)
    ))
    .groupBy(sql`DATE(${listeningHistory.playedAt})`)
    .orderBy(sql`DATE(${listeningHistory.playedAt})`);

  return NextResponse.json({
    trends,
  });
}

async function getRecommendationStats(userId: string) {
  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      accepted: sql<number>`count(*) FILTER (WHERE ${recommendations.accepted} = true)`,
      rejected: sql<number>`count(*) FILTER (WHERE ${recommendations.accepted} = false)`,
      pending: sql<number>`count(*) FILTER (WHERE ${recommendations.accepted} IS NULL)`,
    })
    .from(recommendations)
    .where(eq(recommendations.userId, userId));

  const result = stats[0] || { total: 0, accepted: 0, rejected: 0, pending: 0 };
  const acceptanceRate = result.total > 0
    ? ((result.accepted / result.total) * 100).toFixed(1)
    : 0;

  return NextResponse.json({
    stats: {
      ...result,
      acceptanceRate: `${acceptanceRate}%`,
    },
  });
}
