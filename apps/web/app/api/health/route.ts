import { NextResponse } from "next/server";
import { resolvePublicGatewayUrl, resolvePublicWebSocketUrl, resolveServerGatewayUrl } from "@/lib/runtime-config";

export async function GET() {
  const serverGateway = resolveServerGatewayUrl();
  const publicGateway = resolvePublicGatewayUrl();
  const publicWs = resolvePublicWebSocketUrl();

  const configured = Boolean(serverGateway.url && publicGateway.url && publicWs.url);

  return NextResponse.json(
    {
      status: configured ? "healthy" : "degraded",
      service: "karna-web",
      configured,
      gateway: {
        serverUrlConfigured: Boolean(serverGateway.url),
        publicUrlConfigured: Boolean(publicGateway.url),
        webSocketUrlConfigured: Boolean(publicWs.url),
      },
      errors: [serverGateway.error, publicGateway.error, publicWs.error].filter(Boolean),
      timestamp: new Date().toISOString(),
    },
    { status: configured ? 200 : 200 },
  );
}
