// 클라우드 서버에 '토큰 인증'으로 요청하는 클라이언트.
// 저장된 에이전트 토큰(token-store)을 Authorization: Bearer 로 붙여 보낸다. 토큰이 없으면 NotPairedError.
// 베이스 URL은 config.ts의 CLOUD_BASE_URL(QUALIFLOW_CLOUD_URL, 기본 localhost:3000).

import { CLOUD_BASE_URL } from "./config";
import { loadToken } from "./token-store";

export class NotPairedError extends Error {
  constructor() {
    super("페어링되지 않았습니다. 먼저 'pair <코드>'를 실행하세요.");
    this.name = "NotPairedError";
  }
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await loadToken();
  if (!token) {
    throw new NotPairedError();
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${CLOUD_BASE_URL}${path}`, { ...init, headers });
}

// 서버에 자기 신원을 물어 연결을 점검한다(status 등에서 사용). 실패 시 null.
export async function fetchAgentIdentity(): Promise<{ agentId: string; workspaceId: string } | null> {
  const response = await authedFetch("/api/agents/me");
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { ok?: boolean; agentId?: string; workspaceId?: string };
  if (!data.ok || !data.agentId || !data.workspaceId) {
    return null;
  }
  return { agentId: data.agentId, workspaceId: data.workspaceId };
}
