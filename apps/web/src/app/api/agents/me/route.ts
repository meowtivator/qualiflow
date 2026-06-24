// GET /api/agents/me — 에이전트가 자기 토큰으로 신원을 확인한다(연결 점검 + 하트비트).
// Bearer 토큰을 verifyAgent가 HMAC 검증 → 일치하면 신원(agentId/workspaceId), 아니면 401.
// 로그인 세션이 아니라 토큰으로 인증하므로 미들웨어 PUBLIC_PATHS에 등록돼 세션 게이트를 건너뛴다.

import { NextResponse } from "next/server";

import { verifyAgent } from "@/lib/agents/verify-agent";

export async function GET(request: Request) {
  const identity = await verifyAgent(request);
  if (!identity) {
    return NextResponse.json({ ok: false, message: "유효하지 않은 에이전트 토큰입니다." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, agentId: identity.agentId, workspaceId: identity.workspaceId });
}
