// 에이전트는 별도 프로세스라 Next처럼 .env.local을 자동 로드하지 않는다.
// 텔레그램 키 등(TELEGRAM_API_ID/HASH)을 apps/web/.env.local 에 두면 읽어 쓰도록 간단 로더를 둔다.
// Node 내장 process.loadEnvFile 사용(≥20.12) — 이미 셸 env에 있는 키는 덮어쓰지 않는다(검증됨).

import { resolve } from "node:path";

import { REPO_ROOT } from "./accounts";

export function loadLocalEnv(): void {
  // 배포본은 QUALIFLOW_HOME/.env.local 을 우선 읽는다(TELEGRAM_* 등). 개발에선 레포의 .env.local.
  const home = process.env.QUALIFLOW_HOME;
  const files = [
    ...(home ? [resolve(home, ".env.local")] : []),
    resolve(REPO_ROOT, "apps/web/.env.local"),
    resolve(REPO_ROOT, ".env.local")
  ];
  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch {
      // 파일 없으면 건너뜀
    }
  }
}
