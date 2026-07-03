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

import { delay, findChrome, findFreePort, spawnChrome, waitForCdp } from "@qualiflow/adapter-alibaba/runtime";

// ★빈 포트를 새로 받아 쓴다(고정 X) — instagram/alibaba 도 findFreePort 라, 동시에 떠도 충돌 안 나게.
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
  const port = await findFreePort();
  const chrome = spawnChrome(chromePath, profileDir, port, WA_WEB_URL, {
    offscreen: options.offscreen ?? false
  });
  let browser: Browser | undefined;
  try {
    if (!(await waitForCdp(port))) {
      throw new Error(`CDP 포트 ${port}가 열리지 않았습니다(Chrome 기동 실패).`);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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

// #pane-side 의 채팅 행에서 표시 이름(span[title])을 모은다. phone 은 여기서 안 나온다(이름 전용 폴백).
const ROWS_SCRIPT = `(() => {
  var out = [];
  var lis = document.querySelectorAll("#pane-side [role='listitem']");
  for (var i = 0; i < lis.length; i++) {
    var t = lis[i].querySelector("span[title]");
    var name = t ? (t.getAttribute("title") || "").trim() : "";
    if (name) out.push({ phone: "", name: name });
  }
  return out;
})()`;

// ★핵심 조인 키 = 전화번호. DOM 채팅 행엔 번호가 없어 이름만 얻는다(폴백). 진짜 조인은 WhatsApp Web 의
//   내부 Chat Store 에서 각 대화의 id.user(=국가코드 포함 전화 숫자)와 표시이름을 함께 읽어야 가능하다.
//   Store 는 window 에 노출 안 되므로 instagram.ts 처럼 웹팩 모듈 로더(webpackChunk)로 Chat 컬렉션을 꺼낸다.
//   ★버전 민감: WhatsApp Web 이 웹팩 청크 이름/모듈 모양을 바꾸면 빈 배열이 나올 수 있다 → 그때 DOM 폴백으로 떨어진다.
//   ★프라이버시: 로그인한 사용자가 이미 보는 대화 목록의 이름/번호만 읽는다(새 정보 캐내지 않음 — AGENTS.md 경계 유지).
const STORE_SCRIPT = `(() => {
  try {
    var chunk = window.webpackChunkwhatsapp_web_client;
    if (!chunk) return { ok: false, contacts: [] };
    var mods = {};
    var id = "qf_" + Date.now();
    chunk.push([[id], {}, function (req) {
      for (var k in req.m) { try { mods[k] = req(k); } catch (e) {} }
    }]);
    // Chat 컬렉션(_models 배열)을 든 모듈을 찾는다.
    var chats = null;
    for (var k in mods) {
      var m = mods[k];
      var d = m && (m.default || m);
      if (d && d.Chat && d.Chat._models) { chats = d.Chat._models; break; }
      if (d && d._models && d._models[0] && d._models[0].id && "isGroup" in d) { chats = d._models; break; }
    }
    if (!chats) return { ok: false, contacts: [] };
    var out = [];
    for (var i = 0; i < chats.length; i++) {
      var c = chats[i];
      if (!c || (c.isGroup === true)) continue;
      var wid = c.id || {};
      var phone = (wid.user || "").replace(/[^0-9]/g, ""); // 전화 숫자(국가코드 포함). @lid 대화는 여기서 빈 값일 수 있음.
      var name = (c.formattedTitle || c.name || (c.contact && (c.contact.name || c.contact.pushname)) || "").trim();
      if (phone && name) out.push({ phone: phone, name: name });
    }
    return { ok: true, contacts: out };
  } catch (e) {
    return { ok: false, contacts: [] };
  }
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
 * 이미 페어링된 세션에서 각 대화의 (전화번호, 표시이름)을 긁는다(첫 페어링이면 빈 배열 + 안내).
 * 1순위 = 내부 Chat Store(전화번호+이름 함께 나옴 → Baileys @lid 조인 가능). 2순위 = DOM 채팅 행(이름만).
 * ★버전 민감: Store 접근이 실패하면 자동으로 DOM 폴백으로 떨어진다(그땐 phone 이 비어 조인 불가, 이름만).
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
    // 1순위: 내부 Store 에서 전화번호+이름을 한 번에(스크롤 불필요 — 컬렉션 전체가 로드돼 있음).
    const store = (await page
      .evaluate(STORE_SCRIPT)
      .catch(() => ({ ok: false, contacts: [] }))) as { ok: boolean; contacts: WhatsAppWebContact[] };
    if (store.ok && store.contacts.length) {
      // phone 기준 중복 제거(같은 대화가 두 번 잡히면 뒤엣것이 이김 — 무해).
      const byPhone = new Map<string, WhatsAppWebContact>();
      for (const c of store.contacts) {
        if (c.phone && c.name) byPhone.set(c.phone, c);
      }
      console.log(`📇 Store 에서 (번호+이름) ${byPhone.size}건 수집.`);
      return Array.from(byPhone.values());
    }
    // 2순위(폴백): DOM 채팅 행에서 이름만. 긴 목록은 가상 스크롤 → 휠로 내리며 누적.
    console.log("ℹ️ 내부 Store 접근 실패 — DOM 이름 폴백(전화번호 없음 = @lid 조인 불가, 이름만).");
    const seen = new Map<string, string>();
    for (let i = 0; i < 40; i += 1) {
      const rows = ((await page.evaluate(ROWS_SCRIPT).catch(() => [])) as { name: string }[]) ?? [];
      for (const r of rows) {
        if (r?.name) seen.set(r.name, r.name);
      }
      await page.evaluate(SCROLL_SCRIPT).catch(() => undefined);
      await delay(350);
    }
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
