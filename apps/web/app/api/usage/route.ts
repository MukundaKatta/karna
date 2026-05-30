import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../_gateway";

/**
 * Usage dashboard data API (issue #579).
 *
 * Proxies to the gateway's usage endpoint, returning token/cost usage broken
 * down by model, user, and channel over a time range — backing the dedicated
 * usage dashboard (distinct from the broader analytics overview).
 *
 * Query params (all optional, forwarded verbatim to the gateway):
 *   - from:        epoch ms lower bound for the time range
 *   - to:          epoch ms upper bound for the time range
 *   - granularity: "hour" | "day" | "week" for the time-series buckets
 *   - userId:      restrict to a single user
 *   - channel:     restrict to a single channel (e.g. "telegram", "web")
 *
 * Response JSON shape:
 * {
 *   range: { from: number; to: number; granularity: "hour"|"day"|"week" },
 *   summary: {
 *     totalTokens: number,
 *     totalInputTokens: number,
 *     totalOutputTokens: number,
 *     totalCostUsd: number,
 *     totalMessages: number,
 *     activeUsers: number
 *   },
 *   timeSeries: Array<{
 *     timestamp: number,
 *     tokens: number,
 *     costUsd: number,
 *     messages: number
 *   }>,
 *   byModel:   Array<{ model: string; tokens: number; costUsd: number; messages: number }>,
 *   byUser:    Array<{ userId: string; tokens: number; costUsd: number; messages: number }>,
 *   byChannel: Array<{ channel: string; tokens: number; costUsd: number; messages: number }>
 * }
 */
export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/usage");
}
