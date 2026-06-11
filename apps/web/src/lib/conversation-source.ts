import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createAlibabaAdapterFromConversations,
  type AlibabaRawConversation
} from "@qualiflow/adapter-alibaba";
import {
  getMockChannelById,
  getMockLeadById,
  getMockQualificationByLeadId,
  mockConversationAdapter,
  mockQualifications
} from "@qualiflow/adapter-mock";
import {
  BUILT_IN_CHANNELS,
  type Channel,
  type ConversationAdapter,
  type Lead,
  type LeadQualification
} from "@qualiflow/core";

// 실제 알리바바 대화 데이터는 절대 git에 안 올린다(실제 바이어 개인정보).
// gitignore된 이 경로에 파일이 있으면 알리바바를, 없으면 mock을 쓴다.
const REAL_DATA_PATH = resolve(process.cwd(), ".data/alibaba-conversations.json");

export type ConversationSource = {
  kind: "alibaba" | "mock";
  adapter: ConversationAdapter;
  getLead: (leadId: string) => Lead | undefined;
  getChannel: (channelId: string) => Channel;
  getQualification: (leadId: string) => LeadQualification | undefined;
  gradeACount: number;
};

async function readRealConversations(): Promise<AlibabaRawConversation[] | null> {
  try {
    const parsed = JSON.parse(await readFile(REAL_DATA_PATH, "utf8")) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as AlibabaRawConversation[];
    }
    return null;
  } catch {
    // 파일이 없거나 깨졌으면 조용히 mock으로 폴백한다.
    return null;
  }
}

export async function loadConversationSource(): Promise<ConversationSource> {
  const real = await readRealConversations();

  if (real) {
    const adapter = createAlibabaAdapterFromConversations(real);
    const leadPage = await adapter.listLeads?.();
    const leadById = new Map<string, Lead>();
    for (const lead of leadPage?.items ?? []) {
      leadById.set(lead.id, lead);
    }

    return {
      kind: "alibaba",
      adapter,
      getLead: (leadId) => leadById.get(leadId),
      getChannel: (channelId) => (channelId === "alibaba" ? BUILT_IN_CHANNELS.alibaba : BUILT_IN_CHANNELS.manual),
      // 알리바바는 아직 등급(qualification) 데이터가 없다 — 추후 in-product AI가 채울 자리.
      getQualification: () => undefined,
      gradeACount: 0
    };
  }

  return {
    kind: "mock",
    adapter: mockConversationAdapter,
    getLead: getMockLeadById,
    getChannel: getMockChannelById,
    getQualification: getMockQualificationByLeadId,
    gradeACount: mockQualifications.filter((qualification) => qualification.grade === "A").length
  };
}
