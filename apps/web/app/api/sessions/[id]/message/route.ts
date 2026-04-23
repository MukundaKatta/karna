import { NextRequest } from "next/server";
import { proxyGateway } from "../../../_gateway";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyGateway(request, `/api/sessions/${id}/message`, { method: "POST" });
}
