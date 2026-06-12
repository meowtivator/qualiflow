import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@qualiflow/core",
    "@qualiflow/adapter-mock",
    "@qualiflow/adapter-alibaba",
    "@qualiflow/adapter-chat"
  ]
};

export default nextConfig;
