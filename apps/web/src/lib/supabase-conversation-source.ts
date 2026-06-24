// 웹 인박스를 'DB(Supabase)'에서 읽는 ConversationSource. 에이전트가 ingest로 채운 leads/threads/messages를
// RLS(로그인 사용자의 워크스페이스)로 스코프해서 읽는다 → 화면에 반영.
//   - 로그인 안 됐거나 DB에 데이터가 없으면 null을 돌려준다 → 호출부가 .data/mock으로 폴백.
//   - 매핑은 여기(웹 레이어)에서: DB 컬럼(snake_case) → core 타입(camelCase). core는 소유 경계라 안 건드린다.

import {
  BUILT_IN_CHANNELS,
  type ConversationAdapter,
  type Lead,
  type LeadStage,
  type LeadSubStage,
  type Message,
  type MessageDirection,
  type MessageStatus,
  type MessageVisibility,
  type Thread,
  type ThreadPriority,
  type ThreadStatus,
  type FollowUpState
} from "@qualiflow/core";

import { createClient } from "@/lib/supabase/server";
import { resolveChannel } from "./conversation-source";
import type { ConversationSource } from "./conversation-store";

type LeadRow = {
  id: string;
  display_name: string;
  company_name: string | null;
  country_code: string | null;
  country_name: string | null;
  primary_email: string | null;
  profile_image_url: string | null;
  source_channel_ids: string[] | null;
  lifecycle_stage: string;
  sub_stage: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadRow = {
  id: string;
  lead_id: string;
  client_id: string | null;
  channel_id: string;
  channel_identity_id: string | null;
  external_thread_id: string | null;
  title: string | null;
  status: string;
  priority: string;
  follow_up: string;
  assignee_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  lead_id: string;
  channel_id: string;
  external_message_id: string | null;
  direction: string;
  status: string;
  visibility: string;
  author: { name?: string } | null;
  content: { text?: string } | null;
  sent_at: string;
  received_at: string | null;
};

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    displayName: row.display_name,
    companyName: row.company_name ?? undefined,
    countryCode: row.country_code ?? undefined,
    countryName: row.country_name ?? undefined,
    primaryEmail: row.primary_email ?? undefined,
    profileImageUrl: row.profile_image_url ?? undefined,
    sourceChannelIds: row.source_channel_ids ?? [],
    stage: row.lifecycle_stage as LeadStage,
    subStage: (row.sub_stage as LeadSubStage | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    leadId: row.lead_id,
    clientId: row.client_id ?? undefined,
    channelId: row.channel_id,
    channelIdentityId: row.channel_identity_id ?? undefined,
    externalThreadId: row.external_thread_id ?? undefined,
    title: row.title ?? undefined,
    status: row.status as ThreadStatus,
    priority: row.priority as ThreadPriority,
    followUp: row.follow_up as FollowUpState,
    assigneeId: row.assignee_id ?? undefined,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: MessageRow): Message {
  const direction = (row.direction === "outbound" ? "outbound" : "inbound") as MessageDirection;
  const text = typeof row.content?.text === "string" ? row.content.text : "";
  const authorName = typeof row.author?.name === "string" ? row.author.name : undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    leadId: row.lead_id,
    channelId: row.channel_id,
    externalMessageId: row.external_message_id ?? undefined,
    direction,
    status: row.status as MessageStatus,
    visibility: row.visibility as MessageVisibility,
    author: {
      displayName: authorName ?? (direction === "inbound" ? "고객" : "나"),
      role: direction === "inbound" ? "lead" : "operator"
    },
    content: { type: "text", text },
    sentAt: row.sent_at,
    receivedAt: row.received_at ?? undefined
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

function createSupabaseAdapter(supabase: ServerClient, leads: Lead[]): ConversationAdapter {
  return {
    id: "supabase",
    label: "All channels (DB)",
    channel: BUILT_IN_CHANNELS.manual,
    async listLeads() {
      // loadConversationSourceFromDb에서 이미 로드한 leads를 재사용한다(페이지 로드당 leads 이중 쿼리 제거).
      return { items: leads };
    },
    async listThreads(request) {
      let query = supabase.from("threads").select("*").order("last_message_at", { ascending: false }).limit(500);
      if (request?.leadId) {
        query = query.eq("lead_id", request.leadId);
      }
      const { data } = await query;
      return { items: ((data as ThreadRow[] | null) ?? []).map(mapThread) };
    },
    async listMessages(request) {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("thread_id", request.threadId)
        .order("sent_at", { ascending: true })
        .limit(1000);
      return { items: ((data as MessageRow[] | null) ?? []).map(mapMessage) };
    }
  };
}

// 로그인 사용자의 워크스페이스 DB에서 인박스 소스를 만든다. 비로그인/데이터 없음이면 null(폴백).
export async function loadConversationSourceFromDb(): Promise<ConversationSource | null> {
  let supabase: ServerClient;
  try {
    supabase = await createClient();
  } catch {
    return null; // Supabase 미설정
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return null; // 비로그인 → .data/mock 폴백
  }

  const { data: leadRows, error } = await supabase
    .from("leads")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !leadRows || leadRows.length === 0) {
    return null; // DB에 아직 데이터 없음 → 폴백
  }

  const leads = (leadRows as LeadRow[]).map(mapLead);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  return {
    status: {
      kind: "supabase",
      label: "DB 연결",
      detail: `leads ${leads.length}`,
      tone: "ok"
    },
    adapter: createSupabaseAdapter(supabase, leads),
    getLead: (leadId) => leadById.get(leadId),
    getChannel: (channelId) => resolveChannel(channelId),
    // DB 대화엔 아직 등급(qualification)이 없다 — in-product AI가 채울 자리.
    getQualification: () => undefined,
    gradeACount: 0
  };
}
