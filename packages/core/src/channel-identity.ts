import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata, UrlString } from "./primitives";

// 한 사람(Lead)의 채널별 입구. 4B: Lead 1—* ChannelIdentity.
// "알리바바 리드를 왓츠앱으로 확장"(노드 연결)은 두 ChannelIdentity를 같은 leadId에 두는 것.
export type ChannelIdentity = {
  id: EntityId;
  leadId: EntityId; // 이 정체성이 가리키는 사람(Lead)
  channel: ChannelId;
  externalId: string; // 채널 고유 id (aliId·전화번호·핸들 등)
  handle?: string;
  displayName?: string;
  profileImageUrl?: UrlString;
  metadata?: Metadata;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
