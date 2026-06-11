import {
  BUILT_IN_CHANNELS,
  type ConversationAdapter,
  type Lead,
  type Message,
  type Page,
  type PageRequest,
  type Thread
} from "@qualiflow/core";

import { normalizeAlibabaConversation } from "./normalize";
import type { AlibabaRawConversation } from "./raw-types";

// 외부(웹앱 등)에서 raw 대화를 타입과 함께 다룰 수 있게 re-export.
export type {
  AlibabaRawConversation,
  AlibabaRawMessage,
  AlibabaRawContact,
  AlibabaBuyerActivity,
  AlibabaBuyerOrderCounts
} from "./raw-types";
export { normalizeAlibabaConversation, normalizeAlibabaContact, normalizeAlibabaMessage } from "./normalize";

export type AlibabaPurchaseGrade = "L1" | "L2" | "L3" | "L4" | (string & {});

export type AlibabaInboundBuyer = {
  externalLeadId: string;
  buyerName: string;
  clientId?: string;
  companyName?: string;
  countryCode?: string;
  countryName?: string;
  region?: string;
  inquiryText?: string;
  productInterest?: string[];
  purchaseGrade?: AlibabaPurchaseGrade;
  sourceUrl?: string;
  receivedAt: string;
  updatedAt?: string;
};

export type AlibabaDiscoveryTarget = "web" | "instagram" | "linkedin" | "facebook";

export type AlibabaDiscoveryCandidate = {
  id: string;
  target: AlibabaDiscoveryTarget;
  label: string;
  query: string;
  url: string;
  evidence: string[];
};

export type CreateAlibabaAdapterOptions = {
  leads?: Lead[];
  threads?: Thread[];
  messages?: Message[];
};

const DISCOVERY_TARGETS: Record<AlibabaDiscoveryTarget, { label: string; prefix?: string }> = {
  web: {
    label: "Web"
  },
  instagram: {
    label: "Instagram",
    prefix: "site:instagram.com"
  },
  linkedin: {
    label: "LinkedIn",
    prefix: "site:linkedin.com"
  },
  facebook: {
    label: "Facebook",
    prefix: "site:facebook.com"
  }
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

function buildGoogleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function uniqueQueryParts(parts: string[]) {
  return parts.map(normalizeText).filter(Boolean);
}

function createCandidate(
  target: AlibabaDiscoveryTarget,
  queryId: string,
  parts: string[],
  evidence: string[]
): AlibabaDiscoveryCandidate | null {
  const queryParts = uniqueQueryParts(parts);

  if (queryParts.length < 2) {
    return null;
  }

  const targetConfig = DISCOVERY_TARGETS[target];
  const baseQuery = queryParts.join(" ");
  const query = targetConfig.prefix ? `${targetConfig.prefix} ${baseQuery}` : baseQuery;

  return {
    id: `${target}_${queryId}`,
    target,
    label: `${targetConfig.label}: ${baseQuery}`,
    query,
    url: buildGoogleSearchUrl(query),
    evidence
  };
}

export function buildAlibabaDiscoveryCandidates(input: AlibabaInboundBuyer): AlibabaDiscoveryCandidate[] {
  const buyerName = normalizeText(input.buyerName);
  const companyName = normalizeText(input.companyName);
  const location = normalizeText(input.region || input.countryName || input.countryCode);
  const candidates: AlibabaDiscoveryCandidate[] = [];

  const queryGroups = [
    {
      id: "buyer_location",
      parts: [buyerName, location],
      evidence: ["buyerName", input.region ? "region" : input.countryName ? "countryName" : "countryCode"]
    },
    {
      id: "buyer_company",
      parts: [buyerName, companyName],
      evidence: ["buyerName", "companyName"]
    },
    {
      id: "buyer_company_location",
      parts: [buyerName, companyName, location],
      evidence: ["buyerName", "companyName", input.region ? "region" : input.countryName ? "countryName" : "countryCode"]
    },
    {
      id: "company_location",
      parts: [companyName, location],
      evidence: ["companyName", input.region ? "region" : input.countryName ? "countryName" : "countryCode"]
    }
  ];

  for (const queryGroup of queryGroups) {
    for (const target of Object.keys(DISCOVERY_TARGETS) as AlibabaDiscoveryTarget[]) {
      const candidate = createCandidate(target, queryGroup.id, queryGroup.parts, queryGroup.evidence);

      if (candidate && !candidates.some((item) => item.query === candidate.query)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

export function normalizeAlibabaLead(input: AlibabaInboundBuyer): Lead {
  const createdAt = input.receivedAt;
  const updatedAt = input.updatedAt ?? input.receivedAt;
  const discoveryCandidates = buildAlibabaDiscoveryCandidates(input);

  return {
    id: toEntityId("lead_alibaba", input.externalLeadId),
    clientId: input.clientId,
    displayName: normalizeText(input.buyerName) || "Unknown Alibaba buyer",
    companyName: normalizeText(input.companyName) || undefined,
    countryCode: normalizeText(input.countryCode) || undefined,
    countryName: normalizeText(input.countryName) || undefined,
    sourceChannelIds: ["alibaba"],
    lifecycleStage: input.inquiryText ? "contacted" : "new",
    createdAt,
    updatedAt,
    metadata: {
      alibabaExternalLeadId: input.externalLeadId,
      alibabaPurchaseGrade: input.purchaseGrade ?? null,
      region: normalizeText(input.region) || null,
      sourceUrl: normalizeText(input.sourceUrl) || null,
      inquiryText: normalizeText(input.inquiryText) || null,
      productInterest: input.productInterest ?? [],
      discoveryCandidateCount: discoveryCandidates.length
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

export function createAlibabaAdapter(options: CreateAlibabaAdapterOptions = {}): ConversationAdapter {
  const leads = options.leads ?? [];
  const threads = options.threads ?? [];
  const messages = options.messages ?? [];

  return {
    id: "alibaba",
    label: "Alibaba",
    channel: BUILT_IN_CHANNELS.alibaba,
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

        return thread.channelId === "alibaba";
      });

      return paginate(filteredThreads, request);
    },
    async listMessages(request) {
      return paginate(
        messages.filter((message) => message.threadId === request.threadId && message.channelId === "alibaba"),
        request
      );
    }
  };
}

export const alibabaAdapter = createAlibabaAdapter();

// 참고: 헤드리스(Playwright) 코드는 일부러 여기서 re-export하지 않는다.
// index.ts는 브라우저/서버 어디서나 번들 가능한 "순수" 진입점으로 유지하고,
// Node 전용 headless는 CLI가 "./headless.js"에서 직접 import한다.

// 알리바바 raw 대화들을 받아 정규화한 뒤, 표준 ConversationAdapter로 묶어 반환한다.
// raw → normalize(번역) → adapter(표준 인터페이스) 전체를 한 번에 잇는 입구.
// (실제 세션에서 긁어오는 코드가 붙기 전까지는 견본/캡처 대화를 끼워 동작을 확인하는 용도)
export function createAlibabaAdapterFromConversations(
  conversations: AlibabaRawConversation[]
): ConversationAdapter {
  const leads: Lead[] = [];
  const threads: Thread[] = [];
  const messages: Message[] = [];

  for (const conversation of conversations) {
    const normalized = normalizeAlibabaConversation(conversation);
    leads.push(normalized.lead);
    threads.push(normalized.thread);
    messages.push(...normalized.messages);
  }

  return createAlibabaAdapter({ leads, threads, messages });
}
