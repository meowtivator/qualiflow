"use client";

import { useState } from "react";

import type { Channel, Lead } from "@qualiflow/core";

import { ChannelBadge } from "./channel-badge";
import { getInitials, getLeadLabel } from "./format";

type LeadAvatarProps = {
  channel: Channel;
  lead?: Lead;
  size?: "default" | "large";
};

export function LeadAvatar({ channel, lead, size = "default" }: LeadAvatarProps) {
  const label = getLeadLabel(lead);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? undefined : lead?.profileImageUrl;

  return (
    <div className={`lead-avatar ${size === "large" ? "large" : ""}`} aria-label={`${label} profile`}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="lead-avatar-image"
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{getInitials(lead)}</span>
      )}
      <ChannelBadge channel={channel} />
    </div>
  );
}
