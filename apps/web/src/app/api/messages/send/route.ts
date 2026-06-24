// POST /api/messages/send — 웹 사용자가 특정 thread에 답장을 보낸다.
// ★실제 발송은 에이전트가 한다. 여기선 thread로부터 발송에 필요한 정보를 뽑아 agent_commands에 '적재'만 한다.
//   에이전트가 롱폴(/api/agents/commands)로 가져가 채널로 보내고 결과를 보고한다.
// 인증: 로그인 사용자(JWT). RLS가 자기 워크스페이스 thread/connection만 보이게 + agent_commands 쓰기를 허용.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type SendBody = {
  threadId?: unknown;
  text?: unknown;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    return NextResponse.json({ ok: false, message: "본문 JSON을 읽을 수 없습니다." }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!threadId || !text) {
    return NextResponse.json({ ok: false, message: "threadId, text가 필요합니다." }, { status: 400 });
  }
  // 거대 payload 방지(명령 큐/롱폴 응답 비대화 차단). 일반 메시지엔 충분.
  if (text.length > 4000) {
    return NextResponse.json({ ok: false, message: "메시지가 너무 깁니다 (최대 4000자)." }, { status: 400 });
  }

  // thread(RLS로 내 워크스페이스만) → 채널/대상/워크스페이스.
  const { data: thread } = await supabase
    .from("threads")
    .select("id, workspace_id, channel_id, external_thread_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ ok: false, message: "대화를 찾을 수 없습니다." }, { status: 404 });
  }
  if (!thread.external_thread_id) {
    return NextResponse.json({ ok: false, message: "이 대화는 외부 식별자가 없어 발송 대상을 특정할 수 없습니다." }, { status: 400 });
  }

  // 이 채널에 연결된 계정(에이전트가 보유). agent_id 있는 것 우선.
  const { data: connection } = await supabase
    .from("channel_connections")
    .select("account_label, agent_id")
    .eq("workspace_id", thread.workspace_id)
    .eq("channel", thread.channel_id)
    .order("agent_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ ok: false, message: "이 채널에 연결된 계정이 없습니다." }, { status: 400 });
  }

  const { data: command, error } = await supabase
    .from("agent_commands")
    .insert({
      workspace_id: thread.workspace_id,
      agent_id: connection.agent_id ?? null,
      type: "send_message",
      payload: {
        threadId: thread.external_thread_id,
        channel: thread.channel_id,
        accountLabel: connection.account_label,
        recipient: thread.external_thread_id,
        text
      }
    })
    .select("id")
    .single();
  if (error || !command) {
    return NextResponse.json({ ok: false, message: "발송 명령 적재에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, commandId: command.id });
}
