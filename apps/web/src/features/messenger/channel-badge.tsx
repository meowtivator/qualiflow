import type { Channel } from "@qualiflow/core";

import { getChannelStyle } from "./format";

// 채널 → simpleicons 슬러그(채널 id와 다른 경우만 매핑). 아는 채널은 실제 브랜드 로고, 그 외는 글자 폴백.
const ICON_SLUG: Partial<Record<string, string>> = {
  whatsapp: "whatsapp",
  telegram: "telegram",
  instagram: "instagram",
  alibaba: "alibabadotcom"
};

type ChannelBadgeProps = {
  channel: Channel;
};

export function ChannelBadge({ channel }: ChannelBadgeProps) {
  const slug = ICON_SLUG[channel.id];
  return (
    <span className="channel-badge" style={getChannelStyle(channel)} title={channel.label}>
      {slug ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.simpleicons.org/${slug}/white`}
          alt=""
          referrerPolicy="no-referrer"
          style={{ width: "62%", height: "62%", objectFit: "contain" }}
        />
      ) : channel.icon.type === "brand" ? (
        channel.label[0]
      ) : (
        channel.icon.label[0]
      )}
    </span>
  );
}
