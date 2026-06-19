import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "cdn.simpleicons.org",
        protocol: "https"
      }
    ]
  },
  transpilePackages: [
    "@qualiflow/core",
    "@qualiflow/adapter-mock",
    "@qualiflow/adapter-alibaba",
    "@qualiflow/adapter-chat"
  ]
};

export default nextConfig;
