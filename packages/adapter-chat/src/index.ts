import {
  BUILT_IN_CHANNELS,
  type BuiltInChannelId,
  type ConversationAdapter,
  type Lead,
  type Message,
  type MessageDirection,
  type Page,
  type PageRequest,
  type Thread
} from "@qualiflow/core";

// 단순 채팅 채널(텔레그램·인스타그램·왓츠앱 등) 공용 어댑터.
// 알리바바와 달리 이 채널들은 "연락처 + 메시지" 구조가 거의 같아서, 채널마다 따로 만들지 않고
// channelId로 파라미터화한 하나의 어댑터로 처리한다. 각 채널의 "실제로 메시지를 가져오는
// 리더"(GramJS/Meta API/Baileys 등)는 인증이 필요해 별도이며, 그 결과를 아래 raw 형태로
// 맞춰 넣으면 이 어댑터가 core 타입으로 변환한다.

export type ChatRawMessage = {
  id: string;
  text: string;
  sentAt: string; // ISO datetime
  direction: MessageDirection; // "inbound"(고객→나) | "outbound"(나→고객)
  authorName?: string;
};

export type ChatRawContact = {
  id: string;
  name?: string;
  companyName?: string;
  countryCode?: string;
};

export type ChatRawConversation = {
  threadId: string;
  contact: ChatRawContact;
  messages: ChatRawMessage[];
};

function toEntityId(prefix: string, value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || "unknown"}`;
}

export function normalizeChatConversation(
  channelId: BuiltInChannelId,
  raw: ChatRawConversation
): { lead: Lead; thread: Thread; messages: Message[] } {
  const leadId = toEntityId(`lead_${channelId}`, raw.contact.id);
  const times = raw.messages.map((message) => message.sentAt).sort();
  const firstAt = times[0] ?? new Date(0).toISOString();
  const lastAt = times[times.length - 1] ?? firstAt;
  // ★규칙: 고객이 보낸(inbound) 메시지가 하나라도 있으면 "contacted".
  const hasInbound = raw.messages.some((message) => message.direction === "inbound");

  const lead: Lead = {
    id: leadId,
    displayName: raw.contact.name ?? raw.contact.id,
    companyName: raw.contact.companyName || undefined,
    countryCode: raw.contact.countryCode || undefined,
    sourceChannelIds: [channelId],
    lifecycleStage: hasInbound ? "contacted" : "new",
    createdAt: firstAt,
    updatedAt: lastAt
  };

  const thread: Thread = {
    id: raw.threadId,
    leadId,
    channelId,
    externalThreadId: raw.threadId,
    status: "open",
    priority: "normal",
    lastMessageAt: lastAt,
    createdAt: firstAt,
    updatedAt: lastAt
  };

  const messages: Message[] = raw.messages.map((message) => ({
    id: message.id,
    threadId: raw.threadId,
    leadId,
    channelId,
    externalMessageId: message.id,
    direction: message.direction,
    status: message.direction === "outbound" ? "sent" : "delivered",
    visibility: "client_visible",
    author: {
      displayName: message.authorName ?? (message.direction === "outbound" ? "운영자" : (raw.contact.name ?? "고객")),
      role: message.direction === "outbound" ? "operator" : "lead"
    },
    content: { type: "text", text: message.text },
    sentAt: message.sentAt
  }));

  return { lead, thread, messages };
}

function paginate<TItem>(items: TItem[], request?: PageRequest): Page<TItem> {
  const limit = request?.limit ?? items.length;
  const offset = request?.cursor ? Number.parseInt(request.cursor, 10) : 0;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const pageItems = items.slice(safeOffset, safeOffset + limit);
  const nextOffset = safeOffset + pageItems.length;
  return { items: pageItems, nextCursor: nextOffset < items.length ? String(nextOffset) : undefined };
}

export function createChatAdapter(
  channelId: BuiltInChannelId,
  conversations: ChatRawConversation[]
): ConversationAdapter {
  const leads: Lead[] = [];
  const threads: Thread[] = [];
  const messages: Message[] = [];

  for (const raw of conversations) {
    const normalized = normalizeChatConversation(channelId, raw);
    leads.push(normalized.lead);
    threads.push(normalized.thread);
    messages.push(...normalized.messages);
  }

  return {
    id: channelId,
    label: BUILT_IN_CHANNELS[channelId].label,
    channel: BUILT_IN_CHANNELS[channelId],
    async listLeads(request) {
      return paginate(leads, request);
    },
    async listThreads(request) {
      const filtered = threads.filter((thread) => {
        if (request?.leadId && thread.leadId !== request.leadId) return false;
        if (request?.clientId && thread.clientId !== request.clientId) return false;
        if (request?.updatedSince && thread.updatedAt < request.updatedSince) return false;
        return true;
      });
      return paginate(filtered, request);
    },
    async listMessages(request) {
      return paginate(
        messages.filter((message) => message.threadId === request.threadId),
        request
      );
    }
  };
}
