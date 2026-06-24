import { createChatAdapter, type ChatRawConversation, type ChatRawMessage } from "@qualiflow/adapter-chat";
import type { ConversationAdapter, MessageDirection } from "@qualiflow/core";

const CHANNEL_ID = "telegram";

export type TelegramUserPeerType = "user" | "group" | "supergroup" | "channel" | (string & {});

// Runtime connector(MTProto/TDLib/gotd 등)가 만든 사용자 계정 대화 snapshot.
// Bot API Update가 아니라, 운영자 Telegram 계정에 실제로 보이는 dialog/message를 표현한다.
export type TelegramUserDialog = {
  id: string;
  peerId: string;
  peerType: TelegramUserPeerType;
  title?: string;
  username?: string;
  profileImageUrl?: string;
  messages: TelegramUserMessage[];
};

export type TelegramUserMessage = {
  id: string;
  dialogId: string;
  peerId: string;
  text?: string;
  sentAt: string | number;
  outgoing: boolean;
  senderId?: string;
  senderDisplayName?: string;
};

export type TelegramNormalizeOptions = {
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

  // Telegram client libraries commonly expose unix seconds. Some wrappers expose ms.
  return new Date(value < 1_000_000_000_000 ? value * 1_000 : value).toISOString();
}

function resolveDirection(message: TelegramUserMessage): MessageDirection {
  return message.outgoing ? "outbound" : "inbound";
}

function normalizeTelegramUserMessage(
  dialog: TelegramUserDialog,
  message: TelegramUserMessage,
  options: TelegramNormalizeOptions
): ChatRawMessage | null {
  const text = normalizeText(message.text);

  if (!text) {
    return null;
  }

  const direction = resolveDirection(message);

  return {
    id: toEntityId("msg_telegram", `${message.dialogId}_${message.id}`),
    text,
    sentAt: toIsoDateTime(message.sentAt),
    direction,
    authorName:
      direction === "outbound"
        ? (options.operatorDisplayName ?? "운영자")
        : (normalizeText(message.senderDisplayName) || normalizeText(dialog.title) || "Telegram user")
  };
}

export function normalizeTelegramUserDialogs(
  dialogs: TelegramUserDialog[],
  options: TelegramNormalizeOptions = {}
): ChatRawConversation[] {
  return dialogs
    .map((dialog) => {
      const messages = dialog.messages
        .map((message) => normalizeTelegramUserMessage(dialog, message, options))
        .filter((message): message is ChatRawMessage => message !== null)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

      return {
        threadId: toEntityId("thread_telegram", dialog.id),
        contact: {
          id: toEntityId("contact_telegram", dialog.peerId),
          name: normalizeText(dialog.title) || normalizeText(dialog.username) || dialog.peerId,
          profileImageUrl: normalizeText(dialog.profileImageUrl) || undefined
        },
        messages
      };
    })
    .filter((conversation) => conversation.messages.length > 0);
}

export function createTelegramAdapterFromUserDialogs(
  dialogs: TelegramUserDialog[],
  options: TelegramNormalizeOptions = {}
): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, normalizeTelegramUserDialogs(dialogs, options), {
    accountKind: "user_account",
    authMode: "phone_code",
    capabilities: ["read_messages", "send_messages", "sync_history", "realtime_events", "read_receipts"]
  });
}

export function createTelegramAdapterFromConversations(conversations: ChatRawConversation[]): ConversationAdapter {
  return createChatAdapter(CHANNEL_ID, conversations, {
    accountKind: "user_account",
    authMode: "phone_code",
    capabilities: ["read_messages", "send_messages", "sync_history", "realtime_events", "read_receipts"]
  });
}
