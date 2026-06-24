// 알리바바 OneTalk CLI들(login / extract / send)이 공유하는 "순수 크롬 + CDP" 스캐폴딩.
//
// ⚠️ 왜 순수 크롬인가: Playwright가 launch한 크롬은 자동화 흔적(navigator.webdriver 등)이 있어
//    OneTalk/슬라이더 CAPTCHA가 탐지해 깨진다. 그래서 자동화 플래그 없는 "그냥 크롬"을 child_process로
//    띄우고(원격디버깅 포트만 열고) 거기에 CDP로 붙는다. (세 CLI가 같은 방식을 쓰므로 여기로 모았다.)

import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter((value): value is string => Boolean(value));

// 크롬 실행파일을 후보들에서 찾는다(없으면 null → 호출부에서 CHROME_PATH 안내).
export async function findChrome(): Promise<string | null> {
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

// 크롬 디버그 포트(CDP)가 열릴 때까지 대기.
export async function waitForCdp(port: number, timeoutMs = 20_000): Promise<boolean> {
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

// 'Headless' 표시를 뗀 일반 Chrome UA(탐지 완화). 버전이 안 맞으면 QUALIFLOW_CHROME_UA로 덮어쓴다.
const CHROME_UA =
  process.env.QUALIFLOW_CHROME_UA ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// 자동화 플래그 없는 "그냥 크롬"을 영구 프로필 + 원격디버깅 포트로 띄운다(--remote-debugging-port는
// 포트만 여는 거라 navigator.webdriver를 true로 만들지 않는다 = CAPTCHA가 정상 동작).
//   offscreen=true: 창을 띄우지 않는다(fetch/send용 — 사용자에게 안 보임). 로그인은 사용자가 직접
//   해야 하므로 offscreen을 주지 않는다. QUALIFLOW_SHOW_BROWSER=1 이면 디버깅용으로 창을 띄운다.
export function spawnChrome(
  chromePath: string,
  profileDir: string,
  port: number,
  url: string,
  options: { offscreen?: boolean } = {}
): ChildProcess {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];
  if (options.offscreen && process.env.QUALIFLOW_SHOW_BROWSER !== "1") {
    // ★macOS는 --window-position으로 창을 못 숨긴다(화면 안으로 되돌림). headless=new면 창이 아예 없고,
    //   페이지는 그대로 렌더돼 React 상태/페이지 평가가 동작한다. UA는 'Headless' 표시를 떼 탐지를 줄인다.
    args.push("--headless=new", `--user-agent=${CHROME_UA}`);
  }
  args.push(url);
  return spawn(chromePath, args, { stdio: "ignore" });
}
