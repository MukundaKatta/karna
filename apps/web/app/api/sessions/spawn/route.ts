import { NextRequest } from "next/server";
import { proxyGateway } from "../../_gateway";

export async function POST(request: NextRequest) {
  return proxyGateway(request, "/api/sessions/spawn", { method: "POST" });
}
