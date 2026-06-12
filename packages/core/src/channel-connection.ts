import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata } from "./primitives";

// 채널 연결 상태. (세션 자체는 워커가 로컬에 보관하고, DB엔 "상태"만 둔다.)
// 이 배열이 단일 출처 — TS 타입과 DB CHECK가 모두 여기서 나온다.
export const CHANNEL_CONNECTION_STATUSES = ["disconnected", "active", "needs_relogin", "error"] as const;
export type ChannelConnectionStatus = (typeof CHANNEL_CONNECTION_STATUSES)[number];

// 내가 연결한 채널 계정 하나. (단일 사용자 가정 — 내가 가진 여러 계정, 인스타 부계정처럼.)
// 비번급 세션은 여기 없다(로컬 파일). 여기엔 "어느 계정을 연결했고 상태가 어떤지"만.
export type ChannelConnection = {
  id: EntityId;
  channel: ChannelId;
  accountLabel: string; // 내 계정 구분: "jaeu bag", "thedozers"
  externalAccountId?: string; // 채널 계정 id(aliId 등), 알면
  status: ChannelConnectionStatus;
  lastSyncedAt?: ISODateTime;
  syncCursor?: string; // 마지막 동기화 지점
  metadata?: Metadata;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
