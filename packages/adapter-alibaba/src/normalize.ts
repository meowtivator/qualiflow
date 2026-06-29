import type { IngestConversation, Lead, Message, MessageDirection, Thread } from "@qualiflow/core";

import type {
  AlibabaBuyerActivity,
  AlibabaBuyerOrderCounts,
  AlibabaRawConversation,
  AlibabaRawMessage
} from "./raw-types.js";

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

// 서버 ingest_conversations 가 leads.lead_metadata(jsonb)로 그대로 병합하는 enrichment 묶음.
// ★값이 있는 키만 넣는다(빈 칸은 생략) — 그래야 jsonb merge가 기존 값을 빈 값으로 덮어쓰지 않는다.
export type AlibabaContactMetadata = {
  // 구매 등급(L1~L4). 연락처 행 fiber의 userNewLevel 값을 형태검증(/^L[0-9]$/)해 그대로 쓴다.
  alibabaGrade?: string;
  // 등급 뱃지 이미지 URL(userNewLevelIcon, 있을 때만).
  alibabaGradeBadgeUrl?: string;
  // 알리바바 내부 식별자(memberId, 있을 때만).
  alibabaMemberId?: string;
  // 디스커버리(웹 검색)로 찾은 후보 SNS. 라이브 fetch가 돌기 전까지는 비워 둔다.
  sns?: {
    instagram?: string;
    linkedin?: string;
    facebook?: string;
  };
  // 주문 카운트(#5). 메시지 패널 상단 카드/주문 카운트 — 별도 JSONP(queryCustomerInfo)로 캡처해 흘린다.
  // ★값 있을 때만. 라이브 JSONP 키 미확정 → 형태 잠정. 추출기가 일부 칸만 채울 수 있어 Partial(전 필드 옵셔널).
  orderCounts?: Partial<AlibabaBuyerOrderCounts>;
  // 고객 활동(#7, 지난 90일). "고객 활동" 패널 지표 — 위와 같은 JSONP 출처.
  // ★값 있을 때만. 라이브 JSONP 키 미확정 → 형태 잠정. Partial로 둬 부분 캡처를 정직하게 표현(cast 불필요).
  activity?: Partial<AlibabaBuyerActivity>;
};

// 알리바바 정규화 결과 = 공용 IngestConversation 계약(@qualiflow/core)을 그대로 따르되,
//   contact.metadata 만 알리바바 enrichment(AlibabaContactMetadata: 등급/SNS/활동)로 좁힌다.
//   ★모양의 단일 출처는 core. 여기선 metadata 타입만 특수화한다(서버가 leads.lead_metadata 에 병합).
export type AlibabaIngestConversation = Omit<IngestConversation, "contact"> & {
  contact: Omit<IngestConversation["contact"], "metadata"> & { metadata?: AlibabaContactMetadata };
};

// 알리바바 content는 <br/> 같은 HTML 조각을 포함한다 → 평문으로. <br> = 줄바꿈, 나머지 태그 제거.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// 구매 등급 값(연락처 행 fiber의 userNewLevel, 예 "L2") → 형태검증 후 그대로 채택.
// ★프로브로 확정: 등급은 뱃지 이미지가 아니라 fiber의 userNewLevel 값으로 직접 온다.
//   형태(/^L[0-9]$/)가 맞을 때만 대문자로 정규화해 쓰고, 아니면 undefined(=등급 미부여/모름).
//   관찰값은 L1~L4지만 미관찰 등급(L5+)도 형태만 맞으면 버리지 않는다 — 절대 값을 지어내지 않는다.
export function normalizeAlibabaGrade(level: string | undefined): string | undefined {
  if (!level) return undefined;
  const normalized = level.trim().toUpperCase();
  return /^L[0-9]$/.test(normalized) ? normalized : undefined;
}

// contact.metadata(enrichment) 묶음을 '값 있는 키만' 채워 만든다. 아무 값도 없으면 undefined.
//   → undefined면 ingest DTO에 metadata 키 자체를 안 넣어, 서버 jsonb merge가 빈 객체를 안 흘린다.
function buildContactMetadata(args: {
  grade?: string;
  gradeBadgeUrl?: string;
  memberId?: string;
  sns?: AlibabaContactMetadata["sns"];
  orderCounts?: AlibabaBuyerOrderCounts;
  activity?: AlibabaBuyerActivity;
}): AlibabaContactMetadata | undefined {
  const metadata: AlibabaContactMetadata = {};

  const grade = normalizeAlibabaGrade(args.grade);
  if (grade) metadata.alibabaGrade = grade; // 형태(/^L[0-9]$/) 맞을 때만. 없으면 키 자체를 안 만든다.
  if (args.gradeBadgeUrl) metadata.alibabaGradeBadgeUrl = args.gradeBadgeUrl;
  if (args.memberId) metadata.alibabaMemberId = args.memberId;

  // SNS는 디스커버리(웹 검색)가 라이브로 돌아 채워질 때만 들어온다. 빈 객체는 넣지 않는다.
  if (args.sns) {
    const sns: NonNullable<AlibabaContactMetadata["sns"]> = {};
    if (args.sns.instagram) sns.instagram = args.sns.instagram;
    if (args.sns.linkedin) sns.linkedin = args.sns.linkedin;
    if (args.sns.facebook) sns.facebook = args.sns.facebook;
    if (Object.keys(sns).length > 0) metadata.sns = sns;
  }

  // 주문 카운트(#5)·고객 활동(#7)은 추출기가 JSONP(queryCustomerInfo) 응답을 캡처했을 때만 들어온다.
  // ★값이 '있는 칸만' 골라 담는다(undefined 칸은 생략) — 그래야 서버 jsonb merge가 빈 값으로 덮지 않는다.
  //   라이브 JSONP 응답 키 미확정이라, 추출기가 잠정 형태로 채워 줄 때만 그대로 통과시킨다(여기선 매핑 안 함).
  const orderCounts = pickDefined(args.orderCounts);
  if (orderCounts) metadata.orderCounts = orderCounts; // pickDefined가 Partial 반환 → metadata도 Partial이라 cast 불필요(타입 정직).
  const activity = pickDefined(args.activity);
  if (activity) metadata.activity = activity;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

// 객체에서 '값이 정의된 칸만' 추린다(null/undefined 제거). 남는 칸이 없으면 undefined.
//   → 빈 객체나 전부-빈 객체를 ingest로 흘리지 않게 한다(jsonb merge가 기존 값을 빈 값으로 덮는 사고 방지).
// ★업무 규칙(명시): null도 제거한다. 예) activity.loginDays 는 화면상 "--"면 null로 오는데, null을
//   그대로 보내면 서버 jsonb merge에서 기존 값을 null로 덮을 수 있다 → "모름"은 키를 빼서 표현한다.
function pickDefined<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const value = obj[key];
    if (value !== null && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

    // 구매 등급을 행 fiber의 userNewLevel 값에서 직접 채택(형태검증). 뱃지 URL(userNewLevelIcon)·memberId도 보존.
    // SNS는 알리바바 화면엔 없다 — 라이브 브라우저(에이전트)가 추출 후 discoverBuyerSns 로 채워
    // contact.sns 에 실어 둔다(옵트인). 여기선 그 값을 그대로 buildContactMetadata 로 흘린다(없으면 빈 채).
    // 주문 카운트(#5)·고객 활동(#7)은 추출기가 JSONP 응답을 캡처해 '연락처(contact)' 단위로 실어 둔다.
    //   폴백: 예전 캡처가 대화(conversation) 단위로 실었으면 그것도 받는다(둘 다 없으면 undefined → 키 생략).
    const orderCounts = conversation.contact.orderCounts ?? conversation.orderCounts;
    const activity = conversation.contact.activity ?? conversation.activity;

    const metadata = buildContactMetadata({
      grade: conversation.contact.userNewLevel,
      gradeBadgeUrl: conversation.contact.userNewLevelIcon ?? conversation.contact.alibabaGradeBadgeUrl,
      memberId: conversation.contact.memberId,
      sns: conversation.contact.sns,
      orderCounts,
      activity
    });

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
            : undefined,
        // enrichment(등급/SNS) — 값 있을 때만 동봉(빈 객체면 undefined라 키 자체가 빠진다).
        ...(metadata ? { metadata } : {})
      },
      messages
    };
  });
}
