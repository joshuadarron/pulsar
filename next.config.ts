import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["puppeteer", "pg", "neo4j-driver"],
};

export default nextConfig;
