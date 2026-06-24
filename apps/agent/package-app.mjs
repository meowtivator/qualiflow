// QualiFlow 에이전트 — 배포 폴더(A안: 번들 + external node_modules + node 바이너리 + 런처) 생성.
// 결과: apps/agent/dist/package/  →  ./run.sh <명령>  으로 pnpm·레포·시스템 Node 없이 실행.
//   - agent.mjs        : esbuild 번들(에이전트 + 워크스페이스 + telegram)
//   - node             : 현재 OS/arch용 Node 바이너리(동봉 → 시스템 Node 불필요)
//   - node_modules/    : external 의존성(playwright-core, baileys) + 전이 의존성
//   - run.sh           : QUALIFLOW_HOME(~/.qualiflow) 세팅 후 ./node agent.mjs 실행
//
// ★데이터/세션은 QUALIFLOW_HOME(기본 ~/.qualiflow)에 쌓인다(레포 밖에서도 동작).

import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "dist/package");
const EXTERNALS = ["playwright-core", "@whiskeysockets/baileys"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. 번들
await build({
  entryPoints: [resolve(here, "src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: resolve(out, "agent.mjs"),
  external: EXTERNALS,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning"
});
console.log("① 번들 완료");

// 2. external 의존성만 담은 package.json + npm install(복사 가능한 flat node_modules)
const agentPkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const dependencies = Object.fromEntries(EXTERNALS.map((name) => [name, agentPkg.dependencies[name]]));
writeFileSync(
  resolve(out, "package.json"),
  `${JSON.stringify({ name: "qualiflow-agent-dist", private: true, type: "module", dependencies }, null, 2)}\n`
);
console.log("② external 의존성 설치 중(npm)...");
execSync("npm install --omit=dev --no-audit --no-fund", { cwd: out, stdio: "inherit" });

// 3. 현재 Node 바이너리 동봉(같은 OS/arch에서 시스템 Node 없이 실행)
copyFileSync(process.execPath, resolve(out, "node"));
chmodSync(resolve(out, "node"), 0o755);
console.log("③ node 바이너리 동봉");

// 4. 런처
writeFileSync(
  resolve(out, "run.sh"),
  `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QUALIFLOW_HOME="\${QUALIFLOW_HOME:-$HOME/.qualiflow}"
mkdir -p "$QUALIFLOW_HOME"
exec "$DIR/node" "$DIR/agent.mjs" "$@"
`
);
chmodSync(resolve(out, "run.sh"), 0o755);

console.log("✅ 배포 폴더 완성: apps/agent/dist/package/  →  ./run.sh <명령>");
