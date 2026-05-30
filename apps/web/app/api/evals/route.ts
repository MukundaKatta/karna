import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../_gateway";

/**
 * Eval results data API — list view (issue #574).
 *
 * Proxies to the gateway's eval-run store. The gateway is the pluggable
 * backend here: it may serve runs from a database, JSONL files, or an
 * in-memory store — this route is agnostic and simply forwards the request.
 *
 * Query params (all optional, forwarded verbatim to the gateway):
 *   - status: "passed" | "failed" | "running" | "error" filter
 *   - suite:  restrict to a named eval suite
 *   - limit:  page size
 *   - offset: pagination offset
 *
 * Response JSON shape:
 * {
 *   runs: Array<{
 *     id: string,
 *     suite: string,
 *     status: "passed" | "failed" | "running" | "error",
 *     model: string,
 *     startedAt: number,         // epoch ms
 *     finishedAt: number | null, // epoch ms, null while running
 *     durationMs: number | null,
 *     totalCases: number,
 *     passedCases: number,
 *     failedCases: number,
 *     score: number,             // 0..1 pass ratio
 *     totalCostUsd: number
 *   }>,
 *   total: number,
 *   hasMore: boolean
 * }
 */
export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/evals");
}
