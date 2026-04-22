import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../../_gateway";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGatewayGet(request, `/api/sessions/${id}`);
}
