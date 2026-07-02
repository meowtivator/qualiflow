import type { Channel, ConversationAdapter, Lead, LeadQualification } from "@qualiflow/core";

export type ConversationStoreStatus = {
  label: string;
  detail: string;
  tone: "ok" | "warning";
};

export type ConversationSource = {
  status: ConversationStoreStatus;
  adapter: ConversationAdapter;
  getLead: (leadId: string) => Lead | undefined;
  getChannel: (channelId: string) => Channel;
  getQualification: (leadId: string) => LeadQualification | undefined;
  gradeACount: number;
};
