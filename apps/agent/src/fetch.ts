// 채널 커넥터 실행 → 정규화 → 요약. 계정별 세션/출력 경로를 써서 다계정을 지원한다.
//   alibaba  : 브라우저 RE(inquiry:extract)를 그대로 호출(로직 미변경). 계정별 프로필/출력은 env로 전달.
//   whatsapp : Baileys(connectors/whatsapp.ts). 계정별 authDir/outputFile 전달.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAlibabaAdapterFromConversations, type AlibabaRawConversation } from "@qualiflow/adapter-alibaba";
import { createChatAdapter, type ChatRawConversation } from "@qualiflow/adapter-chat";
import type { ConversationAdapter } from "@qualiflow/core";

import { dataFile, sessionPath } from "./accounts";
import { fetchInstagram } from "./connectors/instagram";
import { fetchTelegram } from "./connectors/telegram";
import { fetchWhatsApp } from "./connectors/whatsapp";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

export type FetchSummary = {
  channel: string;
  label: string;
  conversationCount: number;
  leadCount: number;
  threadCount: number;
  messageCount: number;
  sample: { lead: string; lastText: string }[];
};

// 정규화 전 raw 대화를 계정별 데이터 파일에 쓴다(웹 인박스가 읽음). whatsapp은 커넥터 내부에서
// 직접 쓰지만, telegram은 데이터를 반환만 하므로 여기서 쓴다.
async function writeChatData(file: string, conversations: ChatRawConversation[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");
}

// 정규화된 어댑터에서 리드/스레드/메시지 수 + 샘플을 뽑는다(채널 공통).
async function summarize(
  channel: string,
  label: string,
  conversationCount: number,
  adapter: ConversationAdapter
): Promise<FetchSummary> {
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

  return { channel, label, conversationCount, leadCount: leads.length, threadCount: threads.length, messageCount, sample };
}

// 알리바바 RE를 계정별 프로필/출력으로 실행한다(로직 미변경, env로 경로만 주입).
function runAlibabaExtractor(profile: string, output: string): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", ["--filter", "@qualiflow/adapter-alibaba", "inquiry:extract"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, QUALIFLOW_ALIBABA_PROFILE: profile, QUALIFLOW_ALIBABA_OUTPUT: output }
    });
    child.on("error", rejectRun);
    child.on("exit", (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`추출기 종료 코드 ${code} (세션 만료면 'add alibaba <라벨>'로 재로그인)`))
    );
  });
}

// 알리바바 로그인(inquiry:login)을 계정별 프로필로 실행한다(add 시 사용).
export function loginAlibaba(profile: string): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", ["--filter", "@qualiflow/adapter-alibaba", "inquiry:login"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, QUALIFLOW_ALIBABA_PROFILE: profile }
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`로그인 종료 코드 ${code}`))));
  });
}

export async function fetchAlibaba(label: string, options: { cached: boolean }): Promise<FetchSummary> {
  const profile = sessionPath("alibaba", label);
  const output = dataFile("alibaba", label);
  if (options.cached) {
    console.log("🗂  --cached: 이미 추출된 데이터를 읽습니다(RE 미실행).");
  } else {
    console.log(`🔌 알리바바(${label}) 커넥터 실행 — 전용 크롬으로 인박스를 읽습니다...`);
    await runAlibabaExtractor(profile, output);
  }
  const raw = JSON.parse(await readFile(output, "utf8")) as AlibabaRawConversation[];
  return summarize("alibaba", label, raw.length, createAlibabaAdapterFromConversations(raw));
}

export async function fetchWhatsAppInbox(label: string): Promise<FetchSummary> {
  console.log(`🔌 WhatsApp(${label}) 커넥터 실행 — Baileys로 WhatsApp Web에 연결합니다...`);
  const conversations = await fetchWhatsApp({
    authDir: sessionPath("whatsapp", label),
    outputFile: dataFile("whatsapp", label)
  });
  return summarize("whatsapp", label, conversations.length, createChatAdapter("whatsapp", conversations));
}

export async function fetchTelegramInbox(label: string): Promise<FetchSummary> {
  console.log(`🔌 Telegram(${label}) 커넥터 실행 — gramjs로 내 계정 인박스를 읽습니다...`);
  const conversations = await fetchTelegram(sessionPath("telegram", label));
  await writeChatData(dataFile("telegram", label), conversations);
  return summarize("telegram", label, conversations.length, createChatAdapter("telegram", conversations));
}

export async function fetchInstagramInbox(label: string): Promise<FetchSummary> {
  console.log(`🔌 Instagram(${label}) 커넥터 실행 — 웹 세션으로 DM API를 읽습니다...`);
  const conversations = await fetchInstagram(sessionPath("instagram", label));
  await writeChatData(dataFile("instagram", label), conversations);
  return summarize("instagram", label, conversations.length, createChatAdapter("instagram", conversations));
}

export async function fetchChannel(channel: string, label: string, options: { cached: boolean }): Promise<FetchSummary> {
  switch (channel) {
    case "alibaba":
      return fetchAlibaba(label, options);
    case "whatsapp":
      return fetchWhatsAppInbox(label);
    case "telegram":
      return fetchTelegramInbox(label);
    case "instagram":
      return fetchInstagramInbox(label);
    default:
      throw new Error(`알 수 없는 채널 '${channel}'. 가능: alibaba, whatsapp, telegram, instagram.`);
  }
}
