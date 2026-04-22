import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";

export async function proxyGatewayGet(
  request: NextRequest,
  path: string,
  timeoutMs = 10_000,
): Promise<NextResponse> {
  try {
    const search = request.nextUrl.searchParams.toString();
    const url = `${GATEWAY_URL}${path}${search ? `?${search}` : ""}`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: request.headers.get("accept")
        ? { accept: request.headers.get("accept") as string }
        : undefined,
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `Failed to fetch ${path}` },
      { status: 503 },
    );
  }
}
