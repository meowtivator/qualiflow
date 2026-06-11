import type { Channel } from "./channel";
import type { Lead } from "./lead";
import type { Message } from "./message";
import type { Page, PageRequest } from "./primitives";
import type { Thread } from "./thread";

export type AdapterIdentity = {
  id: string;
  label: string;
  channel: Channel;
};

export type ListThreadsRequest = PageRequest & {
  leadId?: string;
  clientId?: string;
  updatedSince?: string;
};

export type ListMessagesRequest = PageRequest & {
  threadId: string;
};

export type SendMessageRequest = {
  threadId: string;
  text: string;
};

export type ConversationAdapter = AdapterIdentity & {
  listLeads?(request?: PageRequest): Promise<Page<Lead>>;
  listThreads(request?: ListThreadsRequest): Promise<Page<Thread>>;
  listMessages(request: ListMessagesRequest): Promise<Page<Message>>;
  sendMessage?(request: SendMessageRequest): Promise<Message>;
};
