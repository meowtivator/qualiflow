// Instagram 커넥터 — mautrix-meta 방식: DOM 스크랩도, 모바일 사칭 API도 아니라
// "instagram.com 웹 세션(쿠키) + IG 내부 웹 API(/api/v1/direct_v2/inbox/)"를 쓴다.
//   - 기존 IG 브라우저 로그인(영구 프로필)을 재사용 → 로그인된 페이지 '안에서' 인박스 API를 호출
//     (page.evaluate fetch → 쿠키 자동 첨부, same-origin이라 CORS 없음). 구조화 JSON이라 안정적이고,
//     진짜 웹 세션이라 모바일 사칭 API보다 계정 정지 위험이 낮다.
//   - 세션은 영구 프로필(.auth/instagram[--label])에 로컬 저장(★서버로 안 감).

import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import { chromium, type Page } from "playwright-core";

const DEBUG_PORT = 9223;
const INBOX_URL = "https://www.instagram.com/direct/inbox/";
const IG_APP_ID = "936619743392459"; // 인스타그램 웹 앱 id(공개값)
const LOGIN_TIMEOUT_MS = Number(process.env.QUALIFLOW_LOGIN_TIMEOUT_MS) || 5 * 60 * 1000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter((value): value is string => Boolean(value));

async function findChrome(): Promise<string> {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 후보
    }
  }
  throw new Error("Chrome 실행파일을 못 찾았어요. CHROME_PATH 환경변수로 경로를 지정하세요.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForCdp(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {
      // 아직 준비 안 됨
    }
    await delay(400);
  }
  return false;
}

type IgItem = { item_id?: string; item_type?: string; text?: string; timestamp?: number | string; user_id?: number | string };
type IgThread = {
  thread_id?: string;
  thread_title?: string;
  users?: { pk?: number | string; username?: string; full_name?: string }[];
  items?: IgItem[];
};
type IgInbox = { viewer?: { pk?: number | string }; inbox?: { threads?: IgThread[] } };

// 로그인된 IG 페이지 안에서 인박스 API를 호출하는 스크립트(문자열 — page.evaluate가 DOM 타입 없이 평가).
// 쿠키는 자동 첨부(same-origin), X-IG-App-ID/X-CSRFToken 헤더만 붙인다. 비로그인/만료면 null.
const INBOX_SCRIPT = `(async () => {
  try {
    var csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
    var res = await fetch("/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=20&persistentBadging=true&limit=20", {
      headers: { "X-IG-App-ID": "${IG_APP_ID}", "X-CSRFToken": csrf },
      credentials: "include"
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
})()`;

async function callInbox(page: Page): Promise<IgInbox | null> {
  const result = await page.evaluate(INBOX_SCRIPT).catch(() => null);
  return (result as IgInbox | null) ?? null;
}

function spawnChrome(profileDir: string, chromePath: string): ChildProcess {
  return spawn(
    chromePath,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      INBOX_URL
    ],
    { stdio: "ignore" }
  );
}

// 브라우저를 띄워 로그인된 페이지에 접근하는 공통 골격. fn 안에서 page로 작업한다.
async function withInstagramPage<T>(profileDir: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const chromePath = await findChrome();
  const chrome = spawnChrome(profileDir, chromePath);
  try {
    if (!(await waitForCdp(DEBUG_PORT))) {
      throw new Error("크롬 디버그 포트가 안 열렸어요. 같은 프로필을 쓰는 다른 크롬 창이 있으면 닫고 다시 시도하세요.");
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    try {
      const context = browser.contexts()[0];
      const page = context.pages()[0] ?? (await context.newPage());
      return await fn(page);
    } finally {
      await browser.close().catch(() => undefined); // connectOverCDP는 close=연결 해제(크롬 안 죽임)
    }
  } finally {
    chrome.kill("SIGTERM");
  }
}

// 로그인: 인박스 API가 인증된 응답을 줄 때까지(=실제 로그인) 폴링한다.
export async function loginInstagram(profileDir: string): Promise<void> {
  await withInstagramPage(profileDir, async (page) => {
    console.log("\n인스타그램 창이 떴어요 — 직접 로그인하세요(2FA 있으면 그것도).");
    console.log("로그인되면 자동 감지합니다. Enter 필요 없어요(최대 5분).\n");
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      if ((await callInbox(page))?.inbox) {
        console.log("✅ 로그인 감지됨 — 세션을 프로필에 저장하는 중...");
        await delay(3000);
        console.log(`세션 저장됨: ${profileDir}`);
        return;
      }
      await delay(2000);
    }
    throw new Error("시간 안에 로그인을 감지하지 못했습니다. 다시 시도하세요.");
  });
}

// 인박스 읽기: 저장된 세션으로 페이지를 열고 API 호출 → ChatRawConversation[] 정규화.
export async function fetchInstagram(profileDir: string): Promise<ChatRawConversation[]> {
  return withInstagramPage(profileDir, async (page) => {
    await delay(2500); // 페이지/세션 로드 대기
    const inbox = await callInbox(page);
    if (!inbox?.inbox) {
      throw new Error("인스타 세션이 만료됐거나 로그인 안 됨. 'add instagram <라벨>'로 다시 로그인하세요.");
    }

    const viewerPk = String(inbox.viewer?.pk ?? "");
    const conversations: ChatRawConversation[] = [];

    for (const thread of inbox.inbox.threads ?? []) {
      const messages: ChatRawMessage[] = [];
      for (const item of thread.items ?? []) {
        if (item.item_type !== "text" || !item.text) {
          continue; // 텍스트 메시지만(미디어/공유 등은 건너뜀)
        }
        const tsMicro = Number(item.timestamp ?? 0);
        messages.push({
          id: String(item.item_id ?? `${thread.thread_id}-${tsMicro}`),
          text: item.text,
          sentAt: new Date(Math.round(tsMicro / 1000)).toISOString(), // IG는 마이크로초
          direction: String(item.user_id ?? "") === viewerPk ? "outbound" : "inbound"
        });
      }
      if (!messages.length) {
        continue;
      }
      messages.reverse(); // 최신순 → 오래된 순

      const other = (thread.users ?? [])[0];
      const threadId = String(thread.thread_id ?? other?.pk ?? "");
      conversations.push({
        threadId,
        contact: { id: threadId, name: thread.thread_title ?? other?.full_name ?? other?.username ?? "instagram" },
        messages
      });
    }

    return conversations;
  });
}
