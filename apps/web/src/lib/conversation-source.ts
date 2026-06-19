import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createAlibabaAdapterFromConversations,
  type AlibabaRawConversation
} from "@qualiflow/adapter-alibaba";
import { createChatAdapter, type ChatRawConversation } from "@qualiflow/adapter-chat";
import {
  getMockChannelById,
  getMockLeadById,
  getMockQualificationByLeadId,
  mockConversationAdapter,
  mockQualifications
} from "@qualiflow/adapter-mock";
import {
  createTelegramAdapterFromUserDialogs,
  type TelegramUserDialog
} from "@qualiflow/adapter-telegram";
import {
  BUILT_IN_CHANNELS,
  type BuiltInChannelId,
  type Channel,
  type ConversationAdapter,
  type Lead,
  type Message,
  type Page
} from "@qualiflow/core";

import type { ConversationSource } from "./conversation-store";

// 실제 채널 데이터(실제 고객 개인정보)는 절대 git에 안 올린다.
// gitignore된 .data/ 폴더에서 채널별 파일을 읽고, 하나도 없으면 mock으로 폴백한다.
//   .data/alibaba-conversations.json      (AlibabaRawConversation[])
//   .data/telegram-dialogs.json           (TelegramUserDialog[] from MTProto/TDLib connector)
//   .data/telegram-conversations.json     (ChatRawConversation[])
//   .data/instagram-conversations.json    (ChatRawConversation[])
//   .data/whatsapp-conversations.json     (ChatRawConversation[])
const DATA_DIR = resolve(process.cwd(), ".data");

// adapter-chat 하나로 처리하는 단순 채팅 채널들.
const CHAT_CHANNELS: BuiltInChannelId[] = ["instagram", "whatsapp"];

async function readJsonArray<TItem>(fileName: string): Promise<TItem[] | null> {
  try {
    const parsed = JSON.parse(await readFile(resolve(DATA_DIR, fileName), "utf8")) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as TItem[]) : null;
  } catch {
    // 파일이 없거나 깨졌으면 그 채널은 건너뛴다(조용히).
    return null;
  }
}

function resolveChannel(channelId: string): Channel {
  return channelId in BUILT_IN_CHANNELS ? BUILT_IN_CHANNELS[channelId as BuiltInChannelId] : BUILT_IN_CHANNELS.manual;
}

// 여러 채널 어댑터를 "한 인박스"로 합치는 aggregate 어댑터.
// (core를 안 건드리려고 여기 웹 레이어에 둔다 — core는 소유 경계)
function createAggregateAdapter(adapters: ConversationAdapter[]): ConversationAdapter {
  async function gather<TItem>(pick: (adapter: ConversationAdapter) => Promise<Page<TItem>>): Promise<Page<TItem>> {
    const pages = await Promise.all(adapters.map(pick));
    return { items: pages.flatMap((page) => page.items) };
  }

  return {
    id: "aggregate",
    label: "All channels",
    channel: BUILT_IN_CHANNELS.manual,
    async listLeads(request) {
      return gather((adapter) => adapter.listLeads?.(request) ?? Promise.resolve({ items: [] as Lead[] }));
    },
    async listThreads(request) {
      return gather((adapter) => adapter.listThreads(request));
    },
    async listMessages(request) {
      // 어느 채널의 thread인지 모르므로 전부에 물어보고 합친다(주인만 메시지를 돌려줌).
      return gather<Message>((adapter) => adapter.listMessages(request));
    }
  };
}

export async function loadConversationSource(): Promise<ConversationSource> {
  const adapters: ConversationAdapter[] = [];
  const loadedChannels: BuiltInChannelId[] = [];

  const alibaba = await readJsonArray<AlibabaRawConversation>("alibaba-conversations.json");
  if (alibaba) {
    adapters.push(createAlibabaAdapterFromConversations(alibaba));
    loadedChannels.push("alibaba");
  }

  const telegramDialogs = await readJsonArray<TelegramUserDialog>("telegram-dialogs.json");
  if (telegramDialogs) {
    adapters.push(createTelegramAdapterFromUserDialogs(telegramDialogs));
    loadedChannels.push("telegram");
  } else {
    const telegramConversations = await readJsonArray<ChatRawConversation>("telegram-conversations.json");
    if (telegramConversations) {
      adapters.push(createChatAdapter("telegram", telegramConversations, { authMode: "phone_code" }));
      loadedChannels.push("telegram");
    }
  }

  for (const channelId of CHAT_CHANNELS) {
    const conversations = await readJsonArray<ChatRawConversation>(`${channelId}-conversations.json`);
    if (conversations) {
      adapters.push(createChatAdapter(channelId, conversations));
      loadedChannels.push(channelId);
    }
  }

  // 채널 데이터가 하나도 없으면 mock으로 폴백(데모 기본).
  if (adapters.length === 0) {
    return {
      status: {
        kind: "mock",
        label: "Mock data",
        detail: "실제 채널 JSON 없음",
        tone: "warning"
      },
      adapter: mockConversationAdapter,
      getLead: getMockLeadById,
      getChannel: getMockChannelById,
      getQualification: getMockQualificationByLeadId,
      gradeACount: mockQualifications.filter((qualification) => qualification.grade === "A").length
    };
  }

  const adapter = createAggregateAdapter(adapters);
  const leadPage = await adapter.listLeads?.();
  const leadById = new Map<string, Lead>();
  for (const lead of leadPage?.items ?? []) {
    leadById.set(lead.id, lead);
  }

  const loadedChannelLabels = loadedChannels.map((channelId) => BUILT_IN_CHANNELS[channelId].label).join(", ");

  return {
    status: {
      kind: "file-json",
      label: "Real JSON preview",
      detail: loadedChannelLabels,
      tone: "ok"
    },
    adapter,
    getLead: (leadId) => leadById.get(leadId),
    getChannel: (channelId) => resolveChannel(channelId),
    // 채널 데이터에는 아직 등급(qualification)이 없다 — 추후 in-product AI가 채울 자리.
    getQualification: () => undefined,
    gradeACount: 0
  };
}
