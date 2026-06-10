import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@qualiflow/core", "@qualiflow/adapter-mock"]
};

export default nextConfig;
