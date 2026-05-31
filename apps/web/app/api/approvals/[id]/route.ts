import { NextRequest } from "next/server";
import { proxyGateway, proxyGatewayGet } from "../../_gateway";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/approvals/${id}`);
}

// POST a decision for a single approval: { decision: 'approve' | 'deny', args?: unknown }
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGateway(request, `/api/approvals/${id}`, { method: "POST" });
}
