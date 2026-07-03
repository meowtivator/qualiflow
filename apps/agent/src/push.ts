// 로컬 .data의 '정규화된' 대화를 서버로 push(인그est). 토큰 인증(authedFetch).
// ★정규화 형태({threadId?, contact:{id,...}, messages:[{id,...}]})만 보낸다 — 알리바바 원시형태는
//   건너뛴다(채널 하드코딩이 아니라 '모양'으로 판단). 알리바바 정규화는 후속 PR.
// fetch는 별개다(채널에서 읽어 .data에 저장). 여긴 이미 .data에 있는 걸 올린다.

import { readFile } from "node:fs/promises";

import { INGEST_CONTRACT_VERSION } from "@qualiflow/core";
import type { IngestConversation, IngestResponse, MessageAttachment } from "@qualiflow/core";
import { alibabaToIngestConversations } from "@qualiflow/adapter-alibaba/runtime";

import { dataFile, listAccounts } from "./accounts";
import { authedFetch } from "./api-client";
import { uploadPendingAttachments } from "./media";

// 공통 ingest 형태(@qualiflow/core IngestConversation)인지 '모양으로' 판별한다 — 채널 하드코딩 없음.
function isNormalized(value: unknown): value is IngestConversation[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const first = value[0] as IngestConversation | null;
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
  status: "pushed" | "registered" | "skipped" | "error";
  detail: string;
};

// 채널별 '원시 → 공통 ingest 형태' 정규화기. 등록된 채널(알리바바)은 변환, 그 외는 이미 공통이면 그대로 push.
const NORMALIZERS: Record<string, (raw: unknown) => IngestConversation[]> = {
  alibaba: (raw) => alibabaToIngestConversations(raw as never)
};

// 대화들의 메시지마다 pending 첨부를 업로드해 stored URL로 바꾼다(없으면 그대로). 미디어 없는 푸시엔 영향 없음.
async function resolveConversationMedia(channel: string, conversations: IngestConversation[]): Promise<void> {
  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      const attachments = message.attachments;
      if (Array.isArray(attachments) && attachments.length > 0) {
        message.attachments = await uploadPendingAttachments(channel, attachments as MessageAttachment[]);
      }
    }
  }
}

// 대화 배열을 서버로 ingest한다. conversations=[](빈 배열)이면 RPC(0009)가 대화 루프 전에
// channel_connections 를 status='active' 로 find-or-create 만 하고 lead/thread/msg 는 0 → '연결 등록'만 트리거.
//   (parseIngestRequest 는 빈 배열을 통과시킨다 — 코어 계약 무변경.)
async function ingest(channel: string, label: string, conversations: IngestConversation[]): Promise<PushResult> {
  try {
    const response = await authedFetch("/api/agents/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, accountLabel: label, conversations, version: INGEST_CONTRACT_VERSION })
    });
    const data = (await response.json().catch(() => ({}))) as IngestResponse;
    if (!response.ok || !data.ok) {
      return { channel, label, status: "error", detail: data.message ?? `HTTP ${response.status}` };
    }
    // 빈 배열 등록은 lead/thread/msg 가 0 → "연결됨"으로 구분해 표시(pushed 는 실제 대화가 올라간 것).
    const status = conversations.length === 0 ? "registered" : "pushed";
    return {
      channel,
      label,
      status,
      detail:
        status === "registered"
          ? "연결 등록(메시지 0건)"
          : `lead+${data.leadsCreated ?? 0} thread+${data.threadsCreated ?? 0} msg+${data.messagesCreated ?? 0}`
    };
  } catch (error) {
    return { channel, label, status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

// 단일 계정 push. 대화가 있으면 그걸 올리고, 없으면(파일 없음/정규화 0건) 빈 ingest 1회로 클라우드 연결만 등록.
//   ★비즈니스 규칙: 로그인만 하고 메시지 0건인 계정도 클라우드(channel_connections)에 status='active' 로 등록한다.
//     (연결흐름 개편: 로그인 성공 = 클라우드 등록. 예전엔 대화가 있어야만 등록돼 프론트와 어긋났다.)
export async function pushAccount(channel: string, label: string): Promise<PushResult> {
  const raw = await readConversations(channel, label);
  const normalizer = NORMALIZERS[channel];
  const conversations = raw === null ? null : normalizer ? normalizer(raw) : isNormalized(raw) ? raw : null;
  if (!conversations || conversations.length === 0) {
    return ingest(channel, label, []); // 빈 등록(find-or-create만)
  }
  // 미디어: 메시지의 pending 첨부(로컬 캐시)를 서버로 올려 stored URL로 갱신한 뒤 ingest로 보낸다.
  await resolveConversationMedia(channel, conversations);
  return ingest(channel, label, conversations);
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
