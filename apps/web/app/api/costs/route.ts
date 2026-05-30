import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../_gateway";

/**
 * Cost tracking API (issue #578).
 *
 * Proxies to the gateway's cost-aggregation endpoint, returning token and
 * USD cost aggregates broken down by user, session, tool, model, and time.
 *
 * Query params (all optional, forwarded verbatim to the gateway):
 *   - from:        epoch ms lower bound for the time range
 *   - to:          epoch ms upper bound for the time range
 *   - granularity: "hour" | "day" | "week" for the time-series buckets
 *   - groupBy:     "user" | "session" | "tool" | "model" (default: "model")
 *   - userId:      restrict to a single user
 *   - sessionId:   restrict to a single session
 *
 * Response JSON shape (mirrors the analytics route style):
 * {
 *   range: { from: number; to: number; granularity: "hour"|"day"|"week" },
 *   summary: {
 *     totalInputTokens: number,
 *     totalOutputTokens: number,
 *     totalTokens: number,
 *     totalCostUsd: number,
 *     requestCount: number
 *   },
 *   timeSeries: Array<{
 *     timestamp: number,
 *     inputTokens: number,
 *     outputTokens: number,
 *     tokens: number,
 *     costUsd: number
 *   }>,
 *   byUser:    Array<{ userId: string; tokens: number; costUsd: number; requests: number }>,
 *   bySession: Array<{ sessionId: string; tokens: number; costUsd: number; requests: number }>,
 *   byTool:    Array<{ tool: string; tokens: number; costUsd: number; calls: number }>,
 *   byModel:   Array<{ model: string; inputTokens: number; outputTokens: number; tokens: number; costUsd: number }>
 * }
 */
export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/costs");
}
