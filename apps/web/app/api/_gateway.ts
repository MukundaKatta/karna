import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";

export async function proxyGatewayGet(
  request: NextRequest,
  path: string,
  timeoutMs = 10_000,
): Promise<NextResponse> {
  return proxyGateway(request, path, { timeoutMs, method: "GET" });
}

export async function proxyGateway(
  request: NextRequest,
  path: string,
  options: {
    method?: string;
    timeoutMs?: number;
  } = {},
): Promise<NextResponse> {
  try {
    const method = options.method ?? request.method;
    const search = request.nextUrl.searchParams.toString();
    const url = `${GATEWAY_URL}${path}${search ? `?${search}` : ""}`;
    const body =
      method === "GET" || method === "HEAD" ? undefined : await request.text();
    const response = await fetch(url, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      headers: {
        ...(request.headers.get("accept")
          ? { accept: request.headers.get("accept") as string }
          : {}),
        ...(request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type") as string }
          : {}),
      },
      body,
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
