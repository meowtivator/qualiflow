#!/usr/bin/env node

// 번역기(normalize.ts) 점검기.
// 견본 JSON을 번역기에 넣고, 기대한 결과가 나오는지 확인한다.
// 알리바바 로그인 없이, 1초 만에 "변환 아직 잘 되네"를 검증하는 용도.
//   실행: pnpm --filter @qualiflow/adapter-alibaba run normalize:check

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FOLLOW_UP_STATES, LEAD_STAGES } from "@qualiflow/core";

import { createAlibabaAdapterFromConversations } from "./index.js";
import { normalizeAlibabaConversation } from "./normalize.js";
import type { AlibabaRawConversation } from "./raw-types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "__fixtures__/raw-conversation.json");

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    process.exitCode = 1;
  }
}

const raw = JSON.parse(await readFile(fixturePath, "utf8")) as AlibabaRawConversation;
const { lead, thread, messages } = normalizeAlibabaConversation(raw);

console.log("normalize.check — 알리바바 raw → core 변환 점검\n");
assert("메시지 2개가 변환됨", messages.length === 2);
assert("1번 메시지는 outbound(우리가 보냄)", messages[0].direction === "outbound");
assert("2번 메시지는 inbound(바이어가 보냄)", messages[1].direction === "inbound");
assert("텍스트 내용이 보존됨", messages[0].content.text.startsWith("Hello! Our fresh yellow"));
assert("숫자 시간이 사람이 읽는 시간으로 바뀜", messages[0].sentAt === "2026-06-05T06:10:17.174Z");
assert("thread.id가 conversationCode로 설정됨", thread.id === "2500000000001-3500000000002#11011@icbu");
assert("inbound 작성자 역할이 lead", messages[1].author.role === "lead");

// ── lead(바이어) 변환 점검 ──
assert("바이어 이름이 lead.displayName으로", lead.displayName === "Sample Buyer");
assert("국가코드가 lead.countryCode로", lead.countryCode === "KR");
assert("프로필 이미지 URL이 lead.profileImageUrl로", lead.profileImageUrl === "https://example.com/sample-buyer-profile.jpg");
assert("lead.stage = new (단계 진행은 CRM 몫)", lead.stage === "new");
assert("마지막이 inbound라 followUp = needs_my_reply", thread.followUp === "needs_my_reply");
// 계약 검사: 생산된 값이 core 허용집합 안에 있는지
assert("lead.stage ∈ LEAD_STAGES", (LEAD_STAGES as readonly string[]).includes(lead.stage));
assert("thread.followUp ∈ FOLLOW_UP_STATES", (FOLLOW_UP_STATES as readonly string[]).includes(thread.followUp));

// ── 어댑터에 끼운 뒤 표준 인터페이스로 나오는지(raw → normalize → adapter) ──
const adapter = createAlibabaAdapterFromConversations([raw]);
const leadPage = await adapter.listLeads?.();
const threadPage = await adapter.listThreads();
assert("어댑터 listLeads가 그 lead를 반환", leadPage?.items[0]?.id === lead.id);
assert("어댑터 listThreads가 그 thread를 반환", threadPage.items[0]?.id === thread.id);

console.log("\n변환 결과 (1번 메시지) — 알리바바 말이 QualiFlow 말로 바뀐 모습:");
console.log(JSON.stringify(messages[0], null, 2));

console.log("\n변환 결과 (바이어 → Lead):");
console.log(JSON.stringify(lead, null, 2));
