import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const qs = searchParams.toString();
    const url = `${GATEWAY_URL}/api/sessions${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Gateway returned ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sessions" },
      { status: 503 },
    );
  }
}
