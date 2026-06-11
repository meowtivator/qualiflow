import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@qualiflow/core", "@qualiflow/adapter-mock", "@qualiflow/adapter-alibaba"]
};

export default nextConfig;
