import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata } from "./primitives";

export type ThreadStatus = "open" | "pending" | "snoozed" | "resolved" | "archived";

export type ThreadPriority = "low" | "normal" | "high" | "urgent";

export type Thread = {
  id: EntityId;
  leadId: EntityId;
  clientId?: EntityId;
  channelId: ChannelId;
  externalThreadId?: string;
  title?: string;
  status: ThreadStatus;
  priority: ThreadPriority;
  assigneeId?: EntityId;
  lastMessageAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: Metadata;
};
