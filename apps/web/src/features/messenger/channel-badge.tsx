import type { Channel } from "@qualiflow/core";

import { getChannelStyle } from "./format";

type ChannelBadgeProps = {
  channel: Channel;
};

export function ChannelBadge({ channel }: ChannelBadgeProps) {
  return (
    <span className="channel-badge" style={getChannelStyle(channel)} title={channel.label}>
      {channel.icon.type === "brand" ? channel.label[0] : channel.icon.label[0]}
    </span>
  );
}
