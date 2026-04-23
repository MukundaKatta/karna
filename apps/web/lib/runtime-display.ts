export interface GatewayDisplayInfo {
  primaryUrl: string;
  publicUrl: string | null;
  bindAddress: string;
}

export function formatGatewayBindAddress(host: string, port: number): string {
  const normalizedHost = host.trim() || "0.0.0.0";
  return `http://${normalizedHost}:${port}`;
}

export function resolveGatewayDisplayInfo(
  host: string,
  port: number,
  publicGatewayUrl?: string | null,
): GatewayDisplayInfo {
  const bindAddress = formatGatewayBindAddress(host, port);
  const normalizedPublicUrl = publicGatewayUrl?.trim() || null;

  return {
    primaryUrl: normalizedPublicUrl ?? bindAddress,
    publicUrl: normalizedPublicUrl,
    bindAddress,
  };
}
