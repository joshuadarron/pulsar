import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pulsar/shared"],
  serverExternalPackages: ["puppeteer", "pg", "neo4j-driver"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
