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
    var res = await fetch("/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=50&persistentBadging=true&limit=50", {
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

// 텍스트가 맞는 첫 클릭가능 요소(버튼/링크/role=button)를 누른다.
async function clickByText(page: Page, texts: string[]): Promise<boolean> {
  for (const label of texts) {
    const target = page
      .locator(`button:has-text("${label}"), a:has-text("${label}"), [role="button"]:has-text("${label}")`)
      .first();
    if (await target.isVisible().catch(() => false)) {
      await target.click().catch(() => undefined);
      return true;
    }
  }
  return false;
}

// IG 로그인 인터스티셜을 순서대로 넘긴다(세션이 기억된 경우):
//   /accounts/login  → "계속(Continue as …)"  (원탭 재인증)
//   /accounts/onetap → "나중에 하기(Not now)"  ("로그인 정보 저장?" 모달)
// 인박스로 들어가면 종료. 완전 로그아웃(2FA/비번 필요)이면 그대로 두고 이후 단계서 처리.
async function tryOneTapContinue(page: Page): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    await delay(2500);
    const url = page.url();
    if (/\/accounts\/login/.test(url)) {
      if (!(await clickByText(page, ["계속", "Continue"]))) {
        return; // 버튼 없음 = 완전 로그아웃 → 재로그인 필요
      }
      console.log("인스타 '계속' 재인증 — 클릭");
    } else if (/\/accounts\/onetap/.test(url)) {
      await clickByText(page, ["나중에 하기", "Not now", "Not Now"]);
      console.log("인스타 '로그인 정보 저장?' 모달 — 나중에 하기");
    } else {
      return; // 인증 인터스티셜을 벗어남(인박스 도달)
    }
  }
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
      await tryOneTapContinue(page); // "계속" 재인증 화면이면 눌러 세션 복구
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
    const threads = inbox.inbox.threads ?? [];
    console.log(`📥 인스타 인박스: 스레드 ${threads.length}개 발견 (내 pk=${viewerPk || "?"})`);
    const conversations: ChatRawConversation[] = [];

    for (const thread of threads) {
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

// 메시지 발송 — mautrix와 같은 내부 웹 API(broadcast)를 로그인된 페이지에서 POST한다.
//   threadId = 불러온 대화의 threadId(=IG thread_id). client_context = 멱등키(중복 전송 방지).
export async function sendInstagram(profileDir: string, threadId: string, text: string): Promise<void> {
  const script = `(async () => {
    try {
      var csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      // IG 웹은 idempotency용으로 숫자 컨텍스트를 쓴다(언더스코어 없는 큰 숫자).
      var ctx = String(Date.now()) + String(Math.floor(Math.random() * 1000000));
      var body = new URLSearchParams();
      body.set("action", "send_item");
      body.set("send_attribution", "direct_thread");
      body.set("thread_ids", "[" + ${JSON.stringify(threadId)} + "]");
      body.set("text", ${JSON.stringify(text)});
      body.set("offline_threading_id", ctx);
      body.set("client_context", ctx);
      body.set("mutation_token", ctx);
      body.set("_csrftoken", csrf);
      var res = await fetch("/api/v1/direct_v2/threads/broadcast/text/", {
        method: "POST",
        headers: {
          "X-IG-App-ID": "${IG_APP_ID}",
          "X-CSRFToken": csrf,
          "X-ASBD-ID": "129477",
          "X-IG-WWW-Claim": "0",
          "X-Requested-With": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded"
        },
        credentials: "include",
        body: body.toString()
      });
      var bodyText = await res.text();
      var json = null;
      try { json = JSON.parse(bodyText); } catch (e2) {}
      // ★200(res.ok)만으로 성공으로 보면 안 된다 — 본문 status가 "ok"여야 실제 전송됨.
      if (res.ok && json && json.status === "ok") {
        return "ok:" + ((json.payload && json.payload.item_id) || "sent");
      }
      // 진단: 리다이렉트 여부 + 최종 URL이 핵심(로그인으로 튀었는지 vs 엔드포인트 문제인지).
      var kind = json ? ("json:" + JSON.stringify(json).slice(0, 200)) : ("html:" + bodyText.slice(0, 120));
      return "fail status=" + res.status + " redirected=" + res.redirected + " url=" + res.url + " " + kind;
    } catch (e) { return "error:" + (e && e.message ? e.message : String(e)); }
  })()`;

  await withInstagramPage(profileDir, async (page) => {
    await delay(1500); // 페이지/세션 로드 대기
    // 로그인 페이지에 발송 POST를 쏘지 않는다 — 세션이 살아있는지 인박스 API로 먼저 확인.
    if (!(await callInbox(page))?.inbox) {
      throw new Error(
        "인스타 세션이 만료됐어요('계속' 화면 자동 복구 실패). 'login instagram <라벨>'로 재로그인 후 다시 보내세요."
      );
    }
    const result = (await page.evaluate(script).catch((error) => `evaluate-error:${String(error)}`)) as string;
    if (!result.startsWith("ok")) {
      throw new Error(`Instagram 발송 실패: ${result}`);
    }
    console.log(`📤 Instagram 발송 완료 → thread ${threadId} (${result})`);
  });
}
