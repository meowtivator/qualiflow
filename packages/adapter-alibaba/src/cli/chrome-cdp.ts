// 알리바바 OneTalk CLI들(login / extract / send)이 공유하는 "순수 크롬 + CDP" 스캐폴딩.
//
// ⚠️ 왜 순수 크롬인가: Playwright가 launch한 크롬은 자동화 흔적(navigator.webdriver 등)이 있어
//    OneTalk/슬라이더 CAPTCHA가 탐지해 깨진다. 그래서 자동화 플래그 없는 "그냥 크롬"을 child_process로
//    띄우고(원격디버깅 포트만 열고) 거기에 CDP로 붙는다. (세 CLI가 같은 방식을 쓰므로 여기로 모았다.)

import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Windows: Chrome 우선, 없으면 Edge(Chromium 기반 → CDP 동일 동작)로 폴백.
  // C: 하드코딩 대신 환경변수 조합(undefined는 아래 filter(Boolean)이 제거).
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
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

// Node 내장 프라미스 타이머를 그대로 재export(기존 delay(ms) 호출부 호환).
export { delay };

// OS가 배정하는 빈 TCP 포트를 하나 얻는다(127.0.0.1). 고정 포트(9222 등)를 쓰면 백그라운드
// 동기화(watch)가 이미 그 포트로 크롬을 띄워 둔 순간 로그인 창이 포트를 못 잡아 조용히 실패한다.
// 그래서 로그인/추출을 띄울 때마다 빈 포트를 새로 받아 겹치지 않게 한다.
export function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolvePort(port) : reject(new Error("빈 포트를 찾지 못했습니다."))));
    });
  });
}

// 에이전트 데이터 폴더(.data) 안의 파일 경로를 만든다.
//   - 설치본: QUALIFLOW_HOME/.data  (런처 run.sh/run.cmd가 QUALIFLOW_HOME을 세팅함)
//   - 개발(레포에서 pnpm 실행): cwd가 패키지 폴더라 ../../apps/web/.data 로 떨어진다(기존 동작 유지)
// ★resolve("../../apps/web/.data/...")를 직접 쓰면 설치본은 cwd가 제멋대로라 엉뚱한 곳에 파일을 쓴다.
//   그 cwd-상대 버그를 막으려고 경로 계산을 이 헬퍼 하나로 모은다.
export function dataFile(name: string): string {
  const home = process.env.QUALIFLOW_HOME;
  const dir = home ? resolve(home, ".data") : resolve("../../apps/web/.data");
  return resolve(dir, name);
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
