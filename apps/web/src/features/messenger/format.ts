import type { CSSProperties } from "react";

import type { Channel, Lead } from "@qualiflow/core";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDate(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp + KST_OFFSET_MS);
}

export function formatShortDate(value: string) {
  const date = toKstDate(value);

  if (!date) {
    return "-";
  }

  return `${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`;
}

export function formatTime(value: string) {
  const date = toKstDate(value);

  if (!date) {
    return "--:--";
  }

  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  return `${hour}:${minute}`;
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
