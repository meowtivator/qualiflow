import type { ChannelId } from "./channel";
import type { CountryCode, EmailAddress, EntityId, ISODateTime, Metadata, UrlString } from "./primitives";

// 영업 퍼널 상위 단계 (회의 모델: New → MQL → SAL → SQL).
// 이 배열이 "단일 출처(single source of truth)" — TS 타입과 DB CHECK 제약이 모두 여기서 나온다.
export const LEAD_STAGES = ["new", "mql", "sal", "sql"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

// 단계별 세부(하위) 단계. New는 세부 없음.
export const LEAD_SUB_STAGES = [
  "qualification", // MQL
  "need_analysis", // MQL
  "get_contact", // MQL
  "direct_contact", // SAL
  "proposal", // SAL
  "order", // SQL
  "second_order" // SQL
] as const;
export type LeadSubStage = (typeof LEAD_SUB_STAGES)[number];

export type Lead = {
  id: EntityId;
  clientId?: EntityId;
  displayName: string;
  companyName?: string;
  countryCode?: CountryCode;
  countryName?: string;
  primaryEmail?: EmailAddress;
  profileImageUrl?: UrlString;
  sourceChannelIds: ChannelId[];
  stage: LeadStage; // 퍼널 상위 단계
  subStage?: LeadSubStage; // 세부 단계(New는 없음)
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: Metadata;
};
