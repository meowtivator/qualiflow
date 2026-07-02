import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ⚠️ 떠도는 lockfile(예: 홈 디렉터리의 ~/pnpm-lock.yaml) 때문에 Next가 워크스페이스 루트를
  //    홈으로 오인하면, Turbopack이 홈 전체를 스캔하려다 페이지 컴파일이 사실상 멈춘다.
  //    루트를 이 레포(next dev의 cwd=apps/web 기준 ../..)로 못박아 그 오인을 막는다.
  turbopack: {
    root: path.resolve(process.cwd(), "..", "..")
  },
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
