// 채널 읽기(코어): 지금은 fixture(가짜 견본)로 "읽기 → 정규화" 파이프라인을 검증한다.
// 정규화는 새로 짜지 않고 기존 어댑터(@qualiflow/adapter-alibaba)를 그대로 재사용한다(공유 계약).
// 다음 단계에서 fixture 자리에 실제 RE(기존 inquiry:extract 로직)가 들어간다.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAlibabaAdapterFromConversations, type AlibabaRawConversation } from "@qualiflow/adapter-alibaba";

const here = dirname(fileURLToPath(import.meta.url));

export type ReadSummary = {
  leadCount: number;
  threadCount: number;
  messageCount: number;
  sample: { thread: string; lead: string; lastText: string; direction: string }[];
};

export async function readSampleInbox(): Promise<ReadSummary> {
  const raw = JSON.parse(
    await readFile(resolve(here, "../fixtures/sample-conversation.json"), "utf8")
  ) as AlibabaRawConversation;

  // 어댑터가 raw 대화를 Lead/Thread/Message로 정규화한다.
  const adapter = createAlibabaAdapterFromConversations([raw]);
  const leadPage = await adapter.listLeads?.();
  const threadPage = await adapter.listThreads();

  const leads = leadPage?.items ?? [];
  const threads = threadPage.items;
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));

  let messageCount = 0;
  const sample: ReadSummary["sample"] = [];

  for (const thread of threads) {
    const messagePage = await adapter.listMessages({ threadId: thread.id });
    messageCount += messagePage.items.length;
    const last = messagePage.items.at(-1);

    sample.push({
      thread: thread.title ?? thread.id,
      lead: leadById.get(thread.leadId)?.displayName ?? thread.leadId,
      lastText: last?.content.text.slice(0, 70) ?? "",
      direction: last?.direction ?? "-"
    });
  }

  return { leadCount: leads.length, threadCount: threads.length, messageCount, sample };
}
