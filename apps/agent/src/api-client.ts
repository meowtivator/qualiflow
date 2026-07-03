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

// /api/agents/me 응답 모양(계약). telegram 은 클라우드가 붙여줄 수도, 아닐 수도 있다(bpd 레인이 채움).
type AgentMeResponse = {
  ok?: boolean;
  agentId?: string;
  workspaceId?: string;
  telegram?: { apiId?: string | null; apiHash?: string | null } | null;
};

// 서버에 자기 신원을 물어 연결을 점검한다(status 등에서 사용). 실패 시 null. me() 원본을 재사용하려는
// 곳(env 하이드레이트)을 위해 telegram 필드까지 그대로 담아 돌려준다.
export async function fetchAgentIdentity(): Promise<
  { agentId: string; workspaceId: string; telegram?: AgentMeResponse["telegram"] } | null
> {
  const response = await authedFetch("/api/agents/me");
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as AgentMeResponse;
  if (!data.ok || !data.agentId || !data.workspaceId) {
    return null;
  }
  return { agentId: data.agentId, workspaceId: data.workspaceId, telegram: data.telegram };
}

// 클라우드(우리 서버, verifyAgent 로 인증된 CLOUD_BASE_URL)에서 텔레그램 자격증명을 받아 process.env 에
// 주입한다. ★로컬(.env.local/셸)에 이미 있으면 절대 덮어쓰지 않는다 — 개발자 오버라이드 보존.
// 미페어링·네트워크 실패·필드 부재는 모두 조용히 무시(best-effort): 텔레그램 외 명령까지 막지 않는다.
export async function hydrateEnvFromCloud(): Promise<void> {
  if (process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH) {
    return; // 로컬 값이 우선 — 클라우드를 부르지도 않는다.
  }
  try {
    const identity = await fetchAgentIdentity();
    const tg = identity?.telegram;
    if (!tg) {
      return;
    }
    if (tg.apiId && !process.env.TELEGRAM_API_ID) {
      process.env.TELEGRAM_API_ID = tg.apiId;
    }
    if (tg.apiHash && !process.env.TELEGRAM_API_HASH) {
      process.env.TELEGRAM_API_HASH = tg.apiHash;
    }
  } catch {
    // 미페어링(NotPairedError)·네트워크 오류 등 — 무시. 텔레그램은 로컬 env 로 폴백된다.
  }
}
