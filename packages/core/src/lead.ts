import type { ChannelId } from "./channel";
import type { CountryCode, EmailAddress, EntityId, ISODateTime, Metadata, UrlString } from "./primitives";

export type LeadLifecycleStage =
  | "new"
  | "contacted"
  | "qualified"
  | "sample_requested"
  | "sample_sent"
  | "negotiating"
  | "won"
  | "lost"
  | "archived";

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
  lifecycleStage: LeadLifecycleStage;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metadata?: Metadata;
};
