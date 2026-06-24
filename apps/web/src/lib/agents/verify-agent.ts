// 에이전트 요청 인증 — Authorization: Bearer <토큰>을 HMAC 해시해서 resolve_agent_by_token으로 신원 확인.
// ★평문 토큰은 비교/저장하지 않는다. hmacHash(pepper)로 만든 해시만 함수에 넘기고, 함수가 DB의 token_hash와
//   대조한다(pepper는 서버 env에만). 성공 시 {agentId, workspaceId}, 실패 시 null.
//   서버 전용 — 클라이언트로 import 금지(pepper가 들어있는 pairing.ts에 의존).

import { bearerToken } from "@/lib/agents/agent-request";
import { hmacHash, isPairingConfigured } from "@/lib/agents/pairing";
import { createClient } from "@/lib/supabase/server";

export type AgentIdentity = { agentId: string; workspaceId: string };

export async function verifyAgent(request: Request): Promise<AgentIdentity | null> {
  if (!isPairingConfigured()) {
    return null; // pepper 미설정 → 검증 불가
  }
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_agent_by_token", {
    p_token_hash: hmacHash(token)
  });
  if (error) {
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.agent_id || !row?.workspace_id) {
    return null;
  }
  return { agentId: row.agent_id, workspaceId: row.workspace_id };
}
