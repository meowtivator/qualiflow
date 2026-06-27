// 채널 커넥터 실행 → 정규화 → 요약. 계정별 세션/출력 경로를 써서 다계정을 지원한다.
//   alibaba  : 브라우저 RE를 함수로 직접 호출(@qualiflow/adapter-alibaba/runtime). 계정별 프로필 인자로 전달.
//   whatsapp : Baileys(connectors/whatsapp.ts). 계정별 authDir/outputFile 전달.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createAlibabaAdapterFromConversations, type AlibabaRawConversation } from "@qualiflow/adapter-alibaba";
import {
  discoverBuyerSns,
  extractAlibaba,
  findChrome,
  loginAlibaba as runLoginAlibaba,
  sendAlibaba as runSendAlibaba
} from "@qualiflow/adapter-alibaba/runtime";
import { createChatAdapter, type ChatRawConversation } from "@qualiflow/adapter-chat";
import type { ConversationAdapter } from "@qualiflow/core";

import { dataFile, listAccounts, sessionPath } from "./accounts";
import { fetchInstagram, sendInstagram } from "./connectors/instagram";
import { fetchTelegram, sendTelegram } from "./connectors/telegram";
import { fetchWhatsApp, sendWhatsApp } from "./connectors/whatsapp";

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

// --cached: 커넥터를 안 띄우고 저장된 데이터 파일을 그대로 읽는다(오프라인 재요약).
async function readChatData(file: string): Promise<ChatRawConversation[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatRawConversation[]) : [];
  } catch {
    return [];
  }
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

// 알리바바 로그인을 계정별 프로필로 실행한다(add 시 사용). runtime 함수에 위임(서브프로세스 아님).
export function loginAlibaba(profile: string): Promise<void> {
  return runLoginAlibaba(profile);
}

// ────────────────────────────────────────────────────────────────────────
// SNS 디스커버리(옵트인) — 추출한 바이어를 회사명+국가로 웹 검색해 후보 instagram/linkedin/facebook
// URL을 찾아 각 conversation.contact.sns 에 실어 둔다(그 뒤 normalize 가 metadata.sns 로 흘림).
//
// ★옵트인: 환경변수 ALIBABA_SNS 가 설정됐을 때만 동작. 기본 fetch는 절대 안 느려진다(검색 안 함).
// ★best-effort: 한 바이어 검색이 실패해도 전체 fetch를 깨지 않는다(per-buyer try/catch).
// ★스로틀: 동시에 최대 ALIBABA_SNS_CONCURRENCY(기본 3)개만, 각 검색 사이 ALIBABA_SNS_DELAY_MS(기본
//   1500ms) 지연 → 검색엔진 차단/과부하 위험을 줄인다. discoverBuyerSns 는 자체적으로 헤드리스
//   브라우저(playwright-core)를 띄우므로, 사용자가 이미 깐 크롬을 executablePath 로 재사용한다.
// ────────────────────────────────────────────────────────────────────────
const SNS_CONCURRENCY = Math.max(1, Number(process.env.ALIBABA_SNS_CONCURRENCY) || 3);
const SNS_DELAY_MS = Math.max(0, Number(process.env.ALIBABA_SNS_DELAY_MS) || 1500);

async function enrichAlibabaSns(raw: AlibabaRawConversation[]): Promise<number> {
  // 회사명이 있어야 의미 있는 검색이 된다(이름만으론 동명이인이 많아 노이즈). 회사명 없는 바이어는 건너뜀.
  const targets = raw.filter((conversation) => Boolean(conversation.contact.companyName));
  if (targets.length === 0) {
    console.log("   (SNS) 회사명이 있는 바이어가 없어 검색을 건너뜁니다.");
    return 0;
  }

  // 사용자가 이미 깐 크롬을 재사용(없으면 undefined → playwright 기본 채널 시도). 헤드리스로 돈다.
  const executablePath = (await findChrome()) ?? undefined;
  console.log(
    `🔎 (SNS) ${targets.length}명 디스커버리 시작 — 동시 ${SNS_CONCURRENCY}개, 간격 ${SNS_DELAY_MS}ms${
      executablePath ? " (설치된 크롬 재사용)" : ""
    }.`
  );

  let filled = 0;
  let cursor = 0;

  // 워커 SNS_CONCURRENCY개가 같은 큐(targets)를 나눠 처리한다. 한 바이어 실패는 그 바이어만 건너뛴다.
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const conversation = targets[cursor];
      cursor += 1;
      const contact = conversation.contact;
      try {
        const sns = await discoverBuyerSns(
          { company: contact.companyName, country: contact.complianceCountryCode, buyerName: contact.name },
          { headless: true, executablePath }
        );
        if (sns) {
          contact.sns = sns; // ★추출 raw에 직접 실어 둔다 → normalize 가 metadata.sns 로 흘린다.
          filled += 1;
        }
      } catch (error) {
        // best-effort: 이 바이어만 건너뛴다(전체 fetch는 계속).
        console.log(`   (SNS) "${contact.name ?? contact.companyName}" 검색 실패 — 건너뜀:`, error instanceof Error ? error.message : error);
      }
      if (SNS_DELAY_MS > 0 && cursor < targets.length) {
        await new Promise((resolve) => setTimeout(resolve, SNS_DELAY_MS));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SNS_CONCURRENCY, targets.length) }, () => worker()));
  console.log(`   (SNS) 완료 — ${filled}/${targets.length}명에서 후보 SNS를 찾았습니다.`);
  return filled;
}

export async function fetchAlibaba(label: string, options: { cached: boolean }): Promise<FetchSummary> {
  const profile = sessionPath("alibaba", label);
  const output = dataFile("alibaba", label);
  let raw: AlibabaRawConversation[];
  if (options.cached) {
    console.log("🗂  --cached: 이미 추출된 데이터를 읽습니다(RE 미실행).");
    raw = JSON.parse(await readFile(output, "utf8")) as AlibabaRawConversation[];
  } else {
    console.log(`🔌 알리바바(${label}) 커넥터 실행 — 전용 크롬으로 인박스를 읽습니다...`);
    raw = await extractAlibaba(profile); // 함수 직접 호출 → 대화 반환
    // ★옵트인(ALIBABA_SNS): 추출 직후 SNS 디스커버리로 contact.sns 를 채운다(실패해도 fetch는 계속).
    //   --cached 경로는 RE를 안 띄우는 오프라인 재요약이라 SNS도 건너뛴다(라이브 검색 없음).
    if (process.env.ALIBABA_SNS) {
      try {
        await enrichAlibabaSns(raw);
      } catch (error) {
        console.log("   (SNS) 디스커버리 단계 실패 — SNS 없이 진행:", error instanceof Error ? error.message : error);
      }
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }
  return summarize("alibaba", label, raw.length, createAlibabaAdapterFromConversations(raw));
}

export async function fetchWhatsAppInbox(label: string, options: { cached: boolean } = { cached: false }): Promise<FetchSummary> {
  const file = dataFile("whatsapp", label);
  let conversations: ChatRawConversation[];
  if (options.cached) {
    console.log(`🗂  WhatsApp(${label}) --cached: 저장된 데이터를 읽습니다(연결 안 함).`);
    conversations = await readChatData(file);
  } else {
    console.log(`🔌 WhatsApp(${label}) 커넥터 실행 — Baileys로 WhatsApp Web에 연결합니다...`);
    conversations = await fetchWhatsApp({ authDir: sessionPath("whatsapp", label), outputFile: file });
  }
  return summarize("whatsapp", label, conversations.length, createChatAdapter("whatsapp", conversations));
}

export async function fetchTelegramInbox(label: string, options: { cached: boolean } = { cached: false }): Promise<FetchSummary> {
  const file = dataFile("telegram", label);
  let conversations: ChatRawConversation[];
  if (options.cached) {
    console.log(`🗂  Telegram(${label}) --cached: 저장된 데이터를 읽습니다(연결 안 함).`);
    conversations = await readChatData(file);
  } else {
    console.log(`🔌 Telegram(${label}) 커넥터 실행 — gramjs로 내 계정 인박스를 읽습니다...`);
    conversations = await fetchTelegram(sessionPath("telegram", label));
    await writeChatData(file, conversations);
  }
  return summarize("telegram", label, conversations.length, createChatAdapter("telegram", conversations));
}

export async function fetchInstagramInbox(label: string, options: { cached: boolean } = { cached: false }): Promise<FetchSummary> {
  const file = dataFile("instagram", label);
  let conversations: ChatRawConversation[];
  if (options.cached) {
    console.log(`🗂  Instagram(${label}) --cached: 저장된 데이터를 읽습니다(연결 안 함).`);
    conversations = await readChatData(file);
  } else {
    console.log(`🔌 Instagram(${label}) 커넥터 실행 — 웹 세션으로 DM API를 읽습니다...`);
    conversations = await fetchInstagram(sessionPath("instagram", label));
    await writeChatData(file, conversations);
  }
  return summarize("instagram", label, conversations.length, createChatAdapter("instagram", conversations));
}

// 등록된 모든 계정을 한 번에 fetch한다(한 채널이 실패해도 나머지는 계속). "한꺼번에 확인" 용도.
export async function fetchAllAccounts(options: { cached: boolean }): Promise<FetchSummary[]> {
  const accounts = await listAccounts();
  if (!accounts.length) {
    console.log("등록된 계정이 없습니다. 'add <channel> <label>'로 추가하세요.");
    return [];
  }
  const summaries: FetchSummary[] = [];
  for (const account of accounts) {
    console.log(`\n──── ${account.channel} / ${account.label} ────`);
    try {
      summaries.push(await fetchChannel(account.channel, account.label, options));
    } catch (error) {
      console.error(`  ⚠️ 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summaries;
}

export async function fetchChannel(channel: string, label: string, options: { cached: boolean }): Promise<FetchSummary> {
  switch (channel) {
    case "alibaba":
      return fetchAlibaba(label, options);
    case "whatsapp":
      return fetchWhatsAppInbox(label, options);
    case "telegram":
      return fetchTelegramInbox(label, options);
    case "instagram":
      return fetchInstagramInbox(label, options);
    default:
      throw new Error(`알 수 없는 채널 '${channel}'. 가능: alibaba, whatsapp, telegram, instagram.`);
  }
}

// 불러온 대화의 threadId + 이름 목록(발송 대상을 고를 때 쓴다). 저장된 데이터에서 읽는다.
export async function listChannelThreads(channel: string, label: string): Promise<{ id: string; name: string }[]> {
  if (channel === "alibaba") {
    try {
      const raw = JSON.parse(await readFile(dataFile("alibaba", label), "utf8")) as AlibabaRawConversation[];
      return raw
        .map((conversation) => ({
          id: conversation.messages[0]?.conversationCode ?? "",
          name: conversation.contact?.name ?? conversation.contact?.loginId ?? "?"
        }))
        .filter((thread) => thread.id);
    } catch {
      return [];
    }
  }
  const raw = await readChatData(dataFile(channel, label));
  return raw.map((conversation) => ({ id: conversation.threadId, name: conversation.contact?.name ?? conversation.contact?.id ?? "?" }));
}

// 채널별 발송 라우터. recipient = "me"(나에게 — 텔레/왓츠앱) | 불러온 대화의 threadId(실제 채팅방).
export async function sendMessage(channel: string, label: string, recipient: string, text: string): Promise<void> {
  switch (channel) {
    case "telegram":
      return sendTelegram(sessionPath("telegram", label), recipient, text);
    case "whatsapp":
      return sendWhatsApp({ authDir: sessionPath("whatsapp", label), to: recipient, text });
    case "instagram":
      if (recipient === "me") {
        throw new Error("인스타는 'me' 발송이 없습니다. 불러온 대화의 threadId를 쓰세요(예: 내가 관리하는 테스트 대화).");
      }
      return sendInstagram(sessionPath("instagram", label), recipient, text);
    case "alibaba":
      if (recipient === "me") {
        throw new Error("알리바바는 'me' 발송이 없습니다. 불러온 대화의 threadId(대화코드)를 쓰세요.");
      }
      return runSendAlibaba(sessionPath("alibaba", label), recipient, text);
    default:
      throw new Error(`알 수 없는 채널 '${channel}'. 가능: alibaba, whatsapp, telegram, instagram.`);
  }
}
