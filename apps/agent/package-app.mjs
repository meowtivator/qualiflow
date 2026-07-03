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

import { ESBUILD_OPTIONS, EXTERNALS } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "dist/package");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. 번들 — 옵션은 build.mjs(단일 출처)와 동일, 진입/출력 경로만 배포용 절대경로로.
await build({
  ...ESBUILD_OPTIONS,
  entryPoints: [resolve(here, "src/cli.ts")],
  outfile: resolve(out, "agent.mjs"),
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

// 4. 런처 — 두 OS용. QUALIFLOW_HOME + QUALIFLOW_CLOUD_URL + (있으면)텔레그램 api 세팅 후 실행.
// ★CLOUD_URL은 공개값(레포에 박아도 OK). 텔레그램 api_id/hash는 '빌드 env'에서만 읽는다(레포에 시크릿 안 박힘).
//   빌드 시 TELEGRAM_API_ID/HASH 를 주면 설치본 런처에 주입돼, 대표는 전화번호+코드만 넣으면 된다.
//   (설치본에 동봉되면 노출됨 — 단일 대표/데모 한정. 미리 설정된 env가 있으면 그걸 우선.)
const CLOUD_URL = process.env.QUALIFLOW_CLOUD_URL || "https://crm.thedozers.com";
const TG_API_ID = process.env.TELEGRAM_API_ID || "";
const TG_API_HASH = process.env.TELEGRAM_API_HASH || "";
// 설치본 버전 = 릴리스 태그의 X.Y.Z. 우선순위: AGENT_VERSION env(릴리스 CI가 태그로 지정) →
// 로컬 git 최신 agent-v* 태그 → "dev". 이 값을 런처에 QUALIFLOW_AGENT_VERSION 으로 주입한다.
const AGENT_VERSION = resolveAgentVersion();
console.log(`④ 버전 주입: ${AGENT_VERSION}`);
writeFileSync(
  resolve(out, "run.sh"),
  `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export QUALIFLOW_HOME="\${QUALIFLOW_HOME:-$HOME/.qualiflow}"
export QUALIFLOW_CLOUD_URL="\${QUALIFLOW_CLOUD_URL:-${CLOUD_URL}}"
export QUALIFLOW_AGENT_VERSION="\${QUALIFLOW_AGENT_VERSION:-${AGENT_VERSION}}"
export QUALIFLOW_WATCH_INTERVAL_MS="\${QUALIFLOW_WATCH_INTERVAL_MS:-60000}"
export TELEGRAM_API_ID="\${TELEGRAM_API_ID:-${TG_API_ID}}"
export TELEGRAM_API_HASH="\${TELEGRAM_API_HASH:-${TG_API_HASH}}"
mkdir -p "$QUALIFLOW_HOME"
exec "$DIR/node" "$DIR/agent.mjs" "$@"
`
);
if (process.platform !== "win32") {
  chmodSync(resolve(out, "run.sh"), 0o755);
}
writeFileSync(
  resolve(out, "run.cmd"),
  `@echo off\r\nset "QUALIFLOW_HOME=%USERPROFILE%\\.qualiflow"\r\nif not defined QUALIFLOW_CLOUD_URL set "QUALIFLOW_CLOUD_URL=${CLOUD_URL}"\r\nif not defined QUALIFLOW_AGENT_VERSION set "QUALIFLOW_AGENT_VERSION=${AGENT_VERSION}"\r\nif not defined QUALIFLOW_WATCH_INTERVAL_MS set "QUALIFLOW_WATCH_INTERVAL_MS=60000"\r\nif not defined TELEGRAM_API_ID set "TELEGRAM_API_ID=${TG_API_ID}"\r\nif not defined TELEGRAM_API_HASH set "TELEGRAM_API_HASH=${TG_API_HASH}"\r\nif not exist "%QUALIFLOW_HOME%" mkdir "%QUALIFLOW_HOME%"\r\n"%~dp0node.exe" "%~dp0agent.mjs" %*\r\n`
);

// 릴리스 태그 → 버전 문자열. env(CI) 우선, 없으면 로컬 git 태그, 둘 다 없으면 "dev".
function resolveAgentVersion() {
  const fromEnv = (process.env.AGENT_VERSION || "").trim().replace(/^agent-v/, "");
  if (fromEnv) return fromEnv;
  try {
    const tag = execSync("git describe --tags --abbrev=0 --match 'agent-v*'", { cwd: here, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (tag) return tag.replace(/^agent-v/, "");
  } catch {
    // git 없음/태그 없음 — dev 로 둔다(웹이 "미배포"로 처리).
  }
  return "dev";
}

console.log("✅ 배포 폴더 완성: apps/agent/dist/package/  →  run.sh / run.cmd <명령>");
