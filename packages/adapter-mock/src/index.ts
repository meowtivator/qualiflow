import {
  BUILT_IN_CHANNELS,
  type Channel,
  type ChannelId,
  type ConversationAdapter,
  type Lead,
  type LeadQualification,
  type Message,
  type Page,
  type PageRequest,
  type Thread
} from "@qualiflow/core";

export const mockLeads: Lead[] = [
  {
    id: "lead_harbor_beauty",
    clientId: "client_aesthein",
    displayName: "Olivia Grant",
    companyName: "Harbor Beauty Imports",
    countryCode: "US",
    countryName: "United States",
    primaryEmail: "olivia@harborbeauty.example",
    profileImageUrl: "https://i.pravatar.cc/96?u=lead_harbor_beauty",
    sourceChannelIds: ["alibaba", "instagram"],
    stage: "sal",
    subStage: "proposal",
    createdAt: "2026-05-15T08:10:00.000Z",
    updatedAt: "2026-05-24T10:20:00.000Z",
    metadata: {
      alibabaPurchaseGrade: "L3",
      websiteVerified: true,
      sampleStatus: "sent"
    }
  },
  {
    id: "lead_mirae_beauty_hk",
    clientId: "client_aesthein",
    displayName: "Patrick Wong",
    companyName: "Mirae Beauty HK",
    countryCode: "HK",
    countryName: "Hong Kong",
    primaryEmail: "patrick@miraebeauty.example",
    profileImageUrl: "https://i.pravatar.cc/96?u=lead_mirae_beauty_hk",
    sourceChannelIds: ["instagram"],
    stage: "mql",
    subStage: "need_analysis",
    createdAt: "2026-05-16T06:40:00.000Z",
    updatedAt: "2026-05-22T13:00:00.000Z",
    metadata: {
      alibabaPurchaseGrade: "L2",
      websiteVerified: true,
      sampleStatus: "requested"
    }
  },
  {
    id: "lead_bangkok_food",
    clientId: "client_aesthein",
    displayName: "Niran Chai",
    companyName: "Bangkok Food Trading",
    countryCode: "TH",
    countryName: "Thailand",
    profileImageUrl: "https://i.pravatar.cc/96?u=lead_bangkok_food",
    sourceChannelIds: ["email"],
    stage: "mql",
    subStage: "qualification",
    createdAt: "2026-05-18T03:20:00.000Z",
    updatedAt: "2026-05-21T05:00:00.000Z",
    metadata: {
      alibabaPurchaseGrade: "L1",
      websiteVerified: false,
      sampleStatus: "not_requested"
    }
  }
];

export const mockThreads: Thread[] = [
  {
    id: "thread_harbor_alibaba",
    leadId: "lead_harbor_beauty",
    clientId: "client_aesthein",
    channelId: "alibaba",
    externalThreadId: "ali-1001",
    title: "Clinic line import inquiry",
    status: "open",
    priority: "high",
    followUp: "needs_my_reply",
    assigneeId: "user_jaewoo",
    lastMessageAt: "2026-05-24T10:20:00.000Z",
    createdAt: "2026-05-15T08:10:00.000Z",
    updatedAt: "2026-05-24T10:20:00.000Z",
    metadata: {
      nextAction: "Send MOQ and sample follow-up",
      intent: "sample_reorder"
    }
  },
  {
    id: "thread_mirae_instagram",
    leadId: "lead_mirae_beauty_hk",
    clientId: "client_aesthein",
    channelId: "instagram",
    externalThreadId: "ig-822",
    title: "Mask pack sample request",
    status: "pending",
    priority: "normal",
    followUp: "waiting_on_customer",
    assigneeId: "user_jaewoo",
    lastMessageAt: "2026-05-22T13:00:00.000Z",
    createdAt: "2026-05-16T06:40:00.000Z",
    updatedAt: "2026-05-22T13:00:00.000Z",
    metadata: {
      nextAction: "Confirm sample shipping address",
      intent: "sample_request"
    }
  },
  {
    id: "thread_bangkok_email",
    leadId: "lead_bangkok_food",
    clientId: "client_aesthein",
    channelId: "email",
    externalThreadId: "mail-44",
    title: "Small batch ingredient test inquiry",
    status: "open",
    priority: "low",
    followUp: "needs_my_reply",
    assigneeId: "user_jaewoo",
    lastMessageAt: "2026-05-21T05:00:00.000Z",
    createdAt: "2026-05-18T03:20:00.000Z",
    updatedAt: "2026-05-21T05:00:00.000Z",
    metadata: {
      nextAction: "Request business proof before sharing",
      intent: "unclear_fit"
    }
  }
];

export const mockMessages: Message[] = [
  {
    id: "msg_harbor_1",
    threadId: "thread_harbor_alibaba",
    leadId: "lead_harbor_beauty",
    channelId: "alibaba",
    externalMessageId: "ali-msg-1",
    direction: "inbound",
    status: "read",
    visibility: "client_visible",
    author: {
      displayName: "Olivia Grant",
      role: "lead"
    },
    content: {
      type: "text",
      text: "We operate a clinic distribution channel in the US and would like to test your clinic line. Can you share sample options and MOQ?"
    },
    sentAt: "2026-05-15T08:10:00.000Z",
    receivedAt: "2026-05-15T08:10:00.000Z"
  },
  {
    id: "msg_harbor_2",
    threadId: "thread_harbor_alibaba",
    leadId: "lead_harbor_beauty",
    channelId: "alibaba",
    direction: "outbound",
    status: "delivered",
    visibility: "client_visible",
    author: {
      id: "user_jaewoo",
      displayName: "Jaewoo Park",
      role: "operator"
    },
    content: {
      type: "text",
      text: "Thanks for reaching out. We can arrange a sample set first and share MOQ by product line after confirming the target channel."
    },
    sentAt: "2026-05-15T09:00:00.000Z"
  },
  {
    id: "msg_harbor_3",
    threadId: "thread_harbor_alibaba",
    leadId: "lead_harbor_beauty",
    channelId: "alibaba",
    direction: "inbound",
    status: "read",
    visibility: "client_visible",
    author: {
      displayName: "Olivia Grant",
      role: "lead"
    },
    content: {
      type: "text",
      text: "Samples arrived. The team liked the ampoule line. Please send MOQ, lead time, and distributor pricing."
    },
    sentAt: "2026-05-24T10:20:00.000Z",
    receivedAt: "2026-05-24T10:20:00.000Z"
  },
  {
    id: "msg_mirae_1",
    threadId: "thread_mirae_instagram",
    leadId: "lead_mirae_beauty_hk",
    channelId: "instagram",
    direction: "inbound",
    status: "read",
    visibility: "client_visible",
    author: {
      displayName: "Patrick Wong",
      role: "lead"
    },
    content: {
      type: "text",
      text: "Hi, we run a beauty shop in Hong Kong. Can we receive mask pack samples before placing a wholesale order?"
    },
    sentAt: "2026-05-16T06:40:00.000Z",
    receivedAt: "2026-05-16T06:40:00.000Z"
  },
  {
    id: "msg_mirae_2",
    threadId: "thread_mirae_instagram",
    leadId: "lead_mirae_beauty_hk",
    channelId: "instagram",
    direction: "outbound",
    status: "sent",
    visibility: "client_visible",
    author: {
      id: "user_jaewoo",
      displayName: "Jaewoo Park",
      role: "operator"
    },
    content: {
      type: "text",
      text: "Yes, we can review a sample shipment. Could you send your shop website and shipping address?"
    },
    sentAt: "2026-05-22T13:00:00.000Z"
  },
  {
    id: "msg_bangkok_1",
    threadId: "thread_bangkok_email",
    leadId: "lead_bangkok_food",
    channelId: "email",
    direction: "inbound",
    status: "read",
    visibility: "internal",
    author: {
      displayName: "Niran Chai",
      role: "lead"
    },
    content: {
      type: "text",
      text: "We need a small test quantity for food ingredient packaging. Please send your lowest price."
    },
    sentAt: "2026-05-18T03:20:00.000Z",
    receivedAt: "2026-05-18T03:20:00.000Z"
  }
];

export const mockQualifications: LeadQualification[] = [
  {
    id: "qualification_harbor",
    leadId: "lead_harbor_beauty",
    grade: "A",
    confidence: "high",
    summary: "US clinic distribution buyer with sample received and follow-up request for MOQ and distributor pricing.",
    reasons: ["Beauty distribution context is clear", "Sample has already arrived", "Buyer asked for MOQ and lead time"],
    missingEvidence: ["Confirm final distributor pricing tier"],
    recommendedNextAction: "Send MOQ, lead time, and distributor price sheet.",
    visibility: "client_shareable",
    evaluatedBy: "human",
    evaluatedAt: "2026-05-24T10:30:00.000Z",
    signals: [
      {
        id: "signal_harbor_sample",
        leadId: "lead_harbor_beauty",
        source: "alibaba",
        key: "sample_status",
        value: "arrived",
        observedAt: "2026-05-24T10:20:00.000Z"
      },
      {
        id: "signal_harbor_website",
        leadId: "lead_harbor_beauty",
        source: "website",
        key: "business_type",
        value: "clinic_distribution",
        observedAt: "2026-05-15T08:20:00.000Z"
      }
    ]
  },
  {
    id: "qualification_mirae",
    leadId: "lead_mirae_beauty_hk",
    grade: "A",
    confidence: "medium",
    summary: "Hong Kong beauty shop requesting samples before wholesale order.",
    reasons: ["Beauty shop context is stated", "Sample request is explicit"],
    missingEvidence: ["Need website or shop verification", "Need shipping address"],
    recommendedNextAction: "Ask for shop URL and shipping address before sending samples.",
    visibility: "client_shareable",
    evaluatedBy: "model",
    evaluatedAt: "2026-05-22T13:05:00.000Z",
    signals: [
      {
        id: "signal_mirae_sample",
        leadId: "lead_mirae_beauty_hk",
        source: "instagram",
        key: "sample_requested",
        value: true,
        observedAt: "2026-05-16T06:40:00.000Z"
      }
    ]
  },
  {
    id: "qualification_bangkok",
    leadId: "lead_bangkok_food",
    grade: "B",
    confidence: "medium",
    summary: "Inquiry is weak for advertiser sharing because the stated need is food ingredient packaging, not beauty distribution.",
    reasons: ["Industry fit is unclear", "No beauty retail or distributor evidence yet"],
    missingEvidence: ["Business website", "Beauty category relevance", "Sample intent"],
    recommendedNextAction: "Request business proof and clarify whether the buyer handles beauty products.",
    visibility: "internal",
    evaluatedBy: "rule",
    evaluatedAt: "2026-05-21T05:10:00.000Z",
    signals: [
      {
        id: "signal_bangkok_industry",
        leadId: "lead_bangkok_food",
        source: "email",
        key: "industry_fit",
        value: "unclear",
        observedAt: "2026-05-18T03:20:00.000Z"
      }
    ]
  }
];

function paginate<TItem>(items: TItem[], request?: PageRequest): Page<TItem> {
  const start = request?.cursor ? Number(request.cursor) : 0;
  const limit = request?.limit ?? items.length;
  const pageItems = items.slice(start, start + limit);
  const nextIndex = start + pageItems.length;

  return {
    items: pageItems,
    nextCursor: nextIndex < items.length ? String(nextIndex) : undefined
  };
}

export function getMockLeadById(leadId: string): Lead | undefined {
  return mockLeads.find((lead) => lead.id === leadId);
}

export function getMockThreadById(threadId: string): Thread | undefined {
  return mockThreads.find((thread) => thread.id === threadId);
}

export function getMockQualificationByLeadId(leadId: string): LeadQualification | undefined {
  return mockQualifications.find((qualification) => qualification.leadId === leadId);
}

export function getMockChannelById(channelId: ChannelId): Channel {
  const builtInChannel = BUILT_IN_CHANNELS[channelId as keyof typeof BUILT_IN_CHANNELS];

  return (
    builtInChannel ?? {
      id: channelId,
      label: channelId,
      kind: "other",
      icon: {
        type: "initial",
        name: channelId,
        label: channelId
      }
    }
  );
}

export const mockConversationAdapter: ConversationAdapter = {
  id: "mock",
  label: "Mock inbox",
  channel: BUILT_IN_CHANNELS.manual,
  async listLeads(request) {
    return paginate(mockLeads, request);
  },
  async listThreads(request) {
    const filtered = mockThreads.filter((thread) => {
      if (request?.leadId && thread.leadId !== request.leadId) {
        return false;
      }

      if (request?.clientId && thread.clientId !== request.clientId) {
        return false;
      }

      if (request?.updatedSince && thread.updatedAt < request.updatedSince) {
        return false;
      }

      return true;
    });

    return paginate(filtered, request);
  },
  async listMessages(request) {
    const filtered = mockMessages.filter((message) => message.threadId === request.threadId);

    return paginate(filtered);
  },
  async sendMessage(request) {
    const thread = getMockThreadById(request.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${request.threadId}`);
    }

    const sentAt = new Date().toISOString();
    const message: Message = {
      id: `msg_draft_${Date.now()}`,
      threadId: request.threadId,
      leadId: thread.leadId,
      channelId: thread.channelId,
      direction: "outbound",
      status: "draft",
      visibility: "client_visible",
      author: {
        id: "user_local",
        displayName: "Operator",
        role: "operator"
      },
      content: {
        type: "text",
        text: request.text
      },
      sentAt
    };

    return {
      message,
      status: message.status,
      sentAt
    };
  }
};
