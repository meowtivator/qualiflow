import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata, UrlString } from "./primitives";

export type MessageDirection = "inbound" | "outbound";

export type MessageStatus = "draft" | "queued" | "sent" | "delivered" | "read" | "failed";

export type MessageVisibility = "internal" | "customer_visible";

export type MessageAuthor = {
  id?: EntityId;
  displayName: string;
  role: "lead" | "operator" | "system";
  avatarUrl?: UrlString;
};

export type TextMessageContent = {
  type: "text";
  text: string;
};

export type MessageAttachment = {
  id: EntityId;
  fileName: string;
  mimeType: string;
  url: UrlString;
};

export type MessageContent = TextMessageContent;

export type Message = {
  id: EntityId;
  threadId: EntityId;
  leadId: EntityId;
  channelId: ChannelId;
  externalMessageId?: string;
  direction: MessageDirection;
  status: MessageStatus;
  visibility: MessageVisibility;
  author: MessageAuthor;
  content: MessageContent;
  attachments?: MessageAttachment[];
  sentAt: ISODateTime;
  receivedAt?: ISODateTime;
  metadata?: Metadata;
};
