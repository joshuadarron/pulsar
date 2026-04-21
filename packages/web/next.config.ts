import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pulsar/shared"],
  serverExternalPackages: ["puppeteer", "pg", "neo4j-driver"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
