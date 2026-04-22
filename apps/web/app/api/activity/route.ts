import { NextRequest } from "next/server";
import { proxyGatewayGet } from "../_gateway";

export async function GET(request: NextRequest) {
  return proxyGatewayGet(request, "/api/activity");
}
