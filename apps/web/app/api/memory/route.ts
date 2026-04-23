import { NextRequest } from "next/server";
import { proxyGateway, proxyGatewayGet } from "../_gateway";

export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/memory");
}

export async function POST(request: NextRequest) {
  return proxyGateway(request, "/api/memory", { method: "POST" });
}
