import { NextRequest, NextResponse } from "next/server";
import {
  BETA_SESSION_COOKIE_NAME,
  createBetaSessionToken,
  getBetaSessionCookieOptions,
  isBetaAuthEnabled,
  validateBetaAccessCode,
} from "@/lib/beta-auth";

export async function POST(request: NextRequest) {
  if (!isBetaAuthEnabled()) {
    return NextResponse.json(
      { error: "Beta access is not enabled for this deployment." },
      { status: 409 },
    );
  }

  let accessCode = "";

  try {
    const payload = (await request.json()) as { accessCode?: string };
    accessCode = typeof payload.accessCode === "string" ? payload.accessCode : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!validateBetaAccessCode(accessCode)) {
    return NextResponse.json({ error: "Invalid beta access code." }, { status: 401 });
  }

  const token = await createBetaSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "Beta session signing is not configured." },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(BETA_SESSION_COOKIE_NAME, token, getBetaSessionCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(BETA_SESSION_COOKIE_NAME, "", {
    ...getBetaSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

