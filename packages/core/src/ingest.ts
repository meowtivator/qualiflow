// 에이전트 → 클라우드 인그est 계약(채널 무관). 로컬 에이전트가 정규화한 대화를
// POST /api/agents/ingest 로 보낼 때의 '본문/응답 모양'을 한 곳에서 정의한다.
//
// ★단일 출처(single source of truth): 이 모양에
//   - 생산자: apps/agent/src/push.ts (에이전트가 보냄)
//   - 소비자: apps/web .../api/agents/ingest/route.ts (서버가 받음)
//   - 저장:   supabase/migrations 의 ingest_conversations RPC (jsonb 키)
//   세 곳이 합의한다. 예전엔 같은 약속을 각자 적어둬(인라인 타입 + unknown 검증 + SQL)
//   서로 어긋나도 조용히 깨질 수 있었다 → 여기로 통합한다.
//
// 채널별 어댑터(adapter-alibaba 등)는 IngestConversation 을 좁혀(contact.metadata)
// 자기 enrichment 타입을 붙인다 — 모양 자체는 항상 이 계약을 따른다.

import type { MessageAttachment, MessageDirection } from "./message";

// 계약 버전. 모양을 바꾸면 올린다. 생산자가 본문(version)에 실어 보내면 소비자가
// 불일치(에이전트가 구버전)를 감지할 수 있다. RPC 는 아직 이 값을 쓰지 않는다(전방 호환).
export const INGEST_CONTRACT_VERSION = 1;

// 인그est 한 메시지. RPC ingest_conversations 가 읽는 jsonb 키와 1:1.
//   id(필수, 멱등키 — 없으면 RPC가 스킵) / text(평문) / sentAt(ISO) / direction / attachments(선택).
export type IngestMessage = {
  id: string;
  text: string;
  sentAt: string;
  direction: MessageDirection;
  attachments?: MessageAttachment[];
};

// 인그est 한 연락처(바이어). id(필수, 채널 내 자연키) + 선택 프로필.
//   metadata 는 채널별 enrichment(예: 알리바바 등급/SNS/활동). 서버가 leads.lead_metadata 에 병합한다.
export type IngestContact = {
  id: string;
  name?: string;
  handle?: string;
  companyName?: string;
  countryCode?: string;
  profileImageUrl?: string;
  metadata?: Record<string, unknown>;
};

// 인그est 한 대화(스레드). threadId(채널 스레드 자연키) + 연락처 + 메시지들.
export type IngestConversation = {
  threadId: string;
  contact: IngestContact;
  messages: IngestMessage[];
};

// POST /api/agents/ingest 요청 본문.
export type IngestRequest = {
  channel: string;
  accountLabel: string;
  conversations: IngestConversation[];
  version?: number;
};

// POST /api/agents/ingest 응답.
export type IngestResponse = {
  ok: boolean;
  leadsCreated?: number;
  threadsCreated?: number;
  messagesCreated?: number;
  message?: string;
};

export type IngestParseResult = { ok: true; value: IngestRequest } | { ok: false; error: string };

// 서버 소비자용 봉투(envelope) 검증기. unknown 본문이 IngestRequest 의 '겉모양'인지만 본다
//   (channel·accountLabel 문자열 + conversations 배열). ★대화 내부 모양은 RPC 가 방어적으로
//   처리하므로 여기서 과검증하지 않는다 — 기존 정상 페이로드는 전부 통과해야 한다(동작 불변).
export function parseIngestRequest(body: unknown): IngestParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "본문이 객체가 아닙니다." };
  }
  const b = body as Record<string, unknown>;
  const channel = typeof b.channel === "string" ? b.channel.trim() : "";
  const accountLabel = typeof b.accountLabel === "string" ? b.accountLabel.trim() : "";
  const conversations = b.conversations;
  if (!channel || !accountLabel || !Array.isArray(conversations)) {
    return { ok: false, error: "channel, accountLabel, conversations(배열)가 필요합니다." };
  }
  const version = typeof b.version === "number" ? b.version : undefined;
  return {
    ok: true,
    value: { channel, accountLabel, conversations: conversations as IngestConversation[], version }
  };
}
