import { NextRequest, NextResponse } from "next/server";
import {
  BETA_SESSION_COOKIE_NAME,
  isBetaAuthEnabled,
  verifyBetaSessionToken,
} from "@/lib/beta-auth";

const PUBLIC_PATHS = new Set([
  "/",
  "/landing.html",
  "/privacy",
  "/terms",
  "/support",
  "/status",
  "/sign-in",
]);

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/gateway",
  "/api/runtime-config",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.has(pathname) || pathname.startsWith("/api/auth/beta");
}

function buildSignInRedirect(request: NextRequest): NextResponse {
  const signInUrl = new URL("/sign-in", request.url);
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (nextPath && nextPath !== "/sign-in") {
    signInUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(signInUrl);
}

export async function middleware(request: NextRequest) {
  if (!isBetaAuthEnabled()) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const sessionToken = request.cookies.get(BETA_SESSION_COOKIE_NAME)?.value;
  const hasSession = await verifyBetaSessionToken(sessionToken);

  if (pathname === "/sign-in") {
    if (hasSession) {
      const nextPath = request.nextUrl.searchParams.get("next");
      return NextResponse.redirect(new URL(nextPath || "/chat", request.url));
    }

    return NextResponse.next();
  }

  if (isPublicPath(pathname) || isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (hasSession) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required", code: "beta_access_required" },
      { status: 401 },
    );
  }

  return buildSignInRedirect(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};

