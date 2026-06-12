import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata } from "./primitives";

export type ThreadStatus = "open" | "pending" | "snoozed" | "resolved" | "archived";

export type ThreadPriority = "low" | "normal" | "high" | "urgent";

// 팔로업: "내가 응답해야 하나"의 분류 깃발(운영자 관점, 카톡 읽음/안읽음 느낌).
// none=액션 불필요(기본) / needs_my_reply=내가 답해야 함 / waiting_on_customer=고객 답 기다림.
export const FOLLOW_UP_STATES = ["none", "needs_my_reply", "waiting_on_customer"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

export type Thread = {
  id: EntityId;
  leadId: EntityId;
  clientId?: EntityId;
  channelId: ChannelId;
  channelIdentityId?: EntityId; // 4B: 이 대화가 어느 채널 정체성(ChannelIdentity)인지
  externalThreadId?: string;
  title?: string;
  status: ThreadStatus;
  priority: ThreadPriority;
  followUp: FollowUpState; // F4: 내 액션 필요 여부
  assigneeId?: EntityId;
  lastMessageAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: Metadata;
};
