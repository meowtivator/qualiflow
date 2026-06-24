// 에이전트 토큰 보관. 맥: `security` 키체인(generic password). 윈/리눅스: QUALIFLOW_HOME 밑 0600 파일.
//   ★토큰은 '내 PC에만' 머문다(서버로 안 감) — .auth 채널 세션과 동일한 로컬-온리 보안 경계.
//   윈/리눅스 파일은 0600(소유자만 읽기/쓰기). 소유자 결정(2026-06-24): 크로스OS 키체인은 네이티브
//   의존성/복잡도가 커서, 채널 세션과 같은 방식인 0600 파일로 통일. 더 강한 보안이 필요하면 OS
//   자격증명 관리자로 격상 가능(별도 작업).
// ⚠️ 맥은 토큰을 argv(-w)로 넘겨 ps에 잠깐 노출될 수 있다(단일 사용자 로컬 MVP 한정).

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVICE = "qualiflow-agent";
const ACCOUNT = "agent-token";

const isMac = process.platform === "darwin";

// 맥이 아닐 때 토큰을 둘 파일. QUALIFLOW_HOME(런처가 세팅, 기본 ~/.qualiflow) 밑.
function tokenFilePath(): string {
  const home = process.env.QUALIFLOW_HOME || join(homedir(), ".qualiflow");
  return join(home, "agent-token");
}

export async function saveToken(token: string): Promise<void> {
  if (isMac) {
    // -U: 기존 항목 있으면 갱신.
    await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", token]);
    return;
  }
  const file = tokenFilePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, token, { mode: 0o600 });
  await chmod(file, 0o600); // umask 영향 제거 — 소유자만 읽기/쓰기 보장
}

export async function loadToken(): Promise<string | null> {
  if (isMac) {
    try {
      const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      return stdout.trim() || null;
    } catch {
      return null; // 키체인에 없음
    }
  }
  try {
    const token = await readFile(tokenFilePath(), "utf8");
    return token.trim() || null;
  } catch {
    return null; // 파일 없음
  }
}

export async function clearToken(): Promise<void> {
  if (isMac) {
    await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]).catch(() => undefined);
    return;
  }
  await rm(tokenFilePath(), { force: true }).catch(() => undefined);
}
