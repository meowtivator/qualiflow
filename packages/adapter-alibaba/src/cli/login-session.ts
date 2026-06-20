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
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:login
//   (다른 OS면 CHROME_PATH 환경변수로 크롬 실행파일 경로 지정)

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const PROFILE_DIR = resolve("../../.auth/alibaba-chrome-profile");
const CONNECTION_STATUS_FILE = resolve("../../apps/web/.data/alibaba-connection.json");
const LOGIN_URL = "https://login.alibaba.com/";
const DEBUG_PORT = 9222;

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
    LOGIN_URL
  ],
  { stdio: "ignore" }
);

console.log("\n순수 크롬 창이 떴어요 — 자동화 흔적이 없어서 슬라이더 CAPTCHA가 정상 동작합니다.");
console.log("⚠️ '대화가 있는 셀러 계정'으로 직접 로그인하세요(슬라이더도 직접 밀기).");
console.log("로그인 후 onetalk.alibaba.com 에서 대화 목록이 보이는지 확인하고, 이 터미널로 와서 Enter.\n");

const rl = createInterface({ input, output });
await rl.question("로그인 완료 후 Enter... ");
rl.close();

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
      detail: "Alibaba login helper completed. Extractor will validate the session during sync.",
      id: "alibaba:local-session",
      lastSyncedAt: checkedAt,
      ownerLabel: "Local runtime",
      status: "active"
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`\n세션이 영구 프로필에 저장됐습니다: ${PROFILE_DIR}`);
console.log(`연결 상태도 웹앱 상태 파일에 기록했습니다: ${CONNECTION_STATUS_FILE}`);
console.log("이제 추출: pnpm --filter @qualiflow/adapter-alibaba run inquiry:extract");

// 크롬 종료(영구 프로필이라 로그인 쿠키는 디스크에 남는다). 안 닫히면 창을 직접 닫아도 됨.
chrome.kill("SIGTERM");
