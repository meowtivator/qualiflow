// 에이전트 명령 채널(토큰 인증).
//   GET  /api/agents/commands           — 롱폴: 자기 워크스페이스의 pending 명령을 원자적 claim해서 돌려준다.
//                                          비어 있으면 최대 ~25초 대기하다 명령이 생기면 즉시 반환(없으면 빈 배열).
//   POST /api/agents/commands           — 결과 보고: { commandId, status: 'done'|'failed', result }
// 보안: Bearer 토큰 → hmacHash → SDF가 토큰으로 workspace 도출(스푸핑 차단). middleware PUBLIC_PATHS 등록.

import { setTimeout as sleep } from "node:timers/promises";
import { NextResponse } from "next/server";

import { agentTokenErrorResponse, bearerToken } from "@/lib/agents/agent-request";
import { hmacHash, isPairingConfigured } from "@/lib/agents/pairing";
import { createClient } from "@/lib/supabase/server";

const LONG_POLL_MS = 25_000;
const POLL_INTERVAL_MS = 2_000;

export async function GET(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json({ ok: false, message: "서버에 페어링 시크릿이 없습니다." }, { status: 503 });
  }
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, message: "에이전트 토큰이 필요합니다." }, { status: 401 });
  }

  const supabase = await createClient();
  const tokenHash = hmacHash(token);
  const deadline = Date.now() + LONG_POLL_MS;

  for (;;) {
    const { data, error } = await supabase.rpc("claim_agent_commands", { p_token_hash: tokenHash, p_limit: 10 });
    if (error) {
      return agentTokenErrorResponse(error, "명령 조회 실패.");
    }
    const commands = Array.isArray(data) ? data : [];
    if (commands.length > 0 || Date.now() >= deadline) {
      return NextResponse.json({ ok: true, commands });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

type CompleteBody = {
  commandId?: unknown;
  status?: unknown;
  result?: unknown;
};

export async function POST(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json({ ok: false, message: "서버에 페어링 시크릿이 없습니다." }, { status: 503 });
  }
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, message: "에이전트 토큰이 필요합니다." }, { status: 401 });
  }

  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ ok: false, message: "본문 JSON을 읽을 수 없습니다." }, { status: 400 });
  }

  const commandId = typeof body.commandId === "string" ? body.commandId : "";
  const status = body.status === "done" || body.status === "failed" ? body.status : "";
  if (!commandId || !status) {
    return NextResponse.json({ ok: false, message: "commandId, status('done'|'failed')가 필요합니다." }, { status: 400 });
  }
  const result = body.result && typeof body.result === "object" ? body.result : {};

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_agent_command", {
    p_token_hash: hmacHash(token),
    p_command_id: commandId,
    p_status: status,
    p_result: result
  });
  if (error) {
    return agentTokenErrorResponse(error, "결과 보고 실패.");
  }
  return NextResponse.json({ ok: true, updated: data === true });
}
