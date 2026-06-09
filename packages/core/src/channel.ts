import type { Metadata } from "./primitives";

export type BuiltInChannelId =
  | "email"
  | "whatsapp"
  | "instagram"
  | "alibaba"
  | "linkedin"
  | "telegram"
  | "line"
  | "kakao"
  | "wechat"
  | "manual";

export type ChannelId = BuiltInChannelId | (string & {});

export type ChannelKind = "email" | "messaging" | "marketplace" | "social" | "manual" | "other";

export type ChannelIcon = {
  type: "brand" | "initial" | "custom";
  name: string;
  label: string;
};

export type Channel = {
  id: ChannelId;
  label: string;
  kind: ChannelKind;
  icon: ChannelIcon;
  brandColor?: string;
  metadata?: Metadata;
};

export const BUILT_IN_CHANNELS = {
  email: {
    id: "email",
    label: "Email",
    kind: "email",
    icon: { type: "brand", name: "email", label: "Email" },
    brandColor: "#6B7280"
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    kind: "messaging",
    icon: { type: "brand", name: "whatsapp", label: "WhatsApp" },
    brandColor: "#25D366"
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    kind: "social",
    icon: { type: "brand", name: "instagram", label: "Instagram" },
    brandColor: "#E4405F"
  },
  alibaba: {
    id: "alibaba",
    label: "Alibaba",
    kind: "marketplace",
    icon: { type: "brand", name: "alibaba", label: "Alibaba" },
    brandColor: "#FF6A00"
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    kind: "social",
    icon: { type: "brand", name: "linkedin", label: "LinkedIn" },
    brandColor: "#0A66C2"
  },
  telegram: {
    id: "telegram",
    label: "Telegram",
    kind: "messaging",
    icon: { type: "brand", name: "telegram", label: "Telegram" },
    brandColor: "#26A5E4"
  },
  line: {
    id: "line",
    label: "LINE",
    kind: "messaging",
    icon: { type: "brand", name: "line", label: "LINE" },
    brandColor: "#06C755"
  },
  kakao: {
    id: "kakao",
    label: "KakaoTalk",
    kind: "messaging",
    icon: { type: "brand", name: "kakao", label: "KakaoTalk" },
    brandColor: "#FEE500"
  },
  wechat: {
    id: "wechat",
    label: "WeChat",
    kind: "messaging",
    icon: { type: "brand", name: "wechat", label: "WeChat" },
    brandColor: "#07C160"
  },
  manual: {
    id: "manual",
    label: "Manual",
    kind: "manual",
    icon: { type: "initial", name: "manual", label: "Manual" },
    brandColor: "#5E6AD2"
  }
} as const satisfies Record<BuiltInChannelId, Channel>;

export const BUILT_IN_CHANNEL_IDS = Object.keys(BUILT_IN_CHANNELS) as BuiltInChannelId[];
