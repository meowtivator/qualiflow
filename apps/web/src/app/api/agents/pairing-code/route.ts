// POST /api/agents/pairing-code — 로그인된 웹 사용자가 페어링 코드를 발급한다.
// 코드 평문은 응답으로 1회만 나가고, DB엔 HMAC 해시만 들어간다. 발급은 사용자의 JWT로 호출하는
// SECURITY DEFINER 함수 issue_pairing_code(워크스페이스 확인 + 레이트리밋 + insert)가 처리한다.

import { NextResponse } from "next/server";

import { generatePairingCode, hmacHash, isPairingConfigured, normalizePairingCode } from "@/lib/agents/pairing";
import { createClient } from "@/lib/supabase/server";

type PairingCodeRequest = {
  label?: unknown;
};

export async function POST(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json(
      { ok: false, message: "서버에 페어링 시크릿(QUALIFLOW_PAIRING_PEPPER)이 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  let payload: PairingCodeRequest = {};
  try {
    payload = (await request.json()) as PairingCodeRequest;
  } catch {
    // 본문 없는 요청도 허용(label 선택).
  }

  const label = typeof payload.label === "string" && payload.label.trim() ? payload.label.trim().slice(0, 80) : null;

  // 로그인된 사용자 컨텍스트(쿠키)로 Supabase 호출 → 함수 안 auth.uid()가 동작.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  const code = generatePairingCode();
  const codeHash = hmacHash(normalizePairingCode(code));

  const { data, error } = await supabase.rpc("issue_pairing_code", {
    p_code_hash: codeHash,
    p_label: label
  });

  if (error) {
    const rateLimited = error.message?.includes("rate limit");
    return NextResponse.json(
      {
        ok: false,
        message: rateLimited
          ? "페어링 코드를 너무 자주 발급했습니다. 잠시 후 다시 시도하세요."
          : "페어링 코드 발급에 실패했습니다."
      },
      { status: rateLimited ? 429 : 400 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    ok: true,
    agentLabel: label,
    code, // 평문 1회 — 사용자가 에이전트에 입력. 서버는 해시만 보관.
    expiresAt: row?.pairing_expires_at ?? null
  });
}
