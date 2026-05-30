import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../../../_gateway";

/**
 * Session replay data API (issue #582).
 *
 * Returns the ordered reason/act/observe (ReAct) event stream for a session so
 * the UI can replay the agent's run step by step. Proxies to the gateway's
 * session replay/trace endpoint (mirrors the sessions/[id]/history route).
 *
 * Query params (all optional, forwarded verbatim to the gateway):
 *   - from:  epoch ms lower bound (resume a partial replay)
 *   - limit: max events to return
 *
 * Response JSON shape:
 * {
 *   sessionId: string,
 *   channelType: string,
 *   startedAt: number,   // epoch ms of the first event
 *   endedAt: number,     // epoch ms of the last event
 *   events: Array<{
 *     index: number,                          // 0-based ordinal in the stream
 *     timestamp: number,                      // epoch ms
 *     type: "reason" | "act" | "observe",
 *     // reason: model thinking / planning text for an iteration
 *     // act:    a tool invocation the model requested
 *     // observe: the tool result fed back to the model
 *     content: string,                        // human-readable text for the step
 *     iteration: number,                      // agent loop iteration (1..10)
 *     toolName?: string,                      // present for act / observe
 *     toolCallId?: string,                    // correlates act <-> observe
 *     arguments?: Record<string, unknown>,    // present for act
 *     result?: unknown,                       // present for observe
 *     durationMs?: number,                    // present for act / observe
 *     model?: string,                         // present for reason
 *     inputTokens?: number,                   // present for reason
 *     outputTokens?: number                   // present for reason
 *   }>
 * }
 *
 * Returns the gateway's 404 verbatim when the session id is unknown.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/sessions/${id}/replay`);
}
