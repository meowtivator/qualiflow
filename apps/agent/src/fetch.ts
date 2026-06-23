// 채널 커넥터 실행 → 정규화 → 요약. 채널별로 런타임이 다르다:
//   alibaba  : 브라우저 RE(기존 inquiry:extract)를 그대로 호출(로직 미변경, 호출 위치만 에이전트로).
//   whatsapp : Baileys(브라우저 없이 WhatsApp Web 멀티디바이스 프로토콜) — connectors/whatsapp.ts.
// 정규화는 새로 짜지 않고 기존 어댑터(@qualiflow/adapter-*)를 재사용한다(공유 계약).

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAlibabaAdapterFromConversations, type AlibabaRawConversation } from "@qualiflow/adapter-alibaba";
import { createChatAdapter } from "@qualiflow/adapter-chat";
import type { ConversationAdapter } from "@qualiflow/core";

import { fetchWhatsApp } from "./connectors/whatsapp";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
const ALIBABA_DATA = process.env.QUALIFLOW_DATA_DIR
  ? resolve(process.env.QUALIFLOW_DATA_DIR, "alibaba-conversations.json")
  : resolve(REPO_ROOT, "apps/web/.data/alibaba-conversations.json");

export type FetchSummary = {
  channel: string;
  conversationCount: number;
  leadCount: number;
  threadCount: number;
  messageCount: number;
  sample: { lead: string; lastText: string }[];
};

// 정규화된 어댑터에서 리드/스레드/메시지 수 + 샘플을 뽑는다(채널 공통).
async function summarize(channel: string, conversationCount: number, adapter: ConversationAdapter): Promise<FetchSummary> {
  const leadPage = await adapter.listLeads?.();
  const threadPage = await adapter.listThreads();
  const leads = leadPage?.items ?? [];
  const threads = threadPage.items;
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  let messageCount = 0;
  const sample: FetchSummary["sample"] = [];
  for (const thread of threads) {
    const messagePage = await adapter.listMessages({ threadId: thread.id });
    messageCount += messagePage.items.length;
    if (sample.length < 5) {
      const last = messagePage.items.at(-1);
      sample.push({
        lead: leadById.get(thread.leadId)?.displayName ?? thread.leadId,
        lastText: last?.content.text.slice(0, 60) ?? ""
      });
    }
  }

  return { channel, conversationCount, leadCount: leads.length, threadCount: threads.length, messageCount, sample };
}

// 알리바바 RE(inquiry:extract)를 그대로 자식 프로세스로 실행한다. 로직 미변경, 호출만.
function runAlibabaExtractor(): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", ["--filter", "@qualiflow/adapter-alibaba", "inquiry:extract"], {
      cwd: REPO_ROOT,
      stdio: "inherit"
    });
    child.on("error", rejectRun);
    child.on("exit", (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`추출기 종료 코드 ${code} (세션 만료면 inquiry:login 후 재시도)`))
    );
  });
}

export async function fetchAlibaba(options: { cached: boolean }): Promise<FetchSummary> {
  if (options.cached) {
    console.log("🗂  --cached: 이미 추출된 데이터를 읽습니다(RE 미실행).");
  } else {
    console.log("🔌 알리바바 커넥터 실행 — 전용 크롬으로 인박스를 읽습니다(로그인 세션 필요)...");
    await runAlibabaExtractor();
  }
  const raw = JSON.parse(await readFile(ALIBABA_DATA, "utf8")) as AlibabaRawConversation[];
  return summarize("alibaba", raw.length, createAlibabaAdapterFromConversations(raw));
}

export async function fetchWhatsAppInbox(): Promise<FetchSummary> {
  console.log("🔌 WhatsApp 커넥터 실행 — Baileys로 WhatsApp Web에 연결합니다...");
  const conversations = await fetchWhatsApp();
  return summarize("whatsapp", conversations.length, createChatAdapter("whatsapp", conversations));
}

// 채널 라우터. 아직 리더가 없는 채널은 정직하게 알린다.
export async function fetchChannel(channel: string, options: { cached: boolean }): Promise<FetchSummary> {
  switch (channel) {
    case "alibaba":
      return fetchAlibaba(options);
    case "whatsapp":
      return fetchWhatsAppInbox();
    case "instagram":
    case "telegram":
      throw new Error(`아직 '${channel}' 커넥터(리더)가 없습니다. 현재 가능: alibaba, whatsapp.`);
    default:
      throw new Error(`알 수 없는 채널 '${channel}'. 가능: alibaba, whatsapp.`);
  }
}
