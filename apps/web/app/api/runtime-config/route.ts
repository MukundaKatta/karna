import { NextResponse } from "next/server";
import { resolveBrowserRuntimeConfig } from "@/lib/runtime-config";

export async function GET() {
  const config = resolveBrowserRuntimeConfig();

  return NextResponse.json(
    {
      ...config,
      configured: Boolean(config.gatewayUrl && config.webSocketUrl),
    },
    { status: config.gatewayUrl && config.webSocketUrl ? 200 : 503 },
  );
}
