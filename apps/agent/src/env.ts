// 에이전트는 별도 프로세스라 Next처럼 .env.local을 자동 로드하지 않는다.
// 텔레그램 키 등(TELEGRAM_API_ID/HASH)을 apps/web/.env.local 에 두면 읽어 쓰도록 간단 로더를 둔다.
// (이미 셸 env에 있으면 덮어쓰지 않는다.)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

export function loadLocalEnv(): void {
  const files = [resolve(REPO_ROOT, "apps/web/.env.local"), resolve(REPO_ROOT, ".env.local")];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // 파일 없으면 건너뜀
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq < 0) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
