import { createChatAdapter, type ChatRawConversation, type ChatRawMessage } from "@qualiflow/adapter-chat";
import type { ConversationAdapter, MessageDirection } from "@qualiflow/core";

const CHANNEL_ID = "instagram";

export type InstagramAccountKind = "professional_account" | "user_session" | (string & {});

// Connector runtime이 Instagram에서 가져온 대화 snapshot.
// 공식 Meta API 또는 browser/session collector가 이 형태로 맞춰주면 된다.
export type InstagramConversation = {
  id: string;
  accountKind: InstagramAccountKind;
  profile: InstagramProfile;
  messages: InstagramMessage[];
};

export type InstagramProfile = {
  id: string;
  username?: string;
  displayName?: string;
  companyName?: string;
  countryCode?: string;
  profileImageUrl?: string;
};

export type InstagramMessage = {
  id: string;
  conversationId: string;
  text?: string;
  sentAt: string | number;
  outgoing: boolean;
  senderId?: string;
  senderUsername?: string;
  senderDisplayName?: string;
};

export type InstagramNormalizeOptions = {
  operatorDisplayName?: string;
};

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, " ") || "";
}

function toEntityId(prefix: string, value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${normalized || "unknown"}`;
}

function toIsoDateTime(value: string | number) {
  if (typeof value === "string") {
    return value;
  }

  return new Date(value < 1_000_000_000_000 ? value * 1_000 : value).toISOString();
}

function resolveDirection(message: InstagramMessage): MessageDirection {
  return message.outgoing ? "outbound" : "inbound";
}

function normalizeInstagramMessage(
  conversation: InstagramConversation,
  message: InstagramMessage,
  options: InstagramNormalizeOptions
): ChatRawMessage | null {
  const text = normalizeText(message.text);

  if (!text) {
    return null;
  }

  const direction = resolveDirection(message);

  return {
    id: toEntityId("msg_instagram", `${message.conversationId}_${message.id}`),
    text,
    sentAt: toIsoDateTime(message.sentAt),
    direction,
    authorName:
      direction === "outbound"
        ? (options.operatorDisplayName ?? "운영자")
        : (normalizeText(message.senderDisplayName) ||
          normalizeText(message.senderUsername) ||
          normalizeText(conversation.profile.displayName) ||
          normalizeText(conversation.profile.username) ||
          "Instagram user")
  };
}

export function normalizeInstagramConversations(
  conversations: InstagramConversation[],
  options: InstagramNormalizeOptions = {}
): ChatRawConversation[] {
  return conversations
    .map((conversation) => {
      const messages = conversation.messages
        .map((message) => normalizeInstagramMessage(conversation, message, options))
        .filter((message): message is ChatRawMessage => message !== null)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

      return {
        threadId: toEntityId("thread_instagram", conversation.id),
        contact: {
          id: toEntityId("contact_instagram", conversation.profile.id),
          name:
            normalizeText(conversation.profile.displayName) ||
            normalizeText(conversation.profile.username) ||
            conversation.profile.id,
          companyName: normalizeText(conversation.profile.companyName) || undefined,
          countryCode: normalizeText(conversation.profile.countryCode) || undefined,
          profileImageUrl: normalizeText(conversation.profile.profileImageUrl) || undefined
        },
        messages
      };
    })
    .filter((conversation) => conversation.messages.length > 0);
}

export function createInstagramAdapterFromConversations(
  conversations: InstagramConversation[],
  options: InstagramNormalizeOptions = {}
): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, normalizeInstagramConversations(conversations, options), {
    accountKind: "user_account",
    authMode: "oauth",
    capabilities: ["read_messages", "send_messages", "sync_history", "realtime_events", "attachments", "read_receipts"]
  });
}

export function createInstagramAdapterFromRawChat(conversations: ChatRawConversation[]): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, conversations, {
    accountKind: "user_account",
    authMode: "oauth",
    capabilities: ["read_messages", "send_messages", "sync_history", "realtime_events", "attachments", "read_receipts"]
  });
}
