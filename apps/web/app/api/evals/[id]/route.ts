import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../../_gateway";

/**
 * Eval results data API — per-run detail (issue #574).
 *
 * Proxies to the gateway for the full result of a single eval run, including
 * every case's outcome. The gateway store is pluggable (DB / JSONL / memory);
 * this route only forwards by id.
 *
 * Response JSON shape:
 * {
 *   id: string,
 *   suite: string,
 *   status: "passed" | "failed" | "running" | "error",
 *   model: string,
 *   startedAt: number,
 *   finishedAt: number | null,
 *   durationMs: number | null,
 *   totalCases: number,
 *   passedCases: number,
 *   failedCases: number,
 *   score: number,
 *   totalCostUsd: number,
 *   cases: Array<{
 *     id: string,
 *     name: string,
 *     status: "passed" | "failed" | "error",
 *     input: string,
 *     expected: string | null,
 *     actual: string | null,
 *     scores: Record<string, number>,  // metric name -> value
 *     durationMs: number,
 *     costUsd: number,
 *     error: string | null
 *   }>
 * }
 *
 * Returns the gateway's 404 verbatim when the run id is unknown.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/evals/${id}`);
}
