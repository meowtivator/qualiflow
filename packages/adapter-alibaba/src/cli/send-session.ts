#!/usr/bin/env node

// 알리바바 OneTalk 발송기 — extract-session과 같은 "순수 크롬 + 영구 프로필 + CDP + 쿠키 주입"으로
// 로그인 세션을 재사용해, 지정한 대화를 열고 입력창에 타이핑한 뒤 전송한다.
//
// ⚠️ 입력창/전송버튼 셀렉터는 아직 정찰(reconnaissance)이 안 된 부분이라 best-effort다:
//    여러 후보 셀렉터를 시도하고, 각 단계를 로그로 남긴다(안 되면 그 로그로 셀렉터를 다듬는다).
//
//   env: QUALIFLOW_ALIBABA_PROFILE(프로필), QUALIFLOW_ALIBABA_CONVERSATION(data-cid=대화코드),
//        QUALIFLOW_ALIBABA_TEXT(보낼 텍스트). 정찰용 셀렉터 덮어쓰기: QUALIFLOW_ALIBABA_COMPOSER.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright-core";

import { delay, findChrome, spawnChrome, waitForCdp } from "./chrome-cdp";

const ONETALK_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";
const DEBUG_PORT = 9222;

// 입력창 후보(보이는 것 중 '가장 아래'를 택해 상단 검색창을 피함). 정확한 셀렉터는 QUALIFLOW_ALIBABA_COMPOSER로
// 지정하면 findComposer가 우선 사용한다(그래서 여기 배열엔 넣지 않는다).
const COMPOSER_CANDIDATES = [
  "textarea",
  "div[contenteditable='true']",
  "[contenteditable='true']",
  "[class*='editor'] [contenteditable]",
  "[class*='input'] textarea",
  "[class*='send'] textarea"
];

async function injectCookies(context: BrowserContext, cookiesFile: string): Promise<void> {
  try {
    const cookies = JSON.parse(await readFile(cookiesFile, "utf8")) as Parameters<BrowserContext["addCookies"]>[0];
    if (Array.isArray(cookies) && cookies.length) {
      await context.addCookies(cookies);
      console.log(`백업 세션 쿠키 ${cookies.length}개 주입.`);
    }
  } catch {
    // 파일 없으면 프로필 쿠키로 폴백
  }
}

async function waitForInbox(page: Page): Promise<boolean> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if ((await page.locator(".contact-item-container").count().catch(() => 0)) > 0) {
      return true;
    }
    await delay(500);
  }
  return false;
}

// 입력창 찾기. ①env로 셀렉터를 직접 주면 그걸 우선. ②아니면 후보들 중 '화면 가장 아래' 보이는 것을
// 고른다 — 입력창은 보통 대화 하단에 있어, 상단 검색창(첫 textarea)을 잘못 잡는 걸 피한다.
async function findComposer(page: Page): Promise<{ selector: string; index: number } | null> {
  const override = process.env.QUALIFLOW_ALIBABA_COMPOSER;
  if (override) {
    const locator = page.locator(override).first();
    if (await locator.isVisible().catch(() => false)) {
      return { selector: override, index: 0 };
    }
  }
  let best: { selector: string; index: number; y: number } | null = null;
  for (const selector of COMPOSER_CANDIDATES) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (!(await item.isVisible().catch(() => false))) {
        continue;
      }
      const box = await item.boundingBox().catch(() => null);
      if (box && (!best || box.y > best.y)) {
        best = { selector, index, y: box.y };
      }
    }
  }
  return best ? { selector: best.selector, index: best.index } : null;
}

// 지정한 대화를 열어 입력창에 타이핑 후 전송한다. 에이전트가 함수로 직접 부른다. 실패는 throw.
export async function sendAlibaba(profileDir: string, conversation: string, text: string): Promise<void> {
  if (!conversation || !text) {
    throw new Error("발송할 대화코드(conversation)와 텍스트가 필요합니다.");
  }
  const cookiesFile = `${profileDir}.cookies.json`;
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error("Chrome 실행파일을 못 찾았어요. CHROME_PATH로 지정하세요.");
  }

  const chrome = spawnChrome(chromePath, profileDir, DEBUG_PORT, ONETALK_URL, { offscreen: true });

  try {
    if (!(await waitForCdp(DEBUG_PORT))) {
      throw new Error("크롬 디버그 포트가 안 열렸어요(같은 프로필 크롬 닫고 재시도).");
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    try {
      const context = browser.contexts()[0];
      const page = context.pages()[0] ?? (await context.newPage());
      await injectCookies(context, cookiesFile);
      await page.goto(ONETALK_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);

      if (!(await waitForInbox(page))) {
        throw new Error("세션이 만료됐거나 인박스가 안 떴습니다. 'add alibaba <라벨>'로 재로그인하세요.");
      }

      // 대화 열기: data-cid로 행을 찾아 클릭.
      const row = page.locator(`.contact-item-container[data-cid="${conversation}"]`).first();
      if (!(await row.count().catch(() => 0))) {
        throw new Error(`대화 '${conversation}'(data-cid)를 목록에서 못 찾았습니다.`);
      }
      await row.click({ timeout: 5000 }).catch(() => undefined);
      await delay(2500); // 대화 패널 로딩 대기
      console.log("대화 열림. 입력창 탐색 중...");

      const composer = await findComposer(page);
      if (!composer) {
        throw new Error(
          "입력창을 못 찾았습니다(셀렉터 정찰 필요). QUALIFLOW_ALIBABA_COMPOSER로 정확한 셀렉터를 지정하거나, 화면 구조를 알려주세요."
        );
      }
      console.log(`입력창 발견: ${composer.selector} (#${composer.index})`);

      const input = page.locator(composer.selector).nth(composer.index);
      await input.click({ timeout: 3000 }).catch(() => undefined);
      await input.fill(text).catch(async () => {
        // contenteditable은 fill이 안 먹기도 해서 타이핑으로 폴백
        await page.keyboard.type(text);
      });
      await delay(500);
      await page.keyboard.press("Enter"); // 대다수 IM이 Enter로 전송
      await delay(1500);
      console.log(`📤 Alibaba 발송 시도 완료 → 대화 ${conversation} (Enter 전송). 화면에서 실제 전송 여부를 확인하세요.`);
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    chrome.kill("SIGTERM");
  }
}

// CLI 래퍼(standalone inquiry:send 용).
async function main(): Promise<void> {
  const profileDir = process.env.QUALIFLOW_ALIBABA_PROFILE || resolve("../../.auth/alibaba-chrome-profile");
  const conversation = process.env.QUALIFLOW_ALIBABA_CONVERSATION || "";
  const text = process.env.QUALIFLOW_ALIBABA_TEXT || "";
  try {
    await sendAlibaba(profileDir, conversation, text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// 이 파일을 직접 실행할 때만 CLI 동작(에이전트가 함수로 import할 땐 안 돈다).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
