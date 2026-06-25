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

export type MessageAttachmentKind = "image" | "video" | "audio" | "file";

// 메시지에 딸린 미디어(사진·영상·파일). DB messages.attachments(jsonb 배열)에 이 모양으로 저장된다.
//   - source="channel-url": 채널 CDN URL을 그대로 가리킨다(만료될 수 있음 — instagram/alibaba).
//   - source="pending": 채널에 공개 URL이 없어 다운로드 대기 중(telegram/whatsapp). url 없음, externalRef로 추후 다운로드.
//   - source="stored": 우리 저장소에 재호스팅 완료 → url이 안정적(영구).
//   - source="skipped": 크기/형식 제한으로 안 받음(미디어가 있었다는 사실만 보존). url 없음.
//   - source="error": 다운로드/업로드 실패. url 없음.
// url을 옵셔널로 둔 건 'pending/skipped/error' 상태(아직 또는 영영 url이 없음)를 표현하기 위함이다.
export type MessageAttachment = {
  id: EntityId;
  kind: MessageAttachmentKind;
  fileName: string;
  mimeType: string;
  url?: UrlString;
  source: "channel-url" | "stored" | "pending" | "skipped" | "error";
  thumbnailUrl?: UrlString;
  caption?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  externalRef?: string;
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
