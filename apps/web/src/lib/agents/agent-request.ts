// 에이전트 요청 공용 유틸(서버 전용) — me/ingest/commands 라우트 + verify-agent가 공유.
//   복붙되던 Bearer 토큰 추출 + RPC 에러→응답 변환을 한 곳으로.

import { NextResponse } from "next/server";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim() || null;
}

// 에이전트 SDF 호출 에러를 응답으로. 토큰 무효면 401, 그 외 fallbackMessage로 400.
export function agentTokenErrorResponse(error: { message?: string } | null, fallbackMessage: string) {
  const invalid = error?.message?.includes("invalid agent token") ?? false;
  return NextResponse.json(
    { ok: false, message: invalid ? "유효하지 않은 에이전트 토큰입니다." : fallbackMessage },
    { status: invalid ? 401 : 400 }
  );
}
