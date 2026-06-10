import type { Channel, Lead, LeadQualification, Message, Thread } from "@qualiflow/core";

export type ThreadListItem = {
  thread: Thread;
  lead?: Lead;
  channel: Channel;
  qualification?: LeadQualification;
};

export type MessengerWorkspaceProps = {
  leadCount: number;
  gradeACount: number;
  openThreadCount: number;
  threads: ThreadListItem[];
  selectedThreadId: string;
  selectedLead?: Lead;
  selectedChannel: Channel;
  selectedQualification?: LeadQualification;
  selectedLeadChannels: Channel[];
  messages: Message[];
};
