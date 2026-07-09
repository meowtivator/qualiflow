#!/usr/bin/env node

// 알리바바 OneTalk 라이브 추출기 (route B) — "순수 크롬 + 영구 프로필 + CDP".
//
// ⚠️ 왜 순수 크롬인가: Playwright가 launch한 크롬은 자동화 흔적(navigator.webdriver 등)이 있어
//    OneTalk/CAPTCHA가 탐지해 깨진다. 그래서 자동화 플래그 없는 "그냥 크롬"을 띄우고(원격디버깅
//    포트만 열고) 거기 CDP로 "붙어서" 읽는다. 로그인 세션은 inquiry:login 이 만든 영구 프로필
//    (.auth/alibaba-chrome-profile)을 재사용한다(= 읽기는 자동, 로그인은 사람).
//
//   준비: 먼저 pnpm --filter @qualiflow/adapter-alibaba run inquiry:login 으로 로그인.
//   실행: pnpm --filter @qualiflow/adapter-alibaba run inquiry:extract

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium, type BrowserContext, type Page, type Response } from "playwright-core";

import type { AlibabaBuyerActivity, AlibabaRawConversation } from "../raw-types";
import { CHROME_NOT_FOUND_MESSAGE, dataFile, findChrome, spawnChrome, waitForCdp } from "./chrome-cdp";

// ────────────────────────────────────────────────────────────────────────
// 🔎 주문 카운트(#5)·고객 활동(#7) JSONP 캡처(진단/배선 준비 — 매핑은 보류).
//
// 왜 따로 잡나: "고객 활동"·주문 카운트는 메시지 fiber(itemData)가 아니라 별도 원격 모듈
//   (customerBehaviorData)이 JSONP(queryCustomerInfo)로 받아온다. 그래서 메시지 추출(EXTRACT_IN_PAGE)
//   과는 다른 경로 — 네트워크 응답을 가로채야 한다. (record-inquiry.ts 의 page.on("response") 패턴 미러링.)
//
// ★라이브 JSONP 응답의 정확한 '키 이름'과 '엔드포인트 URL'이 아직 미확정이다. 그래서 여기서는
//   추측해서 키를 매핑하지 않는다 — URL이 customerInfo/behavior 류로 보이는 응답의 '원문(raw)'을
//   그대로 캡처해 파일로 덤프만 한다. 사람이 그 덤프를 보고 어느 키가 주문 카운트/활동인지 지목하면,
//   그때 normalize 의 AlibabaBuyerOrderCounts/AlibabaBuyerActivity 로 매핑하는 코드를 붙인다.
//   (지금 단계: 캡처+덤프 = '라이브 키 확정'을 위한 1회성 진단. ALIBABA_PROBE 일 때만 동작.)
//
// URL 매칭은 '넓게' 잡는다(엔드포인트명도 미확정이라): queryCustomerInfo 가 주 후보지만,
//   customerBehavior/customerInfo/behaviorData 류도 함께 잡아 덤프해 비교한다.
const CUSTOMER_INFO_URL_RE = /queryCustomerInfo|customerBehavior|customerInfo|behaviorData/i;

type CapturedJsonpResponse = {
  url: string;
  status: number;
  contentType: string;
  // JSONP는 보통 `callbackName({...})` 꼴이라 순수 JSON이 아니다. 파싱은 시도만 하고,
  //   실패해도 원문(rawBody)을 그대로 남긴다(사람이 키를 찾을 수 있게). 절대 키를 지어내지 않는다.
  parsed?: unknown;
  rawBody: string;
};

// page.on("response") 로 customerInfo/behavior 류 응답을 모은다. 반환된 배열은 페이지 수명 동안 채워진다.
//   ★읽기 전용: 응답 본문만 읽고(가능할 때) 아무것도 바꾸지 않는다. 본문 길이는 상한으로 자른다(폭주 방지).
function captureCustomerInfoResponses(page: Page, maxBodyChars = 20_000): CapturedJsonpResponse[] {
  const captured: CapturedJsonpResponse[] = [];
  page.on("response", (response: Response) => {
    const url = response.url();
    if (!CUSTOMER_INFO_URL_RE.test(url)) return;
    // 본문 읽기는 비동기 — 실패(이미 소비/리다이렉트 등)해도 조용히 건너뛴다.
    void response
      .text()
      .then((rawText) => {
        const body = rawText.slice(0, maxBodyChars);
        const entry: CapturedJsonpResponse = {
          url,
          status: response.status(),
          contentType: response.headers()["content-type"] ?? "",
          rawBody: body
        };
        // JSONP 껍데기(callback(...))를 벗겨 안쪽 JSON만 파싱 시도. 실패하면 parsed는 비워 둔다.
        const inner = body.match(/^[^({]*\(([\s\S]*)\)\s*;?\s*$/);
        const jsonText = inner ? inner[1] : body;
        try {
          entry.parsed = JSON.parse(jsonText);
        } catch {
          // 순수 JSON도 JSONP도 아님 → parsed 생략, rawBody만 남긴다(사람이 직접 키 확인).
        }
        captured.push(entry);
      })
      .catch(() => undefined);
  });
  return captured;
}

// queryCustomerInfo JSONP 한 건에서 buyerInfo와 등급(growthLevel/highQualityLevelTag)을 꺼낸다(없으면 undefined).
// ★companyName/firstName/lastName 도 함께 꺼낸다(프로브 확정, alibaba-customer-info-probe.json):
//   이 응답의 companyName 은 '회사명', firstName+lastName 은 '개인명'으로 분리돼 온다. 메시지 fiber의
//   contact.companyName 은 대부분 개인명과 같은 값이라(중복), 여기 회사명을 '진짜 회사명'의 주 출처로 쓴다.
function readBuyerInfo(
  entry: CapturedJsonpResponse
): { buyerInfo: Record<string, unknown>; grade?: string; companyName?: string; personName?: string } | undefined {
  const root = entry.parsed as { data?: { data?: { buyerInfo?: Record<string, unknown> } } } | undefined;
  const buyerInfo = root?.data?.data?.buyerInfo;
  if (!buyerInfo || typeof buyerInfo !== "object") return undefined;
  const growth = (buyerInfo.growthLevelInfo as { growthLevel?: unknown } | undefined)?.growthLevel;
  const hq = buyerInfo.highQualityLevelTag;
  const grade = typeof growth === "string" ? growth : typeof hq === "string" ? hq : undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const companyName = str(buyerInfo.companyName);
  const first = str(buyerInfo.firstName);
  const last = str(buyerInfo.lastName);
  const personName = [first, last].filter(Boolean).join(" ") || undefined;
  return { buyerInfo, grade, companyName, personName };
}

// 회사명이 '진짜 회사'인지 판정해 정리한다(아니면 undefined = 회사명 없음).
//   ★버리는 값(모두 프로브 실데이터에서 관찰됨): 자리표시자("NA"/"nocompany"/"Nocompanyname"/"no company"/
//     "All companies"/"Pas d'entreprise"[프랑스어 '회사 없음']), 그리고 개인명과 사실상 같은 값.
//   → 개인명과 같으면 회사가 아니라 '회사명을 안 채운 개인'이므로 회사명을 비운다(대시보드 중복 방지).
//   절대 값을 지어내지 않는다 — 판단은 '버릴지 말지'만.
// ★"pas\s*d\W*entreprise": 프랑스어 "회사 없음". 실데이터는 아포스트로피가 HTML 인코딩(d&#39;entreprise)돼
//   올 수 있어 d와 entreprise 사이의 비단어 문자열(\W*)을 관대하게 허용한다(따옴표·공백·&#39; 모두 매치).
const COMPANY_PLACEHOLDER_RE = /^(na|n\/a|none|no\s*company|nocompany|no\s*company\s*name|nocompanyname|all\s*companies|pas\s*d\W*entreprise)$/i;

function cleanCompanyName(company: string | undefined, personName: string | undefined): string | undefined {
  const trimmed = company?.trim();
  if (!trimmed) return undefined;
  if (COMPANY_PLACEHOLDER_RE.test(trimmed)) return undefined; // 자리표시자 → 회사명 없음
  // 개인명과 대소문자·공백 무시하고 같으면 '회사명 미기입' → 비운다(중복 셀 방지).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (personName && norm(trimmed) === norm(personName)) return undefined;
  return trimmed;
}

// buyerInfo → AlibabaBuyerActivity. ★음수(-1=숨김)·null·비수치는 버린다(키를 지어내지 않는다).
//   라이브 키 확정(probe 2026-06, alibaba-customer-info-probe.json): productViewCount/validInquiryCount/
//   validRfqCount/loginDays/spamInquiryMarkedBySupplierCount/addedToBlacklistCount/totalOrderCount.
function buyerInfoToActivity(buyerInfo: Record<string, unknown>): AlibabaBuyerActivity {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const loginRaw = buyerInfo.loginDays;
  return {
    productViews: num(buyerInfo.productViewCount),
    validInquiries: num(buyerInfo.validInquiryCount),
    validRfqs: num(buyerInfo.validRfqCount),
    loginDays: loginRaw == null ? null : num(loginRaw),
    spamInquiries: num(buyerInfo.spamInquiryMarkedBySupplierCount),
    blacklistCount: num(buyerInfo.addedToBlacklistCount),
    totalTrades: num(buyerInfo.totalOrderCount)
  };
}
// ────────────────────────────────────────────────────────────────────────

const ONETALK_URL = "https://onetalk.alibaba.com/message/weblitePWA.htm?hideMenu=1#/";
const DEBUG_PORT = 9222;
// 한 번에 추출할 최대 대화(바이어) 수. 기본 200으로 상향(예전 30은 너무 낮아 바이어가 잘렸다).
// 바이어가 더 많으면 QUALIFLOW_ALIBABA_MAX_CONV로 올린다. ★주의: 대화당 메시지까지 깊게 긁어 수백이면 fetch가 오래 걸림.
const MAX_CONVERSATIONS = Number(process.env.QUALIFLOW_ALIBABA_MAX_CONV) || 200;
const OPEN_TIMEOUT_MS = 10_000; // 한 대화를 열고 그 대화 메시지가 fiber에 뜰 때까지 최대 대기
const POLL_MS = 400; // 폴링 간격
const MAX_SCROLLS = 60; // 한 대화에서 위로 스크롤하며 옛 메시지를 끌어올 최대 횟수(폭주 방지 상한)
// 연락처 목록을 아래로 스크롤하며 더 많은 바이어를 불러올 최대 횟수. 기본 150(바이어 수백 대비 상향).
const MAX_LIST_SCROLLS = Number(process.env.QUALIFLOW_ALIBABA_MAX_LIST_SCROLLS) || 150;
const SCROLL_WAIT_MS = 800; // 한 번 스크롤한 뒤 옛 메시지가 그려지거나(가상 리스트) 불러와질(지연 로딩) 때까지 대기

const INBOX_READY_TIMEOUT_MS = 40_000; // 대화 목록이 뜰 때까지 최대 대기
const INBOX_POLL_MS = 500;
const LOGIN_STREAK_LIMIT = 16; // 로그인/passport 페이지가 16×500ms=8초 연속이면 진짜 만료로 판정

// onetalk 세션 상태를 폴링으로 판정한다.
//   "ready"   = 대화 목록(.contact-item-container)이 떴음 → 세션 유효 + 로딩 완료
//   "login"   = 로그인/passport 페이지에 8초+ 연속 머무름 → 세션 만료
//   "timeout" = 둘 다 아님(로딩이 느리거나 인박스가 비어 있음) → 추출은 그래도 시도
// ⚠️ 예전엔 2.5초 뒤 URL만 한 번 보고 판정했는데, onetalk는 유효 세션이어도 passport(SSO)를
//    잠깐 경유하므로 그 순간을 "만료"로 오판했다. 이제 "행이 뜨는가"를 본다(= login-session과 동일 기준).
async function waitForInbox(page: Page): Promise<"ready" | "login" | "timeout"> {
  const deadline = Date.now() + INBOX_READY_TIMEOUT_MS;
  let loginStreak = 0;
  while (Date.now() < deadline) {
    const rowCount = await page
      .locator(".contact-item-container")
      .count()
      .catch(() => 0);
    if (rowCount > 0) return "ready";
    if (/login|signin|passport/i.test(page.url())) {
      loginStreak += 1;
      if (loginStreak >= LOGIN_STREAK_LIMIT) return "login";
    } else {
      loginStreak = 0;
    }
    await page.waitForTimeout(INBOX_POLL_MS);
  }
  return "timeout";
}

// login이 백업한 세션 쿠키를 컨텍스트에 주입한다(goto 전). 파일 없으면 프로필 쿠키에 의존(폴백).
async function injectSessionCookies(context: BrowserContext, file: string): Promise<number> {
  try {
    const cookies = JSON.parse(await readFile(file, "utf8")) as Parameters<BrowserContext["addCookies"]>[0];
    if (Array.isArray(cookies) && cookies.length) {
      await context.addCookies(cookies);
      return cookies.length;
    }
  } catch {
    // 파일 없거나 깨짐 → 프로필 쿠키로 폴백
  }
  return 0;
}

// 페이지 안에서 실행되는 추출 스크립트: React fiber 트리를 훑어 itemData(메시지)를 모은다.
const EXTRACT_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  // 정찰로 확인: 열린 대화의 메시지는 각 DOM 요소의 fiber에서 위로 몇 단계 안에 itemData(메시지)로 들어있다.
  // (루트에서 아래로 DFS 하던 옛 방식은 메시지 패널이 다른 fiber 루트면 못 찾았다 → 모든 요소에서 위로 훑는다.)
  function collectMessages() {
    const out = [];
    const seen = new Set();
    const nodes = document.querySelectorAll("div, span, p");
    for (const el of nodes) {
      const k = fiberKey(el);
      if (!k) continue;
      let fiber = el[k];
      let hops = 0;
      while (fiber && hops < 8) {
        const p = fiber.memoizedProps;
        const m = p && p.itemData;
        if (m && m.messageId != null && !seen.has(m.messageId)) {
          seen.add(m.messageId);
          out.push(m);
        }
        fiber = fiber.return;
        hops += 1;
      }
    }
    return out;
  }

  const raw = collectMessages();
  if (!raw.length) return null;

  const messages = raw
    .map((m) => ({
      messageId: m.messageId,
      uuid: m.uuid != null ? String(m.uuid) : undefined,
      conversationCode: m.conversationCode,
      content: typeof m.content === "string" ? m.content : "",
      sendTime: typeof m.sendTime === "number" ? m.sendTime : 0,
      sender: { targetId: m.sender && m.sender.targetId ? String(m.sender.targetId) : "" },
      msgType: m.msgType,
      type: m.type,
      subType: m.subType,
      autoReply: m.autoReply,
      spamStatus: m.spamStatus,
      loginId: m.loginId
    }))
    .filter((m) => m.conversationCode)
    .sort((a, b) => a.sendTime - b.sendTime);

  if (!messages.length) return null;

  const withParties = raw.find((m) => m.owner && m.contact) || {};
  const owner = withParties.owner || {};
  const contact = withParties.contact || {};

  return {
    owner: { aliId: owner.aliId ? String(owner.aliId) : "", name: owner.name },
    contact: {
      aliId: contact.aliId ? String(contact.aliId) : undefined,
      loginId: contact.loginId,
      name: contact.name,
      companyName: contact.companyName,
      complianceCountryCode: contact.complianceCountryCode,
      profileImageUrl:
        contact.profileImageUrl ||
        contact.avatarUrl ||
        contact.avatar ||
        contact.headImageUrl ||
        contact.headUrl ||
        contact.logoUrl,
      // 등급 폴백(메시지 fiber의 contact에 있을 때만 — 주 출처는 행 fiber).
      userNewLevel: contact.userNewLevel,
      userNewLevelIcon: contact.userNewLevelIcon,
      memberId: contact.memberId
    },
    messages
  };
}
`;

// 메시지 패널(스크롤 컨테이너)을 한 화면의 80%만큼 위로 올린다(20% 겹쳐서 빠뜨리지 않게).
// 반환: { found(스크롤 컨테이너 찾음), atTop(맨 위 도달) }. 짧은 대화는 컨테이너가 안 넘쳐 found:false.
const SCROLL_UP_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  // 메시지 요소 하나 찾기(itemData.messageId 가진 fiber의 DOM).
  let msgEl = null;
  for (const el of document.querySelectorAll("div, span, p")) {
    const k = fiberKey(el);
    if (!k) continue;
    let fiber = el[k];
    let hops = 0;
    while (fiber && hops < 8) {
      const m = fiber.memoizedProps && fiber.memoizedProps.itemData;
      if (m && m.messageId != null) { msgEl = el; break; }
      fiber = fiber.return;
      hops += 1;
    }
    if (msgEl) break;
  }
  if (!msgEl) return { found: false, atTop: true };
  // 그 요소에서 위로 올라가며 스크롤 가능한 조상(메시지 패널)을 찾는다.
  let c = msgEl;
  while (c && c !== document.body) {
    const s = getComputedStyle(c);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && c.scrollHeight > c.clientHeight + 10) break;
    c = c.parentElement;
  }
  if (!c || c === document.body) return { found: false, atTop: true };
  const before = c.scrollTop;
  c.scrollTop = Math.max(0, before - Math.floor(c.clientHeight * 0.8));
  return { found: true, atTop: c.scrollTop === 0 };
}
`;

// ⚠️ 위 둘은 "() => {...}" 문자열. Playwright는 문자열을 표현식으로만 평가하고 함수를 호출하지
//    않으므로 (…)() 로 감싸 "호출되게" 한다(안 그러면 함수값→undefined→0).
// 연락처(대화) 목록 패널을 '아래로' 한 화면씩 스크롤한다. 가상 리스트라 더 내려야 다음 바이어 행이 그려진다.
// .contact-item-container 의 스크롤 가능한 조상(목록 패널)을 찾아 내리고, 맨 아래 도달 여부를 알린다.
const SCROLL_LIST_DOWN_IN_PAGE = String.raw`
() => {
  const rows = Array.from(document.querySelectorAll(".contact-item-container"));
  if (!rows.length) return { found: false, atBottom: true };
  let c = rows[0];
  while (c && c !== document.body) {
    const s = getComputedStyle(c);
    if ((s.overflowY === "auto" || s.overflowY === "scroll") && c.scrollHeight > c.clientHeight + 10) break;
    c = c.parentElement;
  }
  if (!c || c === document.body) return { found: false, atBottom: true };
  const before = c.scrollTop;
  c.scrollTop = Math.min(c.scrollHeight, before + Math.floor(c.clientHeight * 0.8));
  return { found: true, atBottom: c.scrollTop + c.clientHeight >= c.scrollHeight - 5 };
}
`;

const EXTRACT_CALL = `(${EXTRACT_IN_PAGE})()`;
const SCROLL_CALL = `(${SCROLL_UP_IN_PAGE})()`;
const SCROLL_LIST_DOWN_CALL = `(${SCROLL_LIST_DOWN_IN_PAGE})()`;

// 🔎 등급 프로브(진단 전용): 연락처 목록 첫 N행의 React 내부 데이터(memoizedProps)에서 스칼라 필드를
//    "있는 그대로" 떠낸다. 등급(L1~L4)은 뱃지 이미지가 아니라 이 데이터의 어떤 필드(buyerLevel/level/
//    grade/vipLevel 등)일 확률이 높으므로, 추측 없이 전부 덤프해 사람이 어느 필드가 등급인지 지목하게 한다.
//    해석/매핑은 하지 않는다(읽기 전용). ALIBABA_PROBE 환경변수일 때만 호출된다.
const PROBE_IN_PAGE = String.raw`
() => {
  function fiberKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
  }
  // 객체에서 스칼라(문자열/숫자/불리언) 잎값을 depth 단계까지 모은다(중첩 객체는 한 단계 더 들어간다).
  function scalars(obj, depth) {
    const out = {};
    if (!obj || typeof obj !== "object") return out;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v === null || v === undefined) continue;
      const t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") out[k] = v;
      else if (t === "object" && !Array.isArray(v) && depth > 1) {
        const sub = scalars(v, depth - 1);
        if (Object.keys(sub).length) out[k] = sub;
      }
    }
    return out;
  }
  const KEYS = ["itemData","data","item","contact","record","buyer","conversation","customer","info","detail","rowData","node","value","props"];
  const rows = Array.from(document.querySelectorAll(".contact-item-container")).slice(0, 5);
  const dump = [];
  for (const row of rows) {
    const entry = { dataset: {}, imgs: [], fiber: {} };
    for (const a of Array.from(row.attributes)) {
      if (a.name.indexOf("data-") === 0) entry.dataset[a.name] = a.value;
    }
    // 행 안의 모든 이미지 URL(아바타 + 등급/인증 뱃지). 등급이 React 데이터가 아니라 뱃지 URL에만
    // 인코딩돼 있어도, 5개 행(등급이 다르면)을 비교하면 어떤 URL이 등급인지 드러난다.
    for (const im of Array.from(row.querySelectorAll("img"))) {
      if (im.src) entry.imgs.push(im.src);
    }
    const k = fiberKey(row);
    if (k) {
      let fiber = row[k];
      let hops = 0;
      while (fiber && hops < 12) {
        const p = fiber.memoizedProps;
        if (p && typeof p === "object") {
          for (const key of KEYS) {
            if (p[key] && typeof p[key] === "object" && !entry.fiber[key]) {
              entry.fiber[key] = scalars(p[key], 2);
            }
          }
          if (!entry.fiber.__topProps) {
            const top = scalars(p, 1);
            if (Object.keys(top).length) entry.fiber.__topProps = top;
          }
        }
        fiber = fiber.return;
        hops += 1;
      }
    }
    dump.push(entry);
  }
  return { rowCount: rows.length, rows: dump };
}
`;
const PROBE_CALL = `(${PROBE_IN_PAGE})()`;

// 연락처 행에서 (a)아바타 URL, (b)등급 뱃지 URL, (c)행 fiber의 구매 등급(userNewLevel/Icon/memberId)을
//   읽어 { avatarUrl, gradeBadgeUrl, userNewLevel, userNewLevelIcon, memberId } 로 반환한다.
//   - 아바타: imgextra 규격 뱃지(...tps-WxH.png)를 '제외'한 진짜 사진 URL(없으면 undefined → 이니셜 폴백).
//   - 등급: 행 React fiber의 userNewLevel 값을 직접 읽는다(프로브 확정). 형태검증은 normalize.normalizeAlibabaGrade.
function buildReadRowProfileImageScript(cid: string | null, index: number) {
  const serialized = JSON.stringify({ cid, index });

  return String.raw`
    (() => {
      const args = ${serialized};
      const rows = Array.from(document.querySelectorAll(".contact-item-container"));
      const row = args.cid
        ? rows.find((item) => item.getAttribute("data-cid") === args.cid)
        : rows[args.index];

      if (!row) return undefined;

      function absolutize(value) {
        if (!value || typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return undefined;
        try {
          return new URL(trimmed, location.href).href;
        } catch {
          return undefined;
        }
      }

      function fromBackground(value) {
        const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/);
        return match ? absolutize(match[2]) : undefined;
      }

      const candidates = [];
      for (const image of Array.from(row.querySelectorAll("img"))) {
        candidates.push(image.currentSrc, image.src, image.getAttribute("data-src"), image.getAttribute("data-original"));
      }
      for (const element of Array.from(row.querySelectorAll("*"))) {
        candidates.push(
          element.getAttribute("data-avatar"),
          element.getAttribute("data-avatar-url"),
          element.getAttribute("data-profile-image-url"),
          element.getAttribute("data-src"),
          fromBackground(getComputedStyle(element).backgroundImage)
        );
      }

      // 규격 뱃지(예: imgextra ...tps-136-80.png) = 아바타가 아니라 공용 아이콘. 한 번 훑으며
      // 아바타(첫 번째 비-뱃지 사진)와 등급 뱃지(첫 번째 규격 뱃지)를 따로 모은다.
      const BADGE_RE = /[-_]\d+[-x]\d+\.(png|webp)/i;
      let avatarUrl = undefined;
      let gradeBadgeUrl = undefined;
      for (const candidate of candidates) {
        const url = absolutize(candidate);
        if (!url || !/^https?:\/\//.test(url)) continue;
        if (BADGE_RE.test(url)) {
          // ★등급/인증 뱃지 후보 — 버리지 않고 첫 번째를 잡아둔다(등급 해석은 normalize에서).
          // LIVE-VERIFY: 한 행에 뱃지가 여러 개일 수 있다(등급 뱃지 + 인증 뱃지 등). 라이브에서
          //   "구매 등급(L1~L4)"을 표현하는 게 정확히 어느 img/URL 인지 확인하고, 필요하면 여기서
          //   등급 뱃지만 골라내도록 좁혀야 한다(현재는 '첫 규격 뱃지'를 잠정 채택).
          if (!gradeBadgeUrl) gradeBadgeUrl = url;
        } else if (!avatarUrl) {
          avatarUrl = url; // 진짜 아바타(sc04/kf의 정사각 .jpg)
        }
      }

      // 행의 React fiber에서 구매 등급을 '값으로' 직접 읽는다(뱃지 URL 추측보다 정확).
      // 프로브 확정: memoizedProps.item.contact.userNewLevel(백업 item.userNewLevel),
      //   userNewLevelIcon=등급 뱃지, item.memberId=내부 식별자. (PROBE_IN_PAGE와 같은 fiber 훑기.)
      let userNewLevel = undefined;
      let userNewLevelIcon = undefined;
      let memberId = undefined;
      const fk = Object.keys(row).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
      if (fk) {
        let fiber = row[fk];
        let hops = 0;
        while (fiber && hops < 12 && userNewLevel === undefined) {
          const p = fiber.memoizedProps;
          if (p && typeof p === "object") {
            for (const base of [p.item, p.data, p.contact, p]) {
              if (!base || typeof base !== "object") continue;
              const c = base.contact && typeof base.contact === "object" ? base.contact : base;
              if (c.userNewLevel != null && userNewLevel === undefined) {
                userNewLevel = String(c.userNewLevel);
                if (c.userNewLevelIcon) userNewLevelIcon = String(c.userNewLevelIcon);
              }
              if ((base.memberId != null || c.memberId != null) && memberId === undefined) {
                memberId = String(base.memberId != null ? base.memberId : c.memberId);
              }
            }
          }
          fiber = fiber.return;
          hops += 1;
        }
      }

      return { avatarUrl, gradeBadgeUrl, userNewLevel, userNewLevelIcon, memberId };
    })()
  `;
}

// 인박스를 긁어 AlibabaRawConversation[]를 반환한다(파일 쓰기·프로세스 종료 없음 — 호출부가 결정).
// 에이전트가 서브프로세스 없이 함수로 직접 부른다. 치명적 상황은 throw.
export async function extractAlibaba(profileDir: string): Promise<AlibabaRawConversation[]> {
  const cookiesFile = `${profileDir}.cookies.json`; // login이 백업한 세션 쿠키
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error(CHROME_NOT_FOUND_MESSAGE);
  }

  // 자동화 플래그 없는 "그냥 크롬" + inquiry:login 이 만든 영구 프로필(화면 밖).
  const chrome = spawnChrome(chromePath, profileDir, DEBUG_PORT, ONETALK_URL, { offscreen: true });

  // ★크롬 정리 보장: 아래 어느 지점에서 throw/조기반환 해도 finally 가 크롬을 확실히 종료한다.
  //   예전엔 connectOverCDP/newPage/추출 중 에러가 kill 을 건너뛰어 크롬 자식 프로세스가 매 실패마다
  //   누적됐다(좀비). finally 로 감싸 매 사이클이 자기 크롬을 반드시 정리한다.
  try {
    if (!(await waitForCdp(DEBUG_PORT))) {
      throw new Error("크롬 디버그 포트가 안 열렸어요. 같은 프로필을 쓰는 다른 크롬 창이 떠 있으면 닫고 다시 시도하세요.");
    }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  // 🔎 주문 카운트(#5)·고객 활동(#7) JSONP 캡처는 goto '전에' 리스너를 건다(인박스 로드·대화 열 때
  //   터지는 queryCustomerInfo 응답을 놓치지 않게). ALIBABA_PROBE 일 때만 끝에서 파일로 덤프한다.
  //   ★캡처는 항상 켜 두되(부작용 없음 — 읽기만), 덤프/매핑은 안 한다. 라이브 키 확정용 진단.
  const capturedCustomerInfo = captureCustomerInfoResponses(page);

  // ★goto 전에 login이 백업한 세션 쿠키를 주입한다(프로필만으론 세션 쿠키가 사라져 로그인 페이지로 튐).
  const injected = await injectSessionCookies(context, cookiesFile);
  if (injected) {
    console.log(`백업 세션 쿠키 ${injected}개 주입(프로필 + 쿠키 이중 보강).`);
  }

  await page.goto(ONETALK_URL, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);

  // 세션 유효 + 인박스 로딩을 폴링으로 확인(URL만 보던 성급한 만료 오판 제거).
  const inboxState = await waitForInbox(page);
  if (inboxState === "login") {
    await browser.close();
    chrome.kill("SIGTERM");
    throw new Error("세션이 만료된 것 같아요(로그인 페이지에 계속 머무름). 다시 'add alibaba <라벨>'로 로그인하세요.");
  }
  if (inboxState === "timeout") {
    console.log("⏳ 대화 목록이 시간 내에 안 떴어요(대화가 없거나 로딩이 느림) — 그래도 추출을 시도합니다.");
  }

  // 클릭을 가로막는 모달(예: 오프라인 안내 팝업)을 닫는다. 안 닫으면 대화 클릭이 막혀 0개가 나온다.
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(500);
  await page
    .locator(".next-dialog-close, .im-next-dialog-close, [class*='dialog-close']")
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
  // 문자열로 평가(인라인 함수로 두면 tsc가 Node lib에 DOM 없다고 에러). 런타임은 그대로 동작.
  await page
    .evaluate(`document.querySelectorAll(".im-next-overlay-wrapper").forEach((el) => el.remove())`)
    .catch(() => undefined);

  // 🔎 등급 프로브(ALIBABA_PROBE 일 때만): 목록 첫 행들의 React 데이터를 파일로 덤프한다. 등급 필드명을
  //    라이브에서 한 번 확인하기 위한 1회성 진단(읽기 전용). ALIBABA_PROBE=only 면 프로브만 하고 끝낸다.
  if (process.env.ALIBABA_PROBE) {
    try {
      const probe = await page.evaluate(PROBE_CALL).catch(() => null);
      const probePath = dataFile("alibaba-grade-probe.json");
      await mkdir(dirname(probePath), { recursive: true });
      await writeFile(probePath, JSON.stringify(probe, null, 2), "utf8");
      console.log(`🔎 등급 프로브 저장됨: ${probePath}`);
      console.log("   이 파일을 그대로 두면(또는 공유하면) 등급이 어느 필드인지 찾아 매핑을 완성합니다.");
    } catch (error) {
      console.log("등급 프로브 실패(무시하고 진행):", error);
    }
    if (process.env.ALIBABA_PROBE === "only") {
      await browser.close();
      chrome.kill("SIGTERM");
      return [];
    }
  }

  const conversations: AlibabaRawConversation[] = [];
  const seenCodes = new Set<string>(); // 이미 push한 conversationCode
  const seenCids = new Set<string>(); // 이미 열어본 연락처 행(data-cid) — 재시도 방지

  // 한 대화를 연 뒤, 그 대화(cid)의 메시지가 fiber에 나타날 때까지 폴링한다(WebSocket 로딩 대기).
  // cid가 일치하면 "확실히 이 대화" → 채택. 일치 못 해도 패널이 안정되면(같은 code 2회 연속) 채택.
  async function waitForConversation(expectedCid: string | null): Promise<AlibabaRawConversation | null> {
    const deadline = Date.now() + OPEN_TIMEOUT_MS;
    let lastCode: string | undefined;
    let stable: AlibabaRawConversation | null = null;
    while (Date.now() < deadline) {
      const result = (await page.evaluate(EXTRACT_CALL).catch(() => null)) as AlibabaRawConversation | null;
      if (result && result.messages.length) {
        const code = result.messages[0]?.conversationCode;
        if (expectedCid && code === expectedCid) return result; // 확실히 이 대화
        if (code && code === lastCode) stable = result; // 잔상 아니라 패널이 안정됨
        lastCode = code;
      }
      await page.waitForTimeout(POLL_MS);
    }
    return stable;
  }

  // 한 대화(cid)를 열어 메시지 전체 이력을 긁어 conversations에 push. 새로 담았으면 true.
  // (메시지를 위로 스크롤하며 누적하는 로직은 종전과 동일 — 바뀐 건 '바깥에서 어떤 행을 여느냐'뿐.)
  async function extractOne(cid: string, dataName: string | null, dataAliId: string | null): Promise<boolean> {
    const rowLoc = page.locator(`.contact-item-container[data-cid="${cid}"]`).first();
    if ((await rowLoc.count().catch(() => 0)) === 0) {
      return false; // 아직 DOM에 없음(스크롤로 사라짐) — 마크 안 하고 다음 라운드에 다시 만난다.
    }
    seenCids.add(cid); // 행이 있어 처리 시도 → 마크(빈 대화여도 같은 행 무한 재시도 방지).

    // 행에서 아바타 + 등급 뱃지 URL을 함께 읽는다(예전엔 아바타만 읽고 뱃지는 버렸다).
    const rowImages = (await page.evaluate(buildReadRowProfileImageScript(cid, 0)).catch(() => undefined)) as
      | { avatarUrl?: string; gradeBadgeUrl?: string; userNewLevel?: string; userNewLevelIcon?: string; memberId?: string }
      | undefined;
    const profileImageUrl = rowImages?.avatarUrl;
    const gradeBadgeUrl = rowImages?.gradeBadgeUrl;
    const userNewLevel = rowImages?.userNewLevel;
    const userNewLevelIcon = rowImages?.userNewLevelIcon;
    const memberId = rowImages?.memberId;

    // 이 대화를 여는 동안 도착할 고객정보(queryCustomerInfo) 응답만 보려고 현재 캡처 길이를 스냅샷.
    const ciStart = capturedCustomerInfo.length;
    await rowLoc.click({ timeout: 5000 }).catch(() => undefined);
    const first = await waitForConversation(cid);
    if (!first || !first.messages.length) {
      return false; // 메시지 못 뜸(빈/로딩 실패)
    }

    const code = first.messages[0]?.conversationCode || cid || "";
    if (!code || seenCodes.has(code)) {
      return false; // 중복/무효 코드
    }
    seenCodes.add(code);

    // 가상 리스트라 한 화면에 ~20개만 그려진다. 위로 한 화면씩 올리며 매 스냅샷을 messageId로 누적.
    const byId = new Map<number | string, AlibabaRawConversation["messages"][number]>();
    const merge = (snap: AlibabaRawConversation | null) => {
      if (!snap) return;
      for (const m of snap.messages) {
        if (m.conversationCode === code && m.messageId != null && !byId.has(m.messageId)) {
          byId.set(m.messageId, m);
        }
      }
    };
    merge(first);

    let scrolls = 0;
    let stable = 0; // 스크롤했는데 새 메시지가 안 늘어난 연속 횟수
    while (scrolls < MAX_SCROLLS) {
      const scroll = (await page.evaluate(SCROLL_CALL).catch(() => null)) as { found: boolean; atTop: boolean } | null;
      await page.waitForTimeout(SCROLL_WAIT_MS);
      const before = byId.size;
      merge((await page.evaluate(EXTRACT_CALL).catch(() => null)) as AlibabaRawConversation | null);
      stable = byId.size === before ? stable + 1 : 0;
      scrolls += 1;
      // 맨 위 도달(또는 스크롤 컨테이너 없음=짧은 대화) + 2회 연속 새 메시지 없음 → 끝.
      if ((!scroll || !scroll.found || scroll.atTop) && stable >= 2) break;
    }

    const messages = [...byId.values()].sort((a, b) => (a.sendTime ?? 0) - (b.sendTime ?? 0));

    // 고객 활동(#7): 이 대화를 여는 동안 캡처된 queryCustomerInfo 응답에서 활동 지표를 뽑는다.
    //   연결 키가 없어(URL buyerAccountId ↔ 우리 memberId 형식 불일치) '열린 순서 윈도우'로 잡되,
    //   등급(growthLevel)이 행 fiber userNewLevel과 일치할 때만 채택해 오귀속을 막는다(모호하면 생략 = 빈 채로 둠).
    let activity: AlibabaBuyerActivity | undefined;
    let ciCompanyName: string | undefined; // queryCustomerInfo의 '진짜 회사명'(개인명·자리표시자 정리 후)
    let ciPersonName: string | undefined; // queryCustomerInfo의 '개인명'(firstName+lastName)
    const freshCi = capturedCustomerInfo
      .slice(ciStart)
      .map(readBuyerInfo)
      .filter(
        (x): x is { buyerInfo: Record<string, unknown>; grade?: string; companyName?: string; personName?: string } =>
          Boolean(x)
      );
    if (freshCi.length) {
      const want = (userNewLevel || first.contact.userNewLevel || "").trim().toUpperCase();
      const gradeMatch = want ? freshCi.find((f) => (f.grade ?? "").trim().toUpperCase() === want) : undefined;
      // 등급 일치 우선 → 없으면 이 창에서 캡처가 '딱 하나'일 때만(모호하지 않을 때) 채택.
      const chosen = gradeMatch ?? (freshCi.length === 1 ? freshCi[0] : undefined);
      if (chosen) {
        activity = buyerInfoToActivity(chosen.buyerInfo);
        // 개인명(firstName+lastName)은 회사명 정리의 기준으로도 쓴다(회사명==개인명이면 회사명을 비운다).
        ciPersonName = chosen.personName;
        ciCompanyName = cleanCompanyName(chosen.companyName, chosen.personName);
      }
    }

    // 회사명 최종 결정: queryCustomerInfo의 '진짜 회사명'을 최우선, 없으면 메시지 fiber companyName을
    //   개인명 기준으로 정리해 폴백(그마저 개인명과 같으면 undefined = 회사명 없음).
    const resolvedName = first.contact.name || dataName || ciPersonName || undefined;
    const resolvedCompanyName = ciCompanyName ?? cleanCompanyName(first.contact.companyName, resolvedName);

    conversations.push({
      owner: first.owner,
      contact: {
        ...first.contact,
        name: resolvedName,
        companyName: resolvedCompanyName,
        aliId: first.contact.aliId || dataAliId || undefined,
        profileImageUrl: first.contact.profileImageUrl || profileImageUrl,
        // 구매 등급을 행 fiber에서 직접 읽은 값으로 동봉(행 fiber 우선, 메시지 fiber 폴백). 해석은 normalize.normalizeAlibabaGrade.
        userNewLevel: userNewLevel || first.contact.userNewLevel,
        userNewLevelIcon: userNewLevelIcon || first.contact.userNewLevelIcon,
        memberId: memberId || first.contact.memberId,
        // 등급 뱃지 URL(폴백 보존). 등급 값은 userNewLevel 우선.
        alibabaGradeBadgeUrl: userNewLevelIcon || first.contact.alibabaGradeBadgeUrl || gradeBadgeUrl,
        // 고객 활동(queryCustomerInfo) — 위에서 등급 일치로 검증해 채택(없으면 기존값/빈 채).
        activity: activity ?? first.contact.activity
      },
      messages
    });
    const capped = scrolls >= MAX_SCROLLS ? " ⚠️상한도달(더 있을 수 있음)" : "";
    console.log(`  [${conversations.length}] ${cid}: ${messages.length}개 메시지 (스크롤 ${scrolls}회)${capped}`);
    return true;
  }

  // ★연락처 목록은 가상스크롤이라 '보이는 행'만 DOM에 있다. 목록을 한 화면씩 내리며 그때그때
  //   새로 나타난 행(data-cid)을 열어 추출한다. 더 내려도 새 행이 안 나오면(또는 맨 아래) 종료.
  //   (예전엔 처음 보이는 행만 읽어 목록 아래쪽 바이어를 통째로 놓쳤다.)
  console.log(`연락처 목록을 스크롤하며 대화를 추출합니다(상한 ${MAX_CONVERSATIONS})...`);
  let listScrolls = 0;
  let emptyStreak = 0; // 스크롤했는데 새로 연 대화가 없던 연속 횟수
  while (conversations.length < MAX_CONVERSATIONS && listScrolls <= MAX_LIST_SCROLLS) {
    const visible = (await page
      .$$eval(".contact-item-container", (els) =>
        els.map((e) => ({
          cid: e.getAttribute("data-cid"),
          name: e.getAttribute("data-name"),
          aliId: e.getAttribute("data-ali-id")
        }))
      )
      .catch(() => [])) as Array<{ cid: string | null; name: string | null; aliId: string | null }>;

    let openedThisRound = 0;
    for (const item of visible) {
      if (conversations.length >= MAX_CONVERSATIONS) break;
      if (!item.cid || seenCids.has(item.cid)) continue;
      if (await extractOne(item.cid, item.name, item.aliId)) openedThisRound += 1;
    }

    const listScroll = (await page.evaluate(SCROLL_LIST_DOWN_CALL).catch(() => null)) as
      | { found: boolean; atBottom: boolean }
      | null;
    await page.waitForTimeout(SCROLL_WAIT_MS);
    listScrolls += 1;
    emptyStreak = openedThisRound === 0 ? emptyStreak + 1 : 0;
    // 목록이 맨 아래(또는 스크롤 불가) + 2라운드 연속 새 대화 없음 → 끝.
    if ((!listScroll || !listScroll.found || listScroll.atBottom) && emptyStreak >= 2) break;
  }

  // 🔎 주문 카운트(#5)·고객 활동(#7) JSONP 덤프(ALIBABA_PROBE 일 때만): 대화들을 다 열어 본 뒤
  //   (그동안 queryCustomerInfo 응답이 쌓였다) 캡처한 원문을 파일로 떨군다. ★고객 활동(#7) 키는
  //   확정·배선됨(buyerInfoToActivity). 이 덤프는 남은 키(주문 카드수 등) 진단용으로만 유지한다.
  if (process.env.ALIBABA_PROBE) {
    try {
      const dumpPath = dataFile("alibaba-customer-info-probe.json");
      await mkdir(dirname(dumpPath), { recursive: true });
      await writeFile(
        dumpPath,
        JSON.stringify(
          {
            note: "queryCustomerInfo JSONP 원문 캡처. 고객 활동(#7)은 buyerInfo→AlibabaBuyerActivity 로 확정·배선됨(extract-session.buyerInfoToActivity). 이 덤프는 남은 키(주문 카드수 등) 진단용.",
            urlMatch: CUSTOMER_INFO_URL_RE.source,
            capturedCount: capturedCustomerInfo.length,
            responses: capturedCustomerInfo
          },
          null,
          2
        ),
        "utf8"
      );
      console.log(`🔎 고객정보/활동 JSONP 캡처 저장됨(${capturedCustomerInfo.length}건): ${dumpPath}`);
      if (capturedCustomerInfo.length === 0) {
        console.log(
          "   ⚠️ 0건 캡처 — URL 매칭(queryCustomerInfo 류)이 안 맞거나, '고객 활동' 패널을 열어야 응답이 터질 수 있어요. 라이브에서 엔드포인트명을 확인하세요."
        );
      }
    } catch (error) {
      console.log("고객정보/활동 JSONP 덤프 실패(무시하고 진행):", error);
    }
  }

    await browser.close();
    return conversations;
  } finally {
    // 모든 경로(성공/에러/조기반환)에서 크롬을 확실히 종료 — 누수 방지. 이미 죽었으면 SIGTERM 은 무해.
    chrome.kill("SIGTERM");
  }
}

// CLI 래퍼: 환경변수로 받아 extractAlibaba 실행 → 파일 저장(standalone inquiry:extract 용).
async function main() {
  const profileDir = process.env.QUALIFLOW_ALIBABA_PROFILE || resolve("../../.auth/alibaba-chrome-profile");
  const outputPath = process.env.QUALIFLOW_ALIBABA_OUTPUT || dataFile("alibaba-conversations.json");
  try {
    const conversations = await extractAlibaba(profileDir);
    if (!conversations.length) {
      console.error("추출된 대화가 없습니다. 대화를 하나 연 상태로 다시 시도하거나, 목록 셀렉터를 점검하세요.");
      process.exitCode = 1;
      return;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");
    console.log(`대화 ${conversations.length}개를 저장했습니다: ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// 이 파일을 직접 실행할 때만 CLI 동작(import/번들 시엔 안 돈다 — 파일명으로 판별해 번들에서도 안전).
const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("extract-session.ts") || entryFile.endsWith("extract-session.js")) {
  await main();
}
