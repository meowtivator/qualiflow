// QualiFlow 에이전트 단일 번들 — esbuild로 cli.ts와 의존성을 한 파일로 묶는다.
//   - 번들: 에이전트 코드 + 워크스페이스 패키지(@qualiflow/*) + 순수 JS 의존성 → 워크스페이스 해석 불필요.
//   - external: 네이티브/대형 의존성(playwright-core, baileys, telegram)은 번들 안 하고 런타임에
//     node_modules에서 require. (네이티브 .node는 JS로 못 묶고, 이들은 동적 require가 많아 번들이 깨짐.)
//   결과: dist/agent.mjs (node dist/agent.mjs <명령>).

import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/agent.mjs",
  // playwright-core/baileys는 네이티브·동적 require가 많아 external(런타임 require). telegram(gramjs)은
  // 순수 JS + 하위경로 import라 번들에 포함시켜 빌드 때 해석(ESM 확장자 문제 회피).
  external: ["playwright-core", "@whiskeysockets/baileys"],
  // ESM 출력에서 일부 CJS 의존성이 쓰는 require/__dirname을 위해 shim을 머리에 단다.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
  },
  logLevel: "info"
});

console.log("✅ 번들 완료: apps/agent/dist/agent.mjs");
