import type { Channel } from "./channel";
import type {
  ChannelAccountKind,
  ChannelAuthMode,
  ChannelConnectionCapability,
  ChannelConnectionStatus,
  ChannelSessionStorage
} from "./channel-connection";
import type { Lead } from "./lead";
import type { Message, MessageStatus, MessageVisibility } from "./message";
import type { EntityId, ISODateTime, Metadata } from "./primitives";
import type { Page, PageRequest } from "./primitives";
import type { Thread } from "./thread";

export type AdapterIdentity = {
  id: string;
  label: string;
  channel: Channel;
  accountKind?: ChannelAccountKind;
  authMode?: ChannelAuthMode;
  capabilities?: ChannelConnectionCapability[];
  sessionStorage?: ChannelSessionStorage;
};

export type ListThreadsRequest = PageRequest & {
  leadId?: string;
  clientId?: string;
  updatedSince?: string;
};

export type ListMessagesRequest = PageRequest & {
  threadId: string;
};

export type SyncMessagesRequest = PageRequest & {
  channelConnectionId?: EntityId;
  updatedSince?: ISODateTime;
  cursor?: string;
};

export type SyncMessagesResult = {
  leads: Lead[];
  threads: Thread[];
  messages: Message[];
  syncedAt: ISODateTime;
  nextCursor?: string;
  connectionStatus?: ChannelConnectionStatus;
  metadata?: Metadata;
};

export type SendMessageRequest = {
  threadId: string;
  channelConnectionId?: EntityId;
  text: string;
  visibility?: MessageVisibility;
  metadata?: Metadata;
};

export type SendMessageResult = {
  message: Message;
  externalMessageId?: string;
  status: MessageStatus;
  sentAt: ISODateTime;
  metadata?: Metadata;
};

export type ConversationAdapter = AdapterIdentity & {
  syncMessages?(request?: SyncMessagesRequest): Promise<SyncMessagesResult>;
  listLeads?(request?: PageRequest): Promise<Page<Lead>>;
  listThreads(request?: ListThreadsRequest): Promise<Page<Thread>>;
  listMessages(request: ListMessagesRequest): Promise<Page<Message>>;
  sendMessage?(request: SendMessageRequest): Promise<SendMessageResult>;
};
