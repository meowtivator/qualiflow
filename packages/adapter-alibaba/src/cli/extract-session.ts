#!/usr/bin/env node

// 알리바바 OneTalk 라이브 세션 추출기 (route B).
//
// ⚠️ 보안 경계: 이 스크립트는 당신의 "실제 알리바바 로그인"을 담은 storageState 파일을
//    들고 브라우저를 띄운다. 그 파일은 사실상 비밀번호와 동급이다(절대 커밋/공유 금지).
//
// 동작: storageState로 로그인된 브라우저를 띄움 → OneTalk 열기 → 로그인 살아있는지
//   health check → 대화 목록을 하나씩 열며 React 내부 상태(itemData)에서 메시지/바이어를
//   추출 → AlibabaRawConversation[] 를 JSON 파일로 저장(웹앱이 읽는 .data 경로).
//
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:extract
//   준비: 먼저 사람이 한 번 로그인해 storageState를 저장해야 한다(README 참고).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright-core";

import type { AlibabaRawConversation } from "../raw-types";

const DEFAULT_STORAGE_STATE = "../../.auth/alibaba.storage.json";
const DEFAULT_OUTPUT = "../../apps/web/.data/alibaba-conversations.json";
const DEFAULT_URL =
  "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";

type CliArgs = {
  storageState: string;
  output: string;
  url: string;
  headless: boolean;
  browserChannel?: "chrome" | "msedge" | "chromium";
  maxConversations: number;
  perConversationWaitMs: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    storageState: DEFAULT_STORAGE_STATE,
    output: DEFAULT_OUTPUT,
    url: DEFAULT_URL,
    headless: false, // 기본은 화면 보이게(headed) — 봇 탐지를 덜 자극하고, 사람이 지켜볼 수 있게
    browserChannel: "chrome",
    maxConversations: 20,
    perConversationWaitMs: 2500
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--storage-state") (args.storageState = next), (index += 1);
    else if (arg === "--output") (args.output = next), (index += 1);
    else if (arg === "--url") (args.url = next), (index += 1);
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--headed") args.headless = false;
    else if (arg === "--max") (args.maxConversations = Number(next)), (index += 1);
  }

  return args;
}

// 페이지(브라우저) 안에서 실행되는 추출 스크립트.
// React fiber 트리를 훑어 itemData(메시지 객체)를 모은다 — 네트워크가 아니라 메모리에서.
// 반환: { owner, contact, messages } (열려 있는 대화 1개) 또는 null.
const EXTRACT_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  function getAnyFiber() {
    const nodes = document.querySelectorAll("div, span, p");
    for (const el of nodes) {
      const k = fiberKey(el);
      if (k) return el[k];
    }
    return null;
  }
  // fiber 트리의 꼭대기로 올라간 뒤, 전체를 DFS하며 itemData(messageId 보유)를 모은다.
  function collectMessages() {
    let root = getAnyFiber();
    if (!root) return [];
    while (root.return) root = root.return;
    const out = [];
    const seen = new Set();
    const stack = [root];
    let guard = 0;
    while (stack.length && guard < 200000) {
      guard += 1;
      const fiber = stack.pop();
      if (!fiber) continue;
      const p = fiber.memoizedProps;
      const m = p && p.itemData;
      if (m && m.messageId != null && !seen.has(m.messageId)) {
        seen.add(m.messageId);
        out.push(m);
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return out;
  }

  const raw = collectMessages();
  if (!raw.length) return null;

  // 메시지 정리(데이터 필드만, 함수/DOM 제외)
  const messages = raw
    .map((m) => ({
      messageId: m.messageId,
      uuid: m.uuid != null ? String(m.uuid) : undefined,
      conversationCode: m.conversationCode,
      content: typeof m.content === "string" ? m.content : "",
      sendTime: typeof m.sendTime === "number" ? m.sendTime : 0,
      sender: { targetId: m.sender && m.sender.targetId ? String(m.sender.targetId) : "" },
      msgType: m.msgType,
      type: m.type,
      subType: m.subType,
      autoReply: m.autoReply,
      spamStatus: m.spamStatus,
      loginId: m.loginId
    }))
    .filter((m) => m.conversationCode)
    .sort((a, b) => a.sendTime - b.sendTime);

  if (!messages.length) return null;

  // owner/contact 는 메시지 객체 안에 같이 들어 있다(우리가 정찰 때 확인).
  const withParties = raw.find((m) => m.owner && m.contact) || {};
  const owner = withParties.owner || {};
  const contact = withParties.contact || {};

  return {
    owner: { aliId: owner.aliId ? String(owner.aliId) : "", name: owner.name },
    contact: {
      aliId: contact.aliId ? String(contact.aliId) : undefined,
      loginId: contact.loginId,
      name: contact.name,
      companyName: contact.companyName,
      complianceCountryCode: contact.complianceCountryCode
    },
    messages
  };
}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storageStatePath = resolve(args.storageState);
  const outputPath = resolve(args.output);

  // storageState 파일 존재 확인 (없으면 사람이 먼저 로그인해서 저장해야 함)
  try {
    await readFile(storageStatePath, "utf8");
  } catch {
    console.error(
      `로그인 세션 파일이 없습니다: ${storageStatePath}\n` +
        `먼저 한 번 로그인해서 storageState를 저장하세요(README의 "세션 저장" 참고).`
    );
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: args.headless, channel: args.browserChannel });
  const context = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(args.perConversationWaitMs);

  // health check: 로그인 페이지로 튕겼으면 세션 만료
  if (/login|signin|passport/i.test(page.url())) {
    console.error(`세션이 만료된 것 같습니다(로그인 페이지로 이동: ${page.url()}). 다시 로그인 후 storageState를 갱신하세요.`);
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // 대화 목록 행을 찾는다(이름 + 시간이 든 클릭 가능한 행). 셀렉터가 깨지면 라이브에서 보정 필요.
  const rows = page.locator('[class*="conversation"] [class*="item"], [class*="contact-item"], [role="listitem"]');
  const rowCount = Math.min(await rows.count().catch(() => 0), args.maxConversations);

  const conversations: AlibabaRawConversation[] = [];
  const seenCodes = new Set<string>();

  async function extractCurrent() {
    const result = (await page.evaluate(EXTRACT_IN_PAGE).catch(() => null)) as AlibabaRawConversation | null;
    if (result && result.messages.length) {
      const code = result.messages[0]?.conversationCode;
      if (code && !seenCodes.has(code)) {
        seenCodes.add(code);
        conversations.push(result);
      }
    }
  }

  if (rowCount > 0) {
    for (let index = 0; index < rowCount; index += 1) {
      await rows.nth(index).click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(args.perConversationWaitMs);
      await extractCurrent();
    }
  } else {
    // 목록 셀렉터를 못 찾으면 최소한 현재 열린 대화라도 추출
    await extractCurrent();
  }

  await browser.close();

  if (!conversations.length) {
    console.error("추출된 대화가 없습니다. 대화를 하나 연 상태로 다시 시도하거나, 목록 셀렉터를 점검하세요.");
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");
  console.log(`대화 ${conversations.length}개를 저장했습니다: ${outputPath}`);
  console.log("이제 웹앱을 새로고침하면 이 알리바바 데이터가 인박스에 보입니다.");
}

await main();
