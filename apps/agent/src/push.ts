// 로컬 .data의 '정규화된' 대화를 서버로 push(인그est). 토큰 인증(authedFetch).
// ★정규화 형태({threadId?, contact:{id,...}, messages:[{id,...}]})만 보낸다 — 알리바바 원시형태는
//   건너뛴다(채널 하드코딩이 아니라 '모양'으로 판단). 알리바바 정규화는 후속 PR.
// fetch는 별개다(채널에서 읽어 .data에 저장). 여긴 이미 .data에 있는 걸 올린다.

import { readFile } from "node:fs/promises";

import { alibabaToIngestConversations } from "@qualiflow/adapter-alibaba/runtime";

import { dataFile, listAccounts } from "./accounts";
import { authedFetch } from "./api-client";

type NormalizedConversation = {
  threadId?: string;
  contact?: { id?: string; name?: string; handle?: string };
  // attachments는 그대로 서버로 흘려보낸다(여기선 모양 검증만, 미디어 구조는 core MessageAttachment).
  messages?: Array<{ id?: string; text?: string; sentAt?: string; direction?: string; attachments?: unknown[] }>;
};

function isNormalized(value: unknown): value is NormalizedConversation[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const first = value[0] as NormalizedConversation | null;
  const firstMessage = first?.messages?.[0];
  // 공통 스키마는 contact.id(문자열) + messages[].id 를 가진다. 알리바바 원시형태는 contact.aliId/messageId라
  // 여기서 걸러져 skip된다(채널 하드코딩 없이 모양으로 판별).
  return Boolean(
    first &&
      typeof first === "object" &&
      typeof first.contact?.id === "string" &&
      Array.isArray(first.messages) &&
      (first.messages.length === 0 || typeof firstMessage?.id === "string")
  );
}

async function readConversations(channel: string, label: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(dataFile(channel, label), "utf8"));
  } catch {
    return null; // 파일 없음/깨짐
  }
}

export type PushResult = {
  channel: string;
  label: string;
  status: "pushed" | "skipped" | "error";
  detail: string;
};

// 채널별 '원시 → 공통 ingest 형태' 정규화기. 등록된 채널(알리바바)은 변환, 그 외는 이미 공통이면 그대로 push.
const NORMALIZERS: Record<string, (raw: unknown) => NormalizedConversation[]> = {
  alibaba: (raw) => alibabaToIngestConversations(raw as never)
};

async function pushAccount(channel: string, label: string): Promise<PushResult> {
  const raw = await readConversations(channel, label);
  if (raw === null) {
    return { channel, label, status: "skipped", detail: "대화 파일 없음(먼저 fetch)" };
  }
  const normalizer = NORMALIZERS[channel];
  const conversations = normalizer ? normalizer(raw) : isNormalized(raw) ? raw : null;
  if (!conversations || conversations.length === 0) {
    return { channel, label, status: "skipped", detail: "정규화 결과 없음/미지원 형태" };
  }
  try {
    const response = await authedFetch("/api/agents/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, accountLabel: label, conversations })
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      leadsCreated?: number;
      threadsCreated?: number;
      messagesCreated?: number;
    };
    if (!response.ok || !data.ok) {
      return { channel, label, status: "error", detail: data.message ?? `HTTP ${response.status}` };
    }
    return {
      channel,
      label,
      status: "pushed",
      detail: `lead+${data.leadsCreated ?? 0} thread+${data.threadsCreated ?? 0} msg+${data.messagesCreated ?? 0}`
    };
  } catch (error) {
    return { channel, label, status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

// 등록된 모든 계정의 캐시된 대화를 서버로 push.
export async function pushAllAccounts(): Promise<PushResult[]> {
  const accounts = await listAccounts();
  const results: PushResult[] = [];
  for (const account of accounts) {
    results.push(await pushAccount(account.channel, account.label));
  }
  return results;
}
