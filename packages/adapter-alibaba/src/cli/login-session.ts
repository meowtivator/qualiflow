#!/usr/bin/env node

// 알리바바에 사람이 한 번 로그인해서 세션(storageState)을 파일로 저장한다.
// 추출기(inquiry:extract)가 이 파일을 재사용한다.
//
// ⚠️ 보안: 저장되는 파일(.auth/alibaba.storage.json)은 사실상 비밀번호급이다.
//    절대 커밋/공유 금지(.auth/ 는 .gitignore 에 들어 있음).
//
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:login
//   → 뜨는 브라우저에서 직접 로그인(CAPTCHA/슬라이더 포함) → 터미널에서 Enter.

import { mkdir } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { chromium } from "playwright-core";

const STORAGE_STATE = resolve("../../.auth/alibaba.storage.json");
// 로그인 페이지로 직접 보낸다(메시지 앱이 아니라). 로그인하면 세션 쿠키가 알리바바 도메인에 박히고,
// inquiry:extract 가 그 쿠키로 OneTalk 에 접근한다.
const LOGIN_URL = "https://login.alibaba.com/";

const browser = await chromium.launch({ headless: false, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

console.log("\n브라우저에서 알리바바에 직접 로그인하세요.");
console.log("⚠️ OneTalk(셀러 메시징)가 있는 '셀러 계정'으로 로그인하세요. 바이어 계정/메시징 없는 계정은 OneTalk가 깨집니다.");
console.log("(CAPTCHA/슬라이더는 사람만 통과 가능 — 자동화하지 않습니다.)");
console.log("로그인 끝나면 이 터미널로 와서 Enter를 누르세요.\n");

const rl = createInterface({ input, output });
await rl.question("로그인 완료 후 Enter... ");
rl.close();

await mkdir(dirname(STORAGE_STATE), { recursive: true });
await context.storageState({ path: STORAGE_STATE });
await browser.close();

console.log(`\n세션 저장됨: ${STORAGE_STATE}`);
console.log("이제 다음으로 실제 메시지를 뽑으세요:");
console.log("  pnpm --filter @qualiflow/adapter-alibaba run inquiry:extract");
