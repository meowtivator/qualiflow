// POST /api/agents/pair — 에이전트(무인증)가 페어링 코드를 에이전트 토큰으로 교환한다.
// 이 라우트는 로그인 세션이 없으므로 middleware의 PUBLIC_PATHS에 등록돼 있다(코드가 곧 자격).
//
// 권한상승(코드 조회 + agents 행 생성 + 코드 소비)은 전부 SECURITY DEFINER 함수 pair_agent 안에서만
// 일어난다. 이 라우트는 anon(publishable) 키만 쓴다 → 만능 service-role 키가 웹 티어에 없다.
// pepper로 만든 해시만 함수에 넘기고, 평문 토큰은 응답으로 1회만 돌려준다.

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { generateAgentToken, hmacHash, isPairingConfigured, normalizePairingCode } from "@/lib/agents/pairing";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type PairRequest = {
  code?: unknown;
  label?: unknown;
  platform?: unknown;
};

// 프록시 뒤 클라이언트 IP(레이트리밋 키). 신뢰 가능한 첫 값만 취한다.
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json(
      { ok: false, message: "서버에 페어링 시크릿이 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  let payload: PairRequest;
  try {
    payload = (await request.json()) as PairRequest;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const rawCode = typeof payload.code === "string" ? payload.code : "";
  if (!rawCode.trim()) {
    return NextResponse.json({ ok: false, message: "페어링 코드가 필요합니다." }, { status: 400 });
  }

  const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 80) || null : null;
  const platform = typeof payload.platform === "string" ? payload.platform.trim().slice(0, 40) || null : null;

  const config = getSupabasePublicConfig();
  if (!config) {
    return NextResponse.json({ ok: false, message: "Supabase가 설정되지 않았습니다." }, { status: 500 });
  }

  const codeHash = hmacHash(normalizePairingCode(rawCode));
  const agentToken = generateAgentToken();
  const tokenHash = hmacHash(agentToken);

  // 무인증 호출 → anon(publishable) 키. 권한상승은 SECURITY DEFINER 함수 안에서만.
  const supabase = createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });

  const { data, error } = await supabase.rpc("pair_agent", {
    p_code_hash: codeHash,
    p_token_hash: tokenHash,
    p_label: label,
    p_platform: platform,
    p_ip: getClientIp(request)
  });

  if (error) {
    const rateLimited = error.message?.includes("rate limit");
    // 메시지 일반화: 코드 없음/만료/사용됨을 구분해 알려주지 않는다(열거 공격 방지).
    return NextResponse.json(
      {
        ok: false,
        message: rateLimited ? "시도가 너무 많습니다. 잠시 후 다시 시도하세요." : "유효하지 않거나 만료된 페어링 코드입니다."
      },
      { status: rateLimited ? 429 : 400 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.paired_agent_id) {
    return NextResponse.json({ ok: false, message: "페어링에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    agentId: row.paired_agent_id,
    agentToken, // 평문 1회 — 에이전트가 OS 키체인에 저장(PR3). 서버는 해시만 보관.
    workspaceId: row.paired_workspace_id
  });
}
