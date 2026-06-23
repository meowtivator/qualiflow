// 알리바바 커넥터 실행: 기존 RE(inquiry:extract)를 그대로 호출해 라이브 인박스를 읽고 정규화한다.
// ★RE 로직은 재작성하지 않는다 — 호출 '위치'만 에이전트로 옮긴다(자식 프로세스로 실행).
//   live : 전용 크롬을 띄워 실제 OneTalk 인박스를 읽는다(로그인 세션 필요, 창이 뜸).
//   --cached : RE를 안 돌리고 이미 추출된 .data를 읽어 정규화만(라이브 세션 없이 빠른 확인).

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAlibabaAdapterFromConversations, type AlibabaRawConversation } from "@qualiflow/adapter-alibaba";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
const DATA_FILE = process.env.QUALIFLOW_DATA_DIR
  ? resolve(process.env.QUALIFLOW_DATA_DIR, "alibaba-conversations.json")
  : resolve(REPO_ROOT, "apps/web/.data/alibaba-conversations.json");

// 기존 추출기를 그대로 실행한다(순수 크롬 + 영구 프로필 + CDP). 로직 미변경, 호출만.
function runExtractor(): Promise<void> {
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

export type FetchSummary = {
  conversationCount: number;
  leadCount: number;
  threadCount: number;
  messageCount: number;
  sample: { lead: string; lastText: string }[];
};

export async function fetchAlibaba(options: { cached: boolean }): Promise<FetchSummary> {
  if (options.cached) {
    console.log("🗂  --cached: 이미 추출된 데이터를 읽습니다(RE 미실행).");
  } else {
    console.log("🔌 알리바바 커넥터 실행 — 전용 크롬으로 인박스를 읽습니다(로그인 세션 필요)...");
    await runExtractor();
  }

  const raw = JSON.parse(await readFile(DATA_FILE, "utf8")) as AlibabaRawConversation[];

  // 정규화는 새로 짜지 않고 기존 어댑터를 재사용(공유 계약).
  const adapter = createAlibabaAdapterFromConversations(raw);
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

  return {
    conversationCount: raw.length,
    leadCount: leads.length,
    threadCount: threads.length,
    messageCount,
    sample
  };
}
