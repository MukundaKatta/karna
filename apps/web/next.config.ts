import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../../"),
  transpilePackages: ["@karna/shared"],
};

export default nextConfig;
