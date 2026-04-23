import { NextResponse } from "next/server";
import { resolveServerGatewayUrl } from "@/lib/runtime-config";

export async function GET() {
  const gateway = resolveServerGatewayUrl();
  if (!gateway.url) {
    return NextResponse.json(
      {
        status: "unreachable",
        error: gateway.error ?? "Gateway URL is not configured",
      },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`${gateway.url}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { status: "unhealthy", error: `Gateway returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        status: "unreachable",
        error: error instanceof Error ? error.message : "Failed to connect to gateway",
      },
      { status: 503 },
    );
  }
}
