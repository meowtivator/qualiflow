import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata } from "./primitives";

// 채널 연결 상태. (세션 자체는 워커가 로컬에 보관하고, DB엔 "상태"만 둔다.)
// 이 배열이 단일 출처 — TS 타입과 DB CHECK가 모두 여기서 나온다.
export const CHANNEL_CONNECTION_STATUSES = ["disconnected", "active", "needs_relogin", "error"] as const;
export type ChannelConnectionStatus = (typeof CHANNEL_CONNECTION_STATUSES)[number];

// 채널 계정의 소유 형태. QualiFlow는 기본적으로 운영자의 실제 사용자 계정 inbox를 가져온다.
// bot은 제품 기본값이 아니라, 제한된 relay/import 용도로만 남긴다.
export const CHANNEL_ACCOUNT_KINDS = ["user_account", "business_account", "bot", "manual"] as const;
export type ChannelAccountKind = (typeof CHANNEL_ACCOUNT_KINDS)[number];

// 로그인/연결 방식. 실제 credential/session 값은 이 타입에 저장하지 않는다.
export const CHANNEL_AUTH_MODES = [
  "browser_session",
  "phone_code",
  "qr_pairing",
  "oauth",
  "api_token",
  "manual"
] as const;
export type ChannelAuthMode = (typeof CHANNEL_AUTH_MODES)[number];

export const CHANNEL_CONNECTION_CAPABILITIES = [
  "read_messages",
  "send_messages",
  "sync_history",
  "realtime_events",
  "read_receipts",
  "attachments"
] as const;
export type ChannelConnectionCapability = (typeof CHANNEL_CONNECTION_CAPABILITIES)[number];

export type ChannelSessionStorage = "runtime_only" | "external_secret_store" | "none";

// 내가 연결한 채널 계정 하나. (여러 사용자가 각자 여러 계정을 연결할 수 있다.)
// 비번급 세션은 여기 없다. 여기엔 "누가 어느 계정을 연결했고 상태가 어떤지"만 둔다.
export type ChannelConnection = {
  id: EntityId;
  workspaceId?: EntityId;
  channel: ChannelId;
  accountLabel: string; // 내 계정 구분: "jaeu bag", "thedozers"
  ownerUserId?: EntityId;
  ownerLabel?: string;
  externalAccountId?: string; // 채널 계정 id(aliId 등), 알면
  accountKind?: ChannelAccountKind;
  authMode?: ChannelAuthMode;
  capabilities?: ChannelConnectionCapability[];
  sessionStorage?: ChannelSessionStorage;
  sessionRef?: string; // runtime/secret store의 세션 포인터. 실제 세션 값은 저장하지 않는다.
  status: ChannelConnectionStatus;
  lastSyncedAt?: ISODateTime;
  syncCursor?: string; // 마지막 동기화 지점
  metadata?: Metadata;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
