// 에이전트 토큰을 OS 키체인에 보관한다. ★평문 파일 금지(분산 보안 경계: 세션/토큰은 로컬 키체인).
// macOS: `security` 명령으로 login keychain의 generic password에 저장/조회.
// ⚠️ 다른 OS는 아직 미지원 — 설치형 GUI(Electron safeStorage) 단계에서 크로스OS로 확장한다.
// ⚠️ 토큰을 argv(-w)로 넘기므로 ps에 잠깐 노출될 수 있다. 단일 사용자 로컬 MVP 한정이며,
//    Electron safeStorage 단계에서 argv 노출 없이 처리한다.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVICE = "qualiflow-agent";
const ACCOUNT = "agent-token";

function ensureSupportedOs() {
  if (process.platform !== "darwin") {
    throw new Error("지금은 macOS 키체인만 지원합니다(설치형 단계에서 Windows/Linux 확장).");
  }
}

export async function saveToken(token: string): Promise<void> {
  ensureSupportedOs();
  // -U: 기존 항목 있으면 갱신.
  await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", token]);
}

export async function loadToken(): Promise<string | null> {
  ensureSupportedOs();
  try {
    const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    return stdout.trim() || null;
  } catch {
    return null; // 키체인에 없음
  }
}

export async function clearToken(): Promise<void> {
  ensureSupportedOs();
  await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]).catch(() => undefined);
}
