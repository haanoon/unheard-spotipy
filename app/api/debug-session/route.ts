import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.json({
      error: "No token found",
      cookies: request.cookies.getAll().map(c => ({ name: c.name, hasValue: !!c.value })),
    });
  }

  return NextResponse.json({
    hasAccessToken: !!token.accessToken,
    accessTokenLength: (token.accessToken as string)?.length || 0,
    hasRefreshToken: !!token.refreshToken,
    expiresAt: token.expiresAt,
    error: token.error,
  });
}