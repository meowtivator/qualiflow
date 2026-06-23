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

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 계정별 프로필 경로(에이전트가 QUALIFLOW_ALIBABA_PROFILE로 계정별로 지정). 없으면 기본(하위호환).
const PROFILE_DIR = process.env.QUALIFLOW_ALIBABA_PROFILE || resolve("../../.auth/alibaba-chrome-profile");
const CONNECTION_STATUS_FILE = resolve("../../apps/web/.data/alibaba-connection.json");
// 로그인 페이지가 아니라 onetalk을 직접 연다. 로그인 안 됐으면 알리바바가 로그인으로 보냈다가
// 로그인 성공 시 다시 onetalk으로 돌려보낸다(= 로그인 시작점이 onetalk이라 복귀 대상이 생긴다).
const ONETALK_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";
const DEBUG_PORT = 9222;
const LOGIN_TIMEOUT_MS = Number(process.env.QUALIFLOW_LOGIN_TIMEOUT_MS) || 5 * 60 * 1000;

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

type ChromeTarget = { title?: string; type?: string; url?: string };

// 크롬 디버그 포트에서 현재 열린 탭(target) 목록을 읽는다.
async function readChromeTargets(): Promise<ChromeTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? (payload as ChromeTarget[]) : [];
  } catch {
    return []; // 포트가 아직 안 열렸거나 크롬이 닫힘
  }
}

// "로그인 성공 후 onetalk 화면"인지 판별: 페이지 url이 onetalk이고, 로그인/패스포트 페이지가 아님.
function isOnetalkReady(target: ChromeTarget): boolean {
  const url = target.url ?? "";
  return (
    target.type === "page" &&
    url.includes("onetalk.alibaba.com") &&
    !/login|signin|passport/i.test(url)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForOnetalk(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await readChromeTargets()).some(isOnetalkReady)) {
      return true;
    }
    await delay(1500);
  }
  return false;
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

const chromePath = await findChrome();
if (!chromePath) {
  console.error("Chrome 실행파일을 못 찾았어요. CHROME_PATH 환경변수로 경로를 지정하세요.");
  process.exit(1);
}

await mkdir(PROFILE_DIR, { recursive: true });

// 자동화 플래그 없이(--enable-automation 안 줌) "그냥 크롬"을 띄운다. --remote-debugging-port는
// 포트만 여는 거라 navigator.webdriver를 true로 만들지 않는다(= CAPTCHA가 정상 동작).
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

console.log("\n순수 크롬 창이 떴어요 — 자동화 흔적이 없어서 슬라이더 CAPTCHA가 정상 동작합니다.");
console.log("⚠️ '대화가 있는 셀러 계정'으로 직접 로그인하세요(슬라이더도 직접 밀기).");
console.log("로그인하면 onetalk 대화 화면이 뜨는지 보세요. 자동 이동이 안 되면 주소창에");
console.log("onetalk.alibaba.com 을 직접 입력해도 됩니다 — 대화 화면이 뜨면 자동으로 감지합니다.");
console.log("(Enter 누를 필요 없어요. 최대 5분 대기.)\n");

const connected = await waitForOnetalk(LOGIN_TIMEOUT_MS);

if (connected) {
  // ★감지 직후 바로 닫으면 OneTalk 세션 쿠키/토큰이 프로필에 다 안 굳어, 추출 때 '로그인 페이지'로
  //   튄다(세션 만료처럼 보임). 몇 초 기다려 세션을 안정화한 뒤, SIGTERM 후에도 디스크 flush 시간을 준다.
  console.log("\n✅ 로그인 감지됨 — 세션을 프로필에 저장하는 중(약 10초, 닫지 마세요)...");
  await new Promise((settle) => setTimeout(settle, 8000));
  await writeConnectionStatus("active", "Alibaba login helper detected the OneTalk inbox. Extractor will validate during sync.");
  chrome.kill("SIGTERM");
  await new Promise((flush) => setTimeout(flush, 2000));
  console.log(`세션이 영구 프로필에 저장됐습니다: ${PROFILE_DIR}`);
  console.log(`연결 상태도 기록했습니다: ${CONNECTION_STATUS_FILE}`);
  console.log("이제 추출: pnpm --filter @qualiflow/agent exec tsx src/cli.ts fetch alibaba <라벨>");
  process.exit(0);
}

await writeConnectionStatus("needs_relogin", "OneTalk inbox was not detected before the login helper timed out.");
console.error("\n⚠️ 시간 안에 onetalk 대화 화면을 감지하지 못했습니다. 다시 시도해 주세요.");
chrome.kill("SIGTERM");
process.exit(1);
