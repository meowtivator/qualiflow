import type { Lead, Message, MessageAttachment, MessageDirection, Thread } from "@qualiflow/core";

import type { AlibabaRawConversation, AlibabaRawMessage } from "./raw-types.js";

// ────────────────────────────────────────────────────────────────────────
// 비즈니스 판단(우리가 임의로 정한 규칙). 코드 곳곳에 숨기지 않고 여기 모아둔다.
// 규칙을 바꾸고 싶으면 이 블록만 보면 된다.
// ────────────────────────────────────────────────────────────────────────

// 알리바바 메시지 type 코드 1 = 텍스트 (오늘 관찰값). 그 외 타입은 아직 미지원.
const ALIBABA_TEXT_TYPE = 1;
// type 2 = 알리바바 시스템 공지(예: "翻译功能升级…" 번역기능 업데이트 안내). 바이어/셀러 대화가 아니라
// 앱이 끼워넣는 알림이라, 대화·팔로업·요약에서 제외한다. (★업무 규칙: 시스템 메시지는 대화로 안 침)
const ALIBABA_SYSTEM_TYPE = 2;

// 이 어댑터가 다루는 채널 고정값.
const CHANNEL_ID = "alibaba";

// 새로 동기화된 대화는 일단 "열림(응대 필요)" 상태/보통 우선순위로 둔다 — 기본값.
const DEFAULT_THREAD_STATUS = "open";
const DEFAULT_THREAD_PRIORITY = "normal";

// lead 퍼널 단계: 어댑터는 항상 "new"로 만든다(단계 진행은 CRM/수동의 몫).
// "고객이 답했는지"는 stage가 아니라 thread.followUp(needs_my_reply)이 표현한다.

// ────────────────────────────────────────────────────────────────────────

// 아무 문자열이나 안정적인 내부 id로 바꾼다. (영문/숫자만 남기고 소문자화)
function toEntityId(prefix: string, value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || "unknown"}`;
}

// ★규칙: 보낸 사람이 "나(owner)"면 outbound, 아니면 inbound.
function resolveDirection(raw: AlibabaRawMessage, ownerAliId: string): MessageDirection {
  return raw.sender?.targetId === ownerAliId ? "outbound" : "inbound";
}

// 알리바바의 숫자 시간(epoch ms) → 사람이 읽는 ISO 문자열.
function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// 메시지 한 건 변환: 알리바바 raw → core Message.
export function normalizeAlibabaMessage(
  raw: AlibabaRawMessage,
  context: { ownerAliId: string; ownerName: string; leadId: string; leadName: string }
): Message {
  const direction = resolveDirection(raw, context.ownerAliId);
  const isText = (raw.type ?? raw.msgType) === ALIBABA_TEXT_TYPE || typeof raw.content === "string";

  return {
    id: String(raw.messageId),
    threadId: raw.conversationCode,
    leadId: context.leadId,
    channelId: CHANNEL_ID,
    externalMessageId: raw.uuid ?? String(raw.messageId),
    direction,
    // ★규칙(임시): 보낸 건 "sent", 받은 건 "delivered"로 둔다. 추후 읽음 여부까지 반영 예정.
    status: direction === "outbound" ? "sent" : "delivered",
    visibility: "client_visible",
    author: {
      displayName: direction === "outbound" ? context.ownerName : context.leadName,
      role: direction === "outbound" ? "operator" : "lead"
    },
    content: {
      type: "text",
      // ★규칙: 텍스트가 아니면(이미지/카드 등) 자리표시 문자열로. 데이터를 조용히 버리지 않는다.
      text: isText ? raw.content : `[미지원 메시지 type: ${raw.type ?? raw.msgType ?? "unknown"}]`
    },
    sentAt: toIso(raw.sendTime),
    metadata: {
      alibabaMsgType: raw.msgType ?? null,
      alibabaType: raw.type ?? null,
      alibabaSubType: raw.subType ?? null,
      autoReply: raw.autoReply ?? null,
      spamStatus: raw.spamStatus ?? null
    }
  };
}

// 바이어(상대) 정보 변환: 알리바바 raw 대화 → core Lead.
export function normalizeAlibabaContact(raw: AlibabaRawConversation): Lead {
  const contact = raw.contact;
  const sendTimes = raw.messages.map((message) => message.sendTime);
  const createdAt = sendTimes.length ? toIso(Math.min(...sendTimes)) : toIso(0);
  const updatedAt = sendTimes.length ? toIso(Math.max(...sendTimes)) : createdAt;

  return {
    id: toEntityId("lead_alibaba", contact.aliId ?? contact.loginId ?? "unknown"),
    displayName: contact.name ?? contact.loginId ?? "Unknown Alibaba buyer",
    companyName: contact.companyName || undefined,
    countryCode: contact.complianceCountryCode || undefined,
    profileImageUrl: contact.profileImageUrl || undefined,
    sourceChannelIds: [CHANNEL_ID],
    stage: "new",
    createdAt,
    updatedAt,
    metadata: {
      alibabaAliId: contact.aliId ?? null,
      alibabaLoginId: contact.loginId ?? null,
      alibabaProfileImageUrl: contact.profileImageUrl ?? null
    }
  };
}

// 대화 한 개 변환: 알리바바 raw 대화 묶음 → core { lead, thread, messages }.
export function normalizeAlibabaConversation(raw: AlibabaRawConversation): {
  lead: Lead;
  thread: Thread;
  messages: Message[];
} {
  // lead(바이어)를 먼저 만들고, 그 id를 메시지들이 공유한다(따로 계산하면 어긋날 수 있어서).
  const lead = normalizeAlibabaContact(raw);
  const leadId = lead.id;
  const ownerName = raw.owner.name ?? "운영자";
  const leadName = raw.contact.name ?? raw.contact.loginId ?? "바이어";

  // 시스템 공지(type 2)는 제외하고 실제 대화 메시지만 변환한다.
  const messages = raw.messages
    .filter((message) => message.type !== ALIBABA_SYSTEM_TYPE)
    .map((message) =>
      normalizeAlibabaMessage(message, {
        ownerAliId: raw.owner.aliId,
        ownerName,
        leadId,
        leadName
      })
    );

  // 대화의 시작/마지막 시간은 (시스템 공지 뺀) 실제 메시지에서 뽑는다.
  const messageTimes = messages.map((message) => message.sentAt).sort();
  const firstSentAt = messageTimes[0] ?? toIso(0);
  const lastSentAt = messageTimes[messageTimes.length - 1] ?? firstSentAt;
  const conversationCode = raw.messages[0]?.conversationCode ?? "unknown";

  // ★규칙(F4 팔로업): 마지막 메시지가 고객(inbound)이면 내가 답해야 함, 내가(outbound) 보냈으면 고객 답 대기.
  const lastMessage = messages.length ? messages.reduce((a, b) => (a.sentAt >= b.sentAt ? a : b)) : undefined;
  const followUp = !lastMessage
    ? "none"
    : lastMessage.direction === "inbound"
      ? "needs_my_reply"
      : "waiting_on_customer";

  const thread: Thread = {
    id: conversationCode,
    leadId,
    channelId: CHANNEL_ID,
    externalThreadId: conversationCode,
    status: DEFAULT_THREAD_STATUS,
    priority: DEFAULT_THREAD_PRIORITY,
    followUp,
    lastMessageAt: lastSentAt,
    createdAt: firstSentAt,
    updatedAt: lastSentAt
  };

  return { lead, thread, messages };
}

// ────────────────────────────────────────────────────────────────────────
// 에이전트 ingest용 변환: 알리바바 raw → '공통 ingest 형태'.
// 위와 같은 규칙(방향=owner면 outbound, sendTime→ISO, 시스템메시지 type 2 제외)을 재사용하되,
// core 타입이 아니라 서버 /api/agents/ingest 가 기대하는 DTO로 낸다:
//   { threadId, contact:{id,name?,handle?}, messages:[{id,text,sentAt,direction}] }
// contact.id = 채널 외부키(aliId) — 서버가 channel_identity 매칭/멱등에 쓴다.
// ────────────────────────────────────────────────────────────────────────

export type AlibabaIngestConversation = {
  threadId: string;
  contact: {
    id: string;
    name?: string;
    handle?: string;
    companyName?: string;
    countryCode?: string;
    profileImageUrl?: string;
  };
  messages: Array<{
    id: string;
    text: string;
    sentAt: string;
    direction: MessageDirection;
    attachments?: MessageAttachment[]; // 사진·영상 등(있으면)
  }>;
};

// 알리바바 content는 <br/> 같은 HTML 조각을 포함한다 → 평문으로. <br> = 줄바꿈, 나머지 태그 제거.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function alibabaToIngestConversations(raw: AlibabaRawConversation[]): AlibabaIngestConversation[] {
  return raw.map((conversation) => {
    const ownerAliId = conversation.owner.aliId;
    const externalId = conversation.contact.aliId ?? conversation.contact.loginId ?? "unknown";
    const threadId = conversation.messages[0]?.conversationCode ?? `alibaba_${externalId}`;

    const messages = conversation.messages
      .filter((message) => message.type !== ALIBABA_SYSTEM_TYPE)
      .map((message) => ({
        id: message.uuid ?? String(message.messageId),
        text:
          typeof message.content === "string"
            ? htmlToText(message.content)
            : `[미지원 메시지 type: ${message.type ?? message.msgType ?? "unknown"}]`,
        sentAt: toIso(message.sendTime),
        direction: (message.sender?.targetId === ownerAliId ? "outbound" : "inbound") as MessageDirection
      }));

    return {
      threadId,
      contact: {
        id: externalId,
        name: conversation.contact.name ?? conversation.contact.loginId,
        handle: conversation.contact.loginId,
        // 강화 필드(있을 때만 — 알리바바 raw에 존재). 서버 ingest가 leads.company_name/country_code/profile_image_url에 채운다.
        companyName: conversation.contact.companyName || undefined,
        countryCode: conversation.contact.complianceCountryCode || undefined,
        // ★등급/인증 뱃지(imgextra ...tps-WxH.png) 제외 — 아바타가 아니라 공용 아이콘. 없으면 undefined(이니셜 폴백).
        profileImageUrl:
          conversation.contact.profileImageUrl && !/[-_]\d+[-x]\d+\.(png|webp)/i.test(conversation.contact.profileImageUrl)
            ? conversation.contact.profileImageUrl
            : undefined
      },
      messages
    };
  });
}
