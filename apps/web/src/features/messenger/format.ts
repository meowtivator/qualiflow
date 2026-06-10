import type { CSSProperties } from "react";

import type { Channel, Lead } from "@qualiflow/core";

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function getMetadataText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function getLeadLabel(lead?: Lead) {
  if (!lead) {
    return "Unknown lead";
  }

  return lead.companyName ?? lead.displayName;
}

export function getInitials(lead?: Lead) {
  const label = getLeadLabel(lead);

  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function getChannelStyle(channel: Channel): CSSProperties {
  return {
    "--channel-color": channel.brandColor ?? "#5e6ad2"
  } as CSSProperties;
}
