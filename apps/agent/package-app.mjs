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

// 3. 현재 Node 바이너리 동봉(빌드한 OS/arch용 — CI가 각 OS 러너에서 빌드). Windows는 node.exe.
const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(process.execPath, resolve(out, nodeName));
if (process.platform !== "win32") {
  chmodSync(resolve(out, nodeName), 0o755);
}
console.log(`③ Node 바이너리 동봉(${nodeName})`);

// 4. 런처 — 두 OS용. QUALIFLOW_HOME + QUALIFLOW_CLOUD_URL(설치본은 클라우드를 가리킨다) 세팅 후 실행.
// ★CLOUD_URL: 지금은 qualiflow.meowti.kr. 통합이 buyer-crm으로 넘어가면 그 도메인(crm.thedozers.com 등)으로 바꾼다.
//   둘 다 미리 설정된 env가 있으면 그걸 우선(:- 기본값).
const CLOUD_URL = "https://qualiflow.meowti.kr";
writeFileSync(
  resolve(out, "run.sh"),
  `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QUALIFLOW_HOME="\${QUALIFLOW_HOME:-$HOME/.qualiflow}"
export QUALIFLOW_CLOUD_URL="\${QUALIFLOW_CLOUD_URL:-${CLOUD_URL}}"
mkdir -p "$QUALIFLOW_HOME"
exec "$DIR/node" "$DIR/agent.mjs" "$@"
`
);
if (process.platform !== "win32") {
  chmodSync(resolve(out, "run.sh"), 0o755);
}
writeFileSync(
  resolve(out, "run.cmd"),
  `@echo off\r\nset "QUALIFLOW_HOME=%USERPROFILE%\\.qualiflow"\r\nif not defined QUALIFLOW_CLOUD_URL set "QUALIFLOW_CLOUD_URL=${CLOUD_URL}"\r\nif not exist "%QUALIFLOW_HOME%" mkdir "%QUALIFLOW_HOME%"\r\n"%~dp0node.exe" "%~dp0agent.mjs" %*\r\n`
);

console.log("✅ 배포 폴더 완성: apps/agent/dist/package/  →  run.sh / run.cmd <명령>");
