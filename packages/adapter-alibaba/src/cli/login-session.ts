#!/usr/bin/env node

// 알리바바 로그인 — "순수 크롬"을 직접 띄워 사람이 로그인한다.
//
// ⚠️ 왜 Playwright(chromium.launch)로 안 띄우나:
//    Playwright가 띄운 크롬은 navigator.webdriver 등 자동화 흔적이 있어서, 알리바바 슬라이더
//    CAPTCHA가 그걸 탐지해 슬라이더를 보여주지도 않고 에러("Click to retry")를 낸다.
//    그래서 자동화 플래그가 전혀 없는 "그냥 크롬"을 child_process로 띄우고(원격디버깅 포트만 열고),
//    사람이 직접 로그인한다. 로그인 세션은 "영구 프로필"(.auth/alibaba-chrome-profile)에 남고,
//    추출기(inquiry:extract)가 같은 프로필을 재사용한다(= 읽기는 자동, 로그인은 사람).
//
// ✅ 개선: 처음부터 onetalk을 열고(로그인 안 됐으면 알리바바가 로그인으로 보냈다가 로그인 후 onetalk으로
//    돌려보냄), 터미널 Enter 대신 CDP(/json/list)로 "onetalk 대화 화면이 떴는지"를 자동 감지한다.
//    → Enter를 누를 필요가 없고, 자동 리다이렉트가 안 돼 사용자가 주소창에 직접 onetalk을 입력해도 감지된다.
//
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:login
//   (다른 OS면 CHROME_PATH 환경변수로 크롬 실행파일 경로 지정)
//   (대기 시간 조정: QUALIFLOW_LOGIN_TIMEOUT_MS, 기본 5분)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright-core";

import { delay, findChrome, spawnChrome, waitForCdp } from "./chrome-cdp";

const CONNECTION_STATUS_FILE = resolve("../../apps/web/.data/alibaba-connection.json");
// 로그인 페이지가 아니라 onetalk을 직접 연다. 로그인 안 됐으면 알리바바가 로그인으로 보냈다가
// 로그인 성공 시 다시 onetalk으로 돌려보낸다(= 로그인 시작점이 onetalk이라 복귀 대상이 생긴다).
const ONETALK_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";
const DEBUG_PORT = 9222;
const LOGIN_TIMEOUT_MS = Number(process.env.QUALIFLOW_LOGIN_TIMEOUT_MS) || 5 * 60 * 1000;

// ★로그인 감지: URL만 보면 onetalk을 '여는 순간'의 주소를 로그인됨으로 오인한다(리다이렉트 전 레이스).
//   그래서 실제로 인박스(대화 목록 .contact-item-container)가 떴는지 CDP로 확인한다.
//   빈 계정 대비: onetalk(로그인 페이지 아님) 상태가 ~12초 안정 유지되면 로그인으로 인정.
async function waitForLogin(timeoutMs: number): Promise<boolean> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  try {
    const context = browser.contexts()[0];
    const startedAt = Date.now();
    let stableOnetalk = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const page =
        context.pages().find((candidate) => candidate.url().includes("onetalk.alibaba.com")) ?? context.pages()[0];
      const url = page?.url() ?? "";
      const onLoginPage = /login|signin|passport/i.test(url);
      const onOnetalk = url.includes("onetalk.alibaba.com") && !onLoginPage;

      if (onOnetalk && page) {
        const rows = await page.locator(".contact-item-container").count().catch(() => 0);
        if (rows > 0) {
          return true; // 인박스가 실제로 떴음 = 확실히 로그인됨
        }
        stableOnetalk += 1;
        if (stableOnetalk >= 8) {
          return true; // 대화 0개여도 onetalk 안정 유지 = 로그인됨(빈 계정)
        }
      } else {
        stableOnetalk = 0; // 로그인 페이지면 스트릭 리셋
      }
      await delay(1500);
    }
    return false;
  } finally {
    await browser.close().catch(() => undefined); // connectOverCDP는 close=연결 해제(크롬 안 죽임)
  }
}

// ★로그인된 크롬에서 살아있는 쿠키 전부를 CDP로 읽어 파일에 저장한다(세션 쿠키 포함 — 이게 핵심).
//   크롬 프로필만 믿으면 SIGTERM 시 세션 쿠키가 디스크에 안 굳어 사라지므로, 명시적으로 백업한다.
async function saveSessionCookies(file: string): Promise<number> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  try {
    const context = browser.contexts()[0];
    const cookies = await context.cookies(); // 인자 없으면 컨텍스트의 모든 도메인 쿠키(httpOnly 포함)
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(cookies, null, 2)}\n`, "utf8");
    return cookies.length;
  } finally {
    await browser.close().catch(() => undefined); // 연결만 해제(크롬 안 죽임)
  }
}

async function writeConnectionStatus(status: "active" | "needs_relogin", detail: string): Promise<void> {
  const checkedAt = new Date().toISOString();
  await mkdir(dirname(CONNECTION_STATUS_FILE), { recursive: true });
  await writeFile(
    CONNECTION_STATUS_FILE,
    `${JSON.stringify(
      {
        accountKind: "user_account",
        accountLabel: "Alibaba local session",
        authMode: "browser_session",
        capabilities: ["read_messages", "sync_history"],
        channel: "alibaba",
        checkedAt,
        detail,
        id: "alibaba:local-session",
        lastSyncedAt: status === "active" ? checkedAt : undefined,
        ownerLabel: "Local runtime",
        status
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

// 로그인 도우미: 크롬을 띄워 사람이 로그인하면 감지 + 세션 쿠키 백업. 에이전트가 함수로 직접 부른다.
export async function loginAlibaba(profileDir: string): Promise<void> {
  const cookiesFile = `${profileDir}.cookies.json`; // 세션 쿠키 백업(★서버로 안 감, 프로필 옆 로컬)
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error("Chrome 실행파일을 못 찾았어요. CHROME_PATH 환경변수로 경로를 지정하세요.");
  }

  await mkdir(profileDir, { recursive: true });

  // 자동화 플래그 없이 "그냥 크롬"을 띄운다(상세 이유는 chrome-cdp.ts 주석 참고). 로그인은 사람이 봐야 함.
  const chrome = spawnChrome(chromePath, profileDir, DEBUG_PORT, ONETALK_URL);

  console.log("\n순수 크롬 창이 떴어요 — 자동화 흔적이 없어서 슬라이더 CAPTCHA가 정상 동작합니다.");
  console.log("⚠️ '대화가 있는 셀러 계정'으로 직접 로그인하세요(슬라이더도 직접 밀기).");
  console.log("로그인하면 onetalk 대화 화면이 뜨는지 보세요. 자동 이동이 안 되면 주소창에");
  console.log("onetalk.alibaba.com 을 직접 입력해도 됩니다 — 대화 화면이 뜨면 자동으로 감지합니다.");
  console.log("(Enter 누를 필요 없어요. 인박스 대화가 뜨면 자동 감지. 최대 5분 대기.)\n");

  if (!(await waitForCdp(DEBUG_PORT))) {
    chrome.kill("SIGTERM");
    throw new Error("크롬 디버그 포트가 안 열렸어요. 같은 프로필을 쓰는 다른 크롬 창이 있으면 닫고 다시 시도하세요.");
  }

  if (await waitForLogin(LOGIN_TIMEOUT_MS)) {
    // ★감지 직후 바로 닫으면 세션 쿠키/토큰이 프로필에 다 안 굳어 추출 때 '로그인 페이지'로 튄다.
    //   몇 초 안정화 + SIGTERM 후 디스크 flush 시간을 준다.
    console.log("\n✅ 로그인 감지됨 — 세션을 프로필에 저장하는 중(약 10초, 닫지 마세요)...");
    await delay(8000);
    try {
      const cookieCount = await saveSessionCookies(cookiesFile);
      console.log(`세션 쿠키 ${cookieCount}개를 백업했습니다(추출 때 재주입).`);
    } catch (error) {
      console.error(`쿠키 백업 실패(프로필 쿠키로 폴백): ${error instanceof Error ? error.message : String(error)}`);
    }
    await writeConnectionStatus("active", "Alibaba login helper detected the OneTalk inbox. Extractor will validate during sync.");
    chrome.kill("SIGTERM");
    await delay(2000);
    console.log(`세션이 영구 프로필에 저장됐습니다: ${profileDir}`);
    console.log(`연결 상태도 기록했습니다: ${CONNECTION_STATUS_FILE}`);
    return;
  }

  await writeConnectionStatus("needs_relogin", "OneTalk inbox was not detected before the login helper timed out.");
  chrome.kill("SIGTERM");
  throw new Error("시간 안에 onetalk 대화 화면을 감지하지 못했습니다. 다시 시도해 주세요.");
}

// CLI 래퍼(standalone inquiry:login 용).
async function main() {
  const profileDir = process.env.QUALIFLOW_ALIBABA_PROFILE || resolve("../../.auth/alibaba-chrome-profile");
  try {
    await loginAlibaba(profileDir);
    console.log("이제 추출: pnpm --filter @qualiflow/agent exec tsx src/cli.ts fetch alibaba <라벨>");
  } catch (error) {
    console.error(`\n⚠️ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// 이 파일을 직접 실행할 때만 CLI 동작(import/번들 시엔 안 돈다 — 파일명으로 판별해 번들에서도 안전).
const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("login-session.ts") || entryFile.endsWith("login-session.js")) {
  await main();
}
