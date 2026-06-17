import { createChatAdapter, type ChatRawConversation, type ChatRawMessage } from "@qualiflow/adapter-chat";
import type { BuiltInChannelId, ConversationAdapter, MessageDirection } from "@qualiflow/core";

const CHANNEL_ID: BuiltInChannelId = "telegram";

export type TelegramChatType = "private" | "group" | "supergroup" | "channel" | (string & {});

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramChat = {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type TelegramNormalizeOptions = {
  botUserId?: number;
  operatorUserIds?: number[];
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

function toIsoFromTelegramSeconds(value: number) {
  return new Date(value * 1_000).toISOString();
}

function getUserDisplayName(user?: TelegramUser) {
  if (!user) {
    return undefined;
  }

  return normalizeText([user.first_name, user.last_name].filter(Boolean).join(" ")) || user.username;
}

function getChatDisplayName(chat: TelegramChat, user?: TelegramUser) {
  return normalizeText(chat.title) || normalizeText([chat.first_name, chat.last_name].filter(Boolean).join(" ")) || getUserDisplayName(user) || chat.username;
}

function getMessageText(message: TelegramMessage) {
  return normalizeText(message.text) || normalizeText(message.caption);
}

function resolveDirection(message: TelegramMessage, options: TelegramNormalizeOptions): MessageDirection {
  const senderId = message.from?.id;

  if (!senderId) {
    return "inbound";
  }

  if (options.botUserId === senderId || options.operatorUserIds?.includes(senderId)) {
    return "outbound";
  }

  return "inbound";
}

function getThreadId(message: TelegramMessage) {
  return toEntityId("thread_telegram", String(message.chat.id));
}

function getContactId(message: TelegramMessage) {
  const externalId = message.chat.type === "private" ? (message.from?.id ?? message.chat.id) : message.chat.id;
  return toEntityId("contact_telegram", String(externalId));
}

function normalizeTelegramMessage(message: TelegramMessage, options: TelegramNormalizeOptions): ChatRawMessage | null {
  const text = getMessageText(message);

  if (!text) {
    return null;
  }

  const direction = resolveDirection(message, options);

  return {
    id: toEntityId("msg_telegram", `${message.chat.id}_${message.message_id}`),
    text,
    sentAt: toIsoFromTelegramSeconds(message.date),
    direction,
    authorName:
      direction === "outbound"
        ? (options.operatorDisplayName ?? "운영자")
        : (getUserDisplayName(message.from) ?? getChatDisplayName(message.chat, message.from) ?? "Telegram user")
  };
}

export function normalizeTelegramUpdates(
  updates: TelegramUpdate[],
  options: TelegramNormalizeOptions = {}
): ChatRawConversation[] {
  const conversations = new Map<string, ChatRawConversation>();

  for (const update of updates) {
    const message = update.message ?? update.edited_message;

    if (!message) {
      continue;
    }

    const normalizedMessage = normalizeTelegramMessage(message, options);

    if (!normalizedMessage) {
      continue;
    }

    const threadId = getThreadId(message);
    const existing = conversations.get(threadId);

    if (existing) {
      existing.messages.push(normalizedMessage);
      continue;
    }

    conversations.set(threadId, {
      threadId,
      contact: {
        id: getContactId(message),
        name: getChatDisplayName(message.chat, message.from) ?? "Telegram user"
      },
      messages: [normalizedMessage]
    });
  }

  return [...conversations.values()].map((conversation) => ({
    ...conversation,
    messages: [...conversation.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }));
}

export function createTelegramAdapterFromUpdates(
  updates: TelegramUpdate[],
  options: TelegramNormalizeOptions = {}
): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, normalizeTelegramUpdates(updates, options));
}

export function createTelegramAdapterFromConversations(conversations: ChatRawConversation[]): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, conversations);
}
