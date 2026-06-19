#!/usr/bin/env node

// 알리바바 OneTalk 라이브 추출기 (route B) — "순수 크롬 + 영구 프로필 + CDP".
//
// ⚠️ 왜 순수 크롬인가: Playwright가 launch한 크롬은 자동화 흔적(navigator.webdriver 등)이 있어
//    OneTalk/CAPTCHA가 탐지해 깨진다. 그래서 자동화 플래그 없는 "그냥 크롬"을 띄우고(원격디버깅
//    포트만 열고) 거기 CDP로 "붙어서" 읽는다. 로그인 세션은 inquiry:login 이 만든 영구 프로필
//    (.auth/alibaba-chrome-profile)을 재사용한다(= 읽기는 자동, 로그인은 사람).
//
//   준비: 먼저 pnpm --filter @qualiflow/adapter-alibaba run inquiry:login 으로 로그인.
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:extract

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright-core";

import type { AlibabaRawConversation } from "../raw-types";

const PROFILE_DIR = resolve("../../.auth/alibaba-chrome-profile");
const OUTPUT_PATH = resolve("../../apps/web/.data/alibaba-conversations.json");
const ONETALK_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";
const DEBUG_PORT = 9222;
const MAX_CONVERSATIONS = 30;
const WAIT_MS = 2500; // 페이지 첫 로딩 대기
const OPEN_TIMEOUT_MS = 10_000; // 한 대화를 열고 그 대화 메시지가 fiber에 뜰 때까지 최대 대기
const POLL_MS = 400; // 폴링 간격
const MAX_SCROLLS = 60; // 한 대화에서 위로 스크롤하며 옛 메시지를 끌어올 최대 횟수(폭주 방지 상한)
const SCROLL_WAIT_MS = 800; // 한 번 스크롤한 뒤 옛 메시지가 그려지거나(가상 리스트) 불러와질(지연 로딩) 때까지 대기

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter((value): value is string => Boolean(value));

async function findChrome(): Promise<string | null> {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 후보
    }
  }
  return null;
}

async function waitForCdp(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      // 아직 준비 안 됨
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  return false;
}

// 페이지 안에서 실행되는 추출 스크립트: React fiber 트리를 훑어 itemData(메시지)를 모은다.
const EXTRACT_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  // 정찰로 확인: 열린 대화의 메시지는 각 DOM 요소의 fiber에서 위로 몇 단계 안에 itemData(메시지)로 들어있다.
  // (루트에서 아래로 DFS 하던 옛 방식은 메시지 패널이 다른 fiber 루트면 못 찾았다 → 모든 요소에서 위로 훑는다.)
  function collectMessages() {
    const out = [];
    const seen = new Set();
    const nodes = document.querySelectorAll("div, span, p");
    for (const el of nodes) {
      const k = fiberKey(el);
      if (!k) continue;
      let fiber = el[k];
      let hops = 0;
      while (fiber && hops < 8) {
        const p = fiber.memoizedProps;
        const m = p && p.itemData;
        if (m && m.messageId != null && !seen.has(m.messageId)) {
          seen.add(m.messageId);
          out.push(m);
        }
        fiber = fiber.return;
        hops += 1;
      }
    }
    return out;
  }

  const raw = collectMessages();
  if (!raw.length) return null;

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
      complianceCountryCode: contact.complianceCountryCode,
      profileImageUrl:
        contact.profileImageUrl ||
        contact.avatarUrl ||
        contact.avatar ||
        contact.headImageUrl ||
        contact.headUrl ||
        contact.logoUrl
    },
    messages
  };
}
`;

// 메시지 패널(스크롤 컨테이너)을 한 화면의 80%만큼 위로 올린다(20% 겹쳐서 빠뜨리지 않게).
// 반환: { found(스크롤 컨테이너 찾음), atTop(맨 위 도달) }. 짧은 대화는 컨테이너가 안 넘쳐 found:false.
const SCROLL_UP_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  // 메시지 요소 하나 찾기(itemData.messageId 가진 fiber의 DOM).
  let msgEl = null;
  for (const el of document.querySelectorAll("div, span, p")) {
    const k = fiberKey(el);
    if (!k) continue;
    let fiber = el[k];
    let hops = 0;
    while (fiber && hops < 8) {
      const m = fiber.memoizedProps && fiber.memoizedProps.itemData;
      if (m && m.messageId != null) { msgEl = el; break; }
      fiber = fiber.return;
      hops += 1;
    }
    if (msgEl) break;
  }
  if (!msgEl) return { found: false, atTop: true };
  // 그 요소에서 위로 올라가며 스크롤 가능한 조상(메시지 패널)을 찾는다.
  let c = msgEl;
  while (c && c !== document.body) {
    const s = getComputedStyle(c);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && c.scrollHeight > c.clientHeight + 10) break;
    c = c.parentElement;
  }
  if (!c || c === document.body) return { found: false, atTop: true };
  const before = c.scrollTop;
  c.scrollTop = Math.max(0, before - Math.floor(c.clientHeight * 0.8));
  return { found: true, atTop: c.scrollTop === 0 };
}
`;

// ⚠️ 위 둘은 "() => {...}" 문자열. Playwright는 문자열을 표현식으로만 평가하고 함수를 호출하지
//    않으므로 (…)() 로 감싸 "호출되게" 한다(안 그러면 함수값→undefined→0).
const EXTRACT_CALL = `(${EXTRACT_IN_PAGE})()`;
const SCROLL_CALL = `(${SCROLL_UP_IN_PAGE})()`;

function buildReadRowProfileImageScript(cid: string | null, index: number) {
  const serialized = JSON.stringify({ cid, index });

  return String.raw`
    (() => {
      const args = ${serialized};
      const rows = Array.from(document.querySelectorAll(".contact-item-container"));
      const row = args.cid
        ? rows.find((item) => item.getAttribute("data-cid") === args.cid)
        : rows[args.index];

      if (!row) return undefined;

      function absolutize(value) {
        if (!value || typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return undefined;
        try {
          return new URL(trimmed, location.href).href;
        } catch {
          return undefined;
        }
      }

      function fromBackground(value) {
        const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/);
        return match ? absolutize(match[2]) : undefined;
      }

      const candidates = [];
      for (const image of Array.from(row.querySelectorAll("img"))) {
        candidates.push(image.currentSrc, image.src, image.getAttribute("data-src"), image.getAttribute("data-original"));
      }
      for (const element of Array.from(row.querySelectorAll("*"))) {
        candidates.push(
          element.getAttribute("data-avatar"),
          element.getAttribute("data-avatar-url"),
          element.getAttribute("data-profile-image-url"),
          element.getAttribute("data-src"),
          fromBackground(getComputedStyle(element).backgroundImage)
        );
      }

      for (const candidate of candidates) {
        const url = absolutize(candidate);
        if (url && /^https?:\/\//.test(url)) return url;
      }

      return undefined;
    })()
  `;
}

async function main() {
  const chromePath = await findChrome();
  if (!chromePath) {
    console.error("Chrome 실행파일을 못 찾았어요. CHROME_PATH 환경변수로 경로를 지정하세요.");
    process.exitCode = 1;
    return;
  }

  // 자동화 플래그 없는 "그냥 크롬" + inquiry:login 이 만든 영구 프로필.
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      ONETALK_URL
    ],
    { stdio: "ignore" }
  );

  const ready = await waitForCdp(DEBUG_PORT);
  if (!ready) {
    console.error("크롬 디버그 포트가 안 열렸어요. 같은 프로필을 쓰는 다른 크롬 창이 떠 있으면 닫고 다시 시도하세요.");
    chrome.kill("SIGTERM");
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(ONETALK_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(WAIT_MS);

  if (/login|signin|passport/i.test(page.url())) {
    console.error("세션이 만료된 것 같아요(로그인 페이지로 이동). 다시 inquiry:login 으로 로그인하세요.");
    await browser.close();
    chrome.kill("SIGTERM");
    process.exitCode = 1;
    return;
  }

  // 클릭을 가로막는 모달(예: 오프라인 안내 팝업)을 닫는다. 안 닫으면 대화 클릭이 막혀 0개가 나온다.
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(500);
  await page
    .locator(".next-dialog-close, .im-next-dialog-close, [class*='dialog-close']")
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
  // 문자열로 평가(인라인 함수로 두면 tsc가 Node lib에 DOM 없다고 에러). 런타임은 그대로 동작.
  await page
    .evaluate(`document.querySelectorAll(".im-next-overlay-wrapper").forEach((el) => el.remove())`)
    .catch(() => undefined);

  // 대화 목록 행 (정찰로 확인: div.contact-item-container, data-cid=conversationCode)
  const rows = page.locator(".contact-item-container");
  const rowCount = Math.min(await rows.count().catch(() => 0), MAX_CONVERSATIONS);

  const conversations: AlibabaRawConversation[] = [];
  const seenCodes = new Set<string>();

  // 한 대화를 연 뒤, 그 대화(cid)의 메시지가 fiber에 나타날 때까지 폴링한다(WebSocket 로딩 대기).
  // cid가 일치하면 "확실히 이 대화" → 채택. 일치 못 해도 패널이 안정되면(같은 code 2회 연속) 채택.
  async function waitForConversation(expectedCid: string | null): Promise<AlibabaRawConversation | null> {
    const deadline = Date.now() + OPEN_TIMEOUT_MS;
    let lastCode: string | undefined;
    let stable: AlibabaRawConversation | null = null;
    while (Date.now() < deadline) {
      const result = (await page.evaluate(EXTRACT_CALL).catch(() => null)) as AlibabaRawConversation | null;
      if (result && result.messages.length) {
        const code = result.messages[0]?.conversationCode;
        if (expectedCid && code === expectedCid) return result; // 확실히 이 대화
        if (code && code === lastCode) stable = result; // 잔상 아니라 패널이 안정됨
        lastCode = code;
      }
      await page.waitForTimeout(POLL_MS);
    }
    return stable;
  }

  console.log(`대화 목록 행 ${rowCount}개 발견. 하나씩 열고, 위로 스크롤하며 전체 이력 추출...`);
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const cid = await row.getAttribute("data-cid").catch(() => null);
    const dataName = await row.getAttribute("data-name").catch(() => null);
    const dataAliId = await row.getAttribute("data-ali-id").catch(() => null);
    const profileImageUrl = (await page.evaluate(buildReadRowProfileImageScript(cid, index)).catch(() => undefined)) as
      | string
      | undefined;

    await row.click({ timeout: 5000 }).catch(() => undefined);
    const first = await waitForConversation(cid);
    if (!first || !first.messages.length) {
      console.log(`  [${index + 1}/${rowCount}] 건너뜀(메시지 못 뜸)`);
      continue;
    }

    const code = first.messages[0]?.conversationCode || cid || "";
    if (!code || seenCodes.has(code)) {
      console.log(`  [${index + 1}/${rowCount}] 건너뜀(중복/무효 코드)`);
      continue;
    }
    seenCodes.add(code);

    // 가상 리스트라 한 화면에 ~20개만 그려진다. 위로 한 화면씩 올리며 매 스냅샷을 messageId로 누적.
    const byId = new Map<number | string, AlibabaRawConversation["messages"][number]>();
    const merge = (snap: AlibabaRawConversation | null) => {
      if (!snap) return;
      for (const m of snap.messages) {
        if (m.conversationCode === code && m.messageId != null && !byId.has(m.messageId)) {
          byId.set(m.messageId, m);
        }
      }
    };
    merge(first);

    let scrolls = 0;
    let stable = 0; // 스크롤했는데 새 메시지가 안 늘어난 연속 횟수
    while (scrolls < MAX_SCROLLS) {
      const scroll = (await page.evaluate(SCROLL_CALL).catch(() => null)) as { found: boolean; atTop: boolean } | null;
      await page.waitForTimeout(SCROLL_WAIT_MS);
      const before = byId.size;
      merge((await page.evaluate(EXTRACT_CALL).catch(() => null)) as AlibabaRawConversation | null);
      stable = byId.size === before ? stable + 1 : 0;
      scrolls += 1;
      // 맨 위 도달(또는 스크롤 컨테이너 없음=짧은 대화) + 2회 연속 새 메시지 없음 → 끝.
      if ((!scroll || !scroll.found || scroll.atTop) && stable >= 2) break;
    }

    const messages = [...byId.values()].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));
    conversations.push({
      owner: first.owner,
      contact: {
        ...first.contact,
        name: first.contact.name || dataName || undefined,
        aliId: first.contact.aliId || dataAliId || undefined,
        profileImageUrl: first.contact.profileImageUrl || profileImageUrl
      },
      messages
    });
    const capped = scrolls >= MAX_SCROLLS ? " ⚠️상한도달(더 있을 수 있음)" : "";
    console.log(`  [${index + 1}/${rowCount}] ${messages.length}개 메시지 (스크롤 ${scrolls}회)${capped}`);
  }

  await browser.close();
  chrome.kill("SIGTERM");

  if (!conversations.length) {
    console.error("추출된 대화가 없습니다. 대화를 하나 연 상태로 다시 시도하거나, 목록 셀렉터를 점검하세요.");
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");
  console.log(`대화 ${conversations.length}개를 저장했습니다: ${OUTPUT_PATH}`);
}

await main();
