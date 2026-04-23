import { NextRequest } from "next/server";
import { proxyGateway, proxyGatewayGet } from "../../../_gateway";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/sessions/${id}/history`);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGateway(request, `/api/sessions/${id}/history`, { method: "DELETE" });
}
