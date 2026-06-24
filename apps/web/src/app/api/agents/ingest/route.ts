// POST /api/agents/ingest — 에이전트가 정규화된 대화를 올린다(토큰 인증 + DB upsert).
// Bearer 토큰을 HMAC 해시해서 ingest_conversations(SECURITY DEFINER)에 넘긴다. workspace_id는 함수가
// 토큰으로 직접 도출하므로 클라이언트가 남의 워크스페이스로 못 쓴다. 멱등(messages 유니크)이라 재호출 안전.
// 본문: { channel, accountLabel, conversations: [{ threadId, contact:{id,name,handle?}, messages:[...] }] }

import { NextResponse } from "next/server";

import { hmacHash, isPairingConfigured } from "@/lib/agents/pairing";
import { createClient } from "@/lib/supabase/server";

type IngestBody = {
  channel?: unknown;
  accountLabel?: unknown;
  conversations?: unknown;
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim() || null;
}

export async function POST(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json({ ok: false, message: "서버에 페어링 시크릿이 설정되지 않았습니다." }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, message: "에이전트 토큰이 필요합니다." }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ ok: false, message: "본문 JSON을 읽을 수 없습니다." }, { status: 400 });
  }

  const channel = typeof body.channel === "string" ? body.channel.trim() : "";
  const accountLabel = typeof body.accountLabel === "string" ? body.accountLabel.trim() : "";
  const conversations = body.conversations;
  if (!channel || !accountLabel || !Array.isArray(conversations)) {
    return NextResponse.json(
      { ok: false, message: "channel, accountLabel, conversations(배열)가 필요합니다." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ingest_conversations", {
    p_token_hash: hmacHash(token),
    p_channel: channel,
    p_account_label: accountLabel,
    p_conversations: conversations
  });

  if (error) {
    const invalidToken = error.message?.includes("invalid agent token");
    return NextResponse.json(
      { ok: false, message: invalidToken ? "유효하지 않은 에이전트 토큰입니다." : "인그est에 실패했습니다." },
      { status: invalidToken ? 401 : 400 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    leadsCreated: row?.leads_created ?? 0,
    threadsCreated: row?.threads_created ?? 0,
    messagesCreated: row?.messages_created ?? 0
  });
}
