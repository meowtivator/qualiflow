import {
  BUILT_IN_CHANNELS,
  type ConversationAdapter,
  type Lead,
  type Message,
  type Page,
  type PageRequest,
  type Thread
} from "@qualiflow/core";

export type WhatsAppInboundContact = {
  waId: string;
  profileName?: string;
  clientId?: string;
  phoneNumberId?: string;
  countryCode?: string;
  countryName?: string;
  profileImageUrl?: string;
  receivedAt: string;
  updatedAt?: string;
};

export type WhatsAppUserSessionContact = WhatsAppInboundContact;

export type WhatsAppInboundTextMessage = {
  externalMessageId: string;
  waId: string;
  text: string;
  receivedAt: string;
  leadId?: string;
  threadId?: string;
  profileName?: string;
  profileImageUrl?: string;
  phoneNumberId?: string;
};

export type WhatsAppUserSessionTextMessage = WhatsAppInboundTextMessage;

export type CreateWhatsAppAdapterOptions = {
  leads?: Lead[];
  threads?: Thread[];
  messages?: Message[];
};

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, " ") || "";
}

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "");
}

function toEntityId(prefix: string, value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${normalized || "unknown"}`;
}

export function buildWhatsAppDeepLink(waId: string, text?: string) {
  const phoneNumber = normalizePhoneNumber(waId);
  const baseUrl = `https://wa.me/${phoneNumber}`;
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return baseUrl;
  }

  return `${baseUrl}?text=${encodeURIComponent(normalizedText)}`;
}

export function normalizeWhatsAppLead(input: WhatsAppInboundContact): Lead {
  const normalizedWaId = normalizePhoneNumber(input.waId);
  const createdAt = input.receivedAt;
  const updatedAt = input.updatedAt ?? input.receivedAt;

  return {
    id: toEntityId("lead_whatsapp", normalizedWaId),
    clientId: input.clientId,
    displayName: normalizeText(input.profileName) || normalizedWaId,
    countryCode: normalizeText(input.countryCode) || undefined,
    countryName: normalizeText(input.countryName) || undefined,
    profileImageUrl: normalizeText(input.profileImageUrl) || undefined,
    sourceChannelIds: ["whatsapp"],
    stage: "new",
    createdAt,
    updatedAt,
    metadata: {
      whatsappWaId: normalizedWaId,
      whatsappPhoneNumberId: normalizeText(input.phoneNumberId) || null,
      whatsappDeepLink: buildWhatsAppDeepLink(normalizedWaId)
    }
  };
}

export function normalizeWhatsAppTextMessage(input: WhatsAppInboundTextMessage): Message {
  const normalizedWaId = normalizePhoneNumber(input.waId);
  const leadId = input.leadId ?? toEntityId("lead_whatsapp", normalizedWaId);
  const threadId = input.threadId ?? toEntityId("thread_whatsapp", normalizedWaId);

  return {
    id: toEntityId("msg_whatsapp", input.externalMessageId),
    threadId,
    leadId,
    channelId: "whatsapp",
    externalMessageId: input.externalMessageId,
    direction: "inbound",
    status: "delivered",
    visibility: "internal",
    author: {
      displayName: normalizeText(input.profileName) || normalizedWaId,
      role: "lead",
      avatarUrl: normalizeText(input.profileImageUrl) || undefined
    },
    content: {
      type: "text",
      text: normalizeText(input.text)
    },
    receivedAt: input.receivedAt,
    sentAt: input.receivedAt,
    metadata: {
      whatsappWaId: normalizedWaId,
      whatsappPhoneNumberId: normalizeText(input.phoneNumberId) || null
    }
  };
}

function paginate<TItem>(items: TItem[], request?: PageRequest): Page<TItem> {
  const limit = request?.limit ?? items.length;
  const offset = request?.cursor ? Number.parseInt(request.cursor, 10) : 0;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const pageItems = items.slice(safeOffset, safeOffset + limit);
  const nextOffset = safeOffset + pageItems.length;

  return {
    items: pageItems,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined
  };
}

export function createWhatsAppAdapter(options: CreateWhatsAppAdapterOptions = {}): ConversationAdapter {
  const leads = options.leads ?? [];
  const threads = options.threads ?? [];
  const messages = options.messages ?? [];

  return {
    id: "whatsapp",
    label: "WhatsApp",
    channel: BUILT_IN_CHANNELS.whatsapp,
    accountKind: "user_account",
    authMode: "qr_pairing",
    capabilities: ["read_messages", "send_messages", "sync_history", "realtime_events", "read_receipts", "attachments"],
    sessionStorage: "runtime_only",
    async syncMessages() {
      return {
        leads,
        threads,
        messages,
        syncedAt: new Date().toISOString(),
        connectionStatus: "active"
      };
    },
    async listLeads(request) {
      return paginate(leads, request);
    },
    async listThreads(request) {
      const filteredThreads = threads.filter((thread) => {
        if (request?.leadId && thread.leadId !== request.leadId) {
          return false;
        }

        if (request?.clientId && thread.clientId !== request.clientId) {
          return false;
        }

        if (request?.updatedSince && thread.updatedAt < request.updatedSince) {
          return false;
        }

        return thread.channelId === "whatsapp";
      });

      return paginate(filteredThreads, request);
    },
    async listMessages(request) {
      return paginate(
        messages.filter((message) => message.threadId === request.threadId && message.channelId === "whatsapp"),
        request
      );
    }
  };
}

export const whatsappAdapter = createWhatsAppAdapter();
