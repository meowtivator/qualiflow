import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata, UrlString } from "./primitives";

export type MessageDirection = "inbound" | "outbound";

export type MessageStatus = "draft" | "queued" | "sent" | "delivered" | "read" | "failed";

export type MessageVisibility = "internal" | "client_visible";

// 단일출처 계약: DB messages.author(jsonb)에 이 모양({ role, displayName, ... })으로 저장된다.
//   - writer: ingest_conversations(0011) 가 { role, displayName }을 기록.
//   - reader: 웹(supabase-conversation-source) / buyer-crm 둘 다 이 모양을 읽는다.
//   freeform jsonb라 DB CHECK로 강제되진 않으므로, 구버전/누락 시 reader가 방향 기반 기본값으로 폴백한다.
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
