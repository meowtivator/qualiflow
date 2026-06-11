import type { ChannelId } from "./channel";
import type { EntityId, ISODateTime, Metadata } from "./primitives";

export type LeadGrade = "A" | "B" | "C";

export type QualificationConfidence = "low" | "medium" | "high";

export type QualificationEvaluator = "human" | "model" | "rule";

export type QualificationVisibility = "internal" | "client_shareable";

export type LeadSignalSource = ChannelId | "website" | "search" | "sheet" | "manual" | "model";

export type LeadSignal = {
  id: EntityId;
  leadId: EntityId;
  source: LeadSignalSource;
  key: string;
  value: string | number | boolean;
  observedAt: ISODateTime;
  metadata?: Metadata;
};

export type LeadQualification = {
  id: EntityId;
  leadId: EntityId;
  grade: LeadGrade;
  confidence: QualificationConfidence;
  summary: string;
  reasons: string[];
  missingEvidence: string[];
  recommendedNextAction?: string;
  visibility: QualificationVisibility;
  evaluatedBy: QualificationEvaluator;
  evaluatedAt: ISODateTime;
  signals?: LeadSignal[];
  metadata?: Metadata;
};
