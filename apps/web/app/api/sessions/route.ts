import { NextRequest } from "next/server";
import { proxyGateway, proxyGatewayGet } from "../_gateway";

export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/sessions");
}

export async function DELETE(request: NextRequest) {
  return proxyGateway(request, "/api/sessions", { method: "DELETE" });
}
