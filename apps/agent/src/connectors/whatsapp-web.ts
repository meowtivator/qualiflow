// WhatsApp Web 이름 리더 — Baileys(프로토콜 직결) 커넥터의 보조.
//
// 왜: Baileys 히스토리는 @lid(프라이버시 식별자) 스레드에 사람 이름을 거의 안 준다(실측 36/38이
//   이름 없음 → 번호로 폴백). 반면 web.whatsapp.com 화면에는 상대가 설정한 표시 이름이 보인다.
//   그 화면 이름을 긁어와 Baileys 대화에 덮어쓰면 "진짜 이름"을 채울 수 있다.
//
// 어떻게: instagram.ts 와 같은 "자동화 플래그 없는 순수 Chrome + CDP" 스캐폴딩을 그대로 재사용한다
//   (chrome-cdp.ts → @qualiflow/adapter-alibaba/runtime). 단 instagram 은 내부 API를 page.evaluate
//   로 부르지만, 여기선 WhatsApp Web 의 화면(DOM/내부 Store)을 읽는다.
//
// ★보안 경계(AGENTS.md 3항): 세션 프로필(--user-data-dir)은 .auth 안에만 두고 서버로 보내지 않는다.
//   첫 페어링은 QR을 사람이 봐야 하므로 반드시 가시(non-headless) 모드.
//
// ★매핑 키 = 전화번호: WhatsApp Web DOM 은 @lid 를 노출하지 않고 전화번호/표시이름만 보인다. Baileys 가
//   .auth/<세션>/lid-mapping-<lid>_reverse.json 에 lid→전화번호를 로컬 저장하므로(실측 36/36 해소),
//   "WhatsApp Web 이름 ↔ 전화번호 ↔ (lid-mapping) ↔ Baileys @lid" 로 이어붙인다.

import { chromium, type Browser, type Page } from "playwright-core";

import { delay, findChrome, spawnChrome, waitForCdp } from "@qualiflow/adapter-alibaba/runtime";

// instagram(9223)/alibaba(9223)와 겹치지 않는 별도 CDP 포트 — 동시에 떠도 충돌 안 나게.
const DEBUG_PORT = Number(process.env.QUALIFLOW_WA_WEB_PORT) || 9224;
const WA_WEB_URL = "https://web.whatsapp.com/";
// 로그인(채팅 목록) 또는 QR 가 나타날 때까지 기다리는 상한(첫 페어링은 사람이 스캔할 시간 필요).
const READY_TIMEOUT_MS = Number(process.env.QUALIFLOW_WA_WEB_READY_MS) || 3 * 60_000;

export type WhatsAppWebReadyState = "ready" | "qr" | "timeout";

/** 스크랩한 표시 이름 한 건. phone 은 매핑 키(숫자만), name 은 화면에 보이는 이름. */
export type WhatsAppWebContact = {
  /** 매핑 키. 숫자만(국가코드 포함, 예: "821058745767"). 못 구하면 빈 문자열. */
  phone: string;
  /** WhatsApp Web 화면의 표시 이름. */
  name: string;
};

// 순수 크롬을 영구 프로필로 띄우고 web.whatsapp.com 페이지를 콜백에 넘긴다. 콜백이 끝나면 정리.
//   offscreen=false(기본): 창을 띄운다(QR 스캔/디버그). offscreen=true: 헤드리스(이미 페어링된 뒤 스크랩용).
async function withWhatsAppWebPage<T>(
  profileDir: string,
  options: { offscreen?: boolean },
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error("Chrome 실행파일을 찾지 못했습니다. 데스크톱 Chrome 설치가 필요합니다.");
  }
  const chrome = spawnChrome(chromePath, profileDir, DEBUG_PORT, WA_WEB_URL, {
    offscreen: options.offscreen ?? false
  });
  let browser: Browser | undefined;
  try {
    if (!(await waitForCdp(DEBUG_PORT))) {
      throw new Error(`CDP 포트 ${DEBUG_PORT}가 열리지 않았습니다(Chrome 기동 실패).`);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    // spawnChrome 가 이미 WA_WEB_URL 로 연 페이지를 집는다(없으면 새로 연다).
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    if (!page.url().startsWith(WA_WEB_URL)) {
      await page.goto(WA_WEB_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return await fn(page);
  } finally {
    await browser?.close().catch(() => undefined); // connectOverCDP 의 close = 연결 해제(크롬은 안 죽임)
    chrome.kill();
  }
}

// ★page.evaluate 본문은 instagram.ts 와 같이 '문자열'로 넘긴다 — agent tsconfig 는 Node(DOM lib 없음)라
//   함수로 넘기면 document 가 타입 에러. 문자열은 타입체크 대상이 아니라 브라우저에서 그대로 평가된다.
//   (셀렉터는 WhatsApp Web 버전에 민감 — 라이브 세션에서 한 번 검증·보정 필요.)
const STATE_SCRIPT = `(() => {
  if (document.querySelector("#pane-side")) return "ready";
  if (document.querySelector("canvas[aria-label], [data-ref] canvas, div[data-ref]")) return "qr";
  return "pending";
})()`;

// #pane-side 의 채팅 행에서 표시 이름(span[title])을 모은다.
const ROWS_SCRIPT = `(() => {
  var out = [];
  var lis = document.querySelectorAll("#pane-side [role='listitem']");
  for (var i = 0; i < lis.length; i++) {
    var t = lis[i].querySelector("span[title]");
    var name = t ? (t.getAttribute("title") || "").trim() : "";
    if (name) out.push({ name: name });
  }
  return out;
})()`;

// 가상 스크롤 목록을 한 화면씩 내린다.
const SCROLL_SCRIPT = `(() => { var p = document.querySelector("#pane-side"); if (p) p.scrollBy(0, p.clientHeight); })()`;

// 페이지가 "로그인됨(채팅 목록)" 인지 "QR 대기" 인지 "아직" 인지 판별한다.
async function probeState(page: Page): Promise<WhatsAppWebReadyState | "pending"> {
  const state = (await page.evaluate(STATE_SCRIPT).catch(() => "pending")) as string;
  return state === "ready" || state === "qr" ? state : "pending";
}

/**
 * 첫 페어링용 — 가시 모드로 web.whatsapp.com 을 띄우고, 사용자가 QR 을 스캔해 로그인할 때까지 기다린다.
 * 이미 페어링돼 있으면 바로 "ready". 상한(READY_TIMEOUT_MS) 안에 로그인 안 되면 "timeout"/"qr".
 * 세션은 profileDir(.auth/whatsapp-web[--label]) 에 남아 다음부턴 QR 없이 재사용된다.
 */
export async function pairWhatsAppWeb(profileDir: string): Promise<WhatsAppWebReadyState> {
  return withWhatsAppWebPage(profileDir, { offscreen: false }, async (page) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let lastSeen: WhatsAppWebReadyState | "pending" = "pending";
    while (Date.now() < deadline) {
      const state = await probeState(page);
      if (state === "ready") {
        console.log("✅ WhatsApp Web 로그인 확인 — 세션이 프로필에 저장됨(다음부턴 QR 불필요).");
        return "ready";
      }
      if (state === "qr" && lastSeen !== "qr") {
        console.log("📱 QR 코드가 떴습니다 — 폰에서 [설정 → 연결된 기기 → 기기 연결]로 스캔하세요.");
      }
      lastSeen = state;
      await delay(1500);
    }
    return lastSeen === "qr" ? "qr" : "timeout";
  });
}

/**
 * 이미 페어링된 세션에서 채팅 목록의 표시 이름을 긁는다(첫 페어링이면 빈 배열 + 안내).
 * ★selectors 는 WhatsApp Web 버전에 민감 — 실세션에서 한 번 검증·보정 필요(아래 evaluate 의 셀렉터).
 * ★phone 추출: 채팅 목록 행에는 전화번호가 안 보이는 경우가 많아(저장명/푸시명만 표시), 전화 매핑은
 *   contact-info 패널 진입 또는 내부 Store 접근으로 보강해야 한다 — 라이브 검증 시 확정.
 */
export async function scrapeWhatsAppWebNames(
  profileDir: string,
  options: { offscreen?: boolean } = {}
): Promise<WhatsAppWebContact[]> {
  return withWhatsAppWebPage(profileDir, { offscreen: options.offscreen ?? true }, async (page) => {
    // 채팅 목록이 뜰 때까지 잠깐 대기(이미 페어링됐다는 전제).
    const ready = await waitForReady(page, 30_000);
    if (ready !== "ready") {
      console.log("⚠️ WhatsApp Web 로그인 안 됨 — 먼저 pairWhatsAppWeb 로 QR 스캔이 필요합니다.");
      return [];
    }
    // 긴 목록은 가상 스크롤이라 한 번에 다 안 잡힌다 → 휠로 내리며 누적.
    const seen = new Map<string, string>();
    for (let i = 0; i < 40; i += 1) {
      const rows = ((await page.evaluate(ROWS_SCRIPT).catch(() => [])) as { name: string }[]) ?? [];
      for (const r of rows) {
        if (r?.name) seen.set(r.name, r.name);
      }
      await page.evaluate(SCROLL_SCRIPT).catch(() => undefined);
      await delay(350);
    }
    // phone 매핑은 라이브 검증에서 확정 — 현재는 이름만 수집(phone 빈 값).
    return Array.from(seen.values()).map((name) => ({ phone: "", name }));
  });
}

async function waitForReady(page: Page, timeoutMs: number): Promise<WhatsAppWebReadyState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await probeState(page);
    if (state === "ready") return "ready";
    if (state === "qr") return "qr";
    await delay(800);
  }
  return "timeout";
}
