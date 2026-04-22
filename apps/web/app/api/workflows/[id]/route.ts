import { NextRequest } from "next/server";
import { proxyGateway, proxyGatewayGet } from "../../_gateway";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/workflows/${id}`);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGateway(request, `/api/workflows/${id}`, { method: "PATCH" });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGateway(request, `/api/workflows/${id}`, { method: "DELETE" });
}
