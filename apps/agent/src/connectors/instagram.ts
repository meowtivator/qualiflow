// Instagram 커넥터 — mautrix-meta 방식: DOM 스크랩도, 모바일 사칭 API도 아니라
// "instagram.com 웹 세션(쿠키) + IG 내부 웹 API(/api/v1/direct_v2/inbox/)"를 쓴다.
//   - 기존 IG 브라우저 로그인(영구 프로필)을 재사용 → 로그인된 페이지 '안에서' 인박스 API를 호출
//     (page.evaluate fetch → 쿠키 자동 첨부, same-origin이라 CORS 없음). 구조화 JSON이라 안정적이고,
//     진짜 웹 세션이라 모바일 사칭 API보다 계정 정지 위험이 낮다.
//   - 세션은 영구 프로필(.auth/instagram[--label])에 로컬 저장(★서버로 안 감).

import { delay, findChrome, spawnChrome, waitForCdp } from "@qualiflow/adapter-alibaba/runtime";
import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import type { MessageAttachment } from "@qualiflow/core";
import { chromium, type Page } from "playwright-core";

import { cacheMedia, fetchUrlBytes } from "../media";

const DEBUG_PORT = 9223;
const INBOX_URL = "https://www.instagram.com/direct/inbox/";
const IG_APP_ID = "936619743392459"; // 인스타그램 웹 앱 id(공개값)
const LOGIN_TIMEOUT_MS = Number(process.env.QUALIFLOW_LOGIN_TIMEOUT_MS) || 5 * 60 * 1000;

// IG 미디어 노드(이미지 후보/영상 버전)는 여러 래퍼(media / visual_media / clip) 아래 같은 모양으로 반복된다.
//   image_versions2.candidates[].url = 화질별 이미지 URL, video_versions[].url = 화질별 영상 URL.
//   응답 모양이 자주 바뀌므로 전부 옵셔널로 두고 "있으면 첫 URL" 식으로만 읽는다(permissive).
type IgMediaNode = {
  image_versions2?: { candidates?: { url?: string }[] };
  video_versions?: { url?: string }[];
};
type IgItem = {
  item_id?: string;
  item_type?: string;
  text?: string;
  timestamp?: number | string;
  user_id?: number | string;
  media?: IgMediaNode; // 일반 사진/영상
  visual_media?: { media?: IgMediaNode }; // 사라지는(once-view) 사진/영상
  clip?: { clip?: { video_versions?: { url?: string }[] } }; // 릴스/클립 공유
};

// item에서 받을 수 있는 첫 CDN URL을 고른다(이미지>영상 순, 래퍼별로 흔한 모양을 차례로 시도). 없으면 undefined.
function extractIgMediaUrl(item: IgItem): string | undefined {
  return (
    item.media?.image_versions2?.candidates?.[0]?.url ??
    item.media?.video_versions?.[0]?.url ??
    item.visual_media?.media?.image_versions2?.candidates?.[0]?.url ??
    item.visual_media?.media?.video_versions?.[0]?.url ??
    item.clip?.clip?.video_versions?.[0]?.url ??
    undefined
  );
}
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
//   offscreen: 로그인은 false(사용자가 봐야 함), fetch/send는 true(창 안 보이게).
async function withInstagramPage<T>(
  profileDir: string,
  fn: (page: Page) => Promise<T>,
  options: { offscreen?: boolean } = {}
): Promise<T> {
  const chromePath = await findChrome();
  if (!chromePath) {
    throw new Error("Chrome 실행파일을 못 찾았어요. CHROME_PATH 환경변수로 경로를 지정하세요.");
  }
  const chrome = spawnChrome(chromePath, profileDir, DEBUG_PORT, INBOX_URL, { offscreen: options.offscreen });
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
        const text = item.text ?? "";
        // 텍스트가 아니면(또는 텍스트가 비었으면) 미디어 URL이 있는지 보고, 있으면 받아서 첨부로 만든다.
        // ★IG CDN URL은 만료되므로 지금(fetch 시점) 바이트로 받아 영구화한다.
        let attachment: MessageAttachment | undefined;
        if (item.item_type !== "text") {
          const mediaUrl = extractIgMediaUrl(item);
          if (mediaUrl) {
            try {
              const got = await fetchUrlBytes(mediaUrl); // CDN URL → 바이트(+MIME). 실패/과대면 null.
              if (got) {
                attachment = await cacheMedia({
                  key: `instagram_${item.item_id ?? `${thread.thread_id}-${item.timestamp ?? ""}`}_0`,
                  bytes: got.bytes,
                  mimeType: got.mimeType
                });
              }
            } catch {
              // 다운로드 실패 — 미디어는 건너뛰되 나머지는 계속.
            }
          }
        }
        if (!text && !attachment) {
          continue; // 텍스트도 받을 미디어도 없으면 건너뜀(예: 좋아요/시스템 이벤트, 추출 불가 공유)
        }
        const tsMicro = Number(item.timestamp ?? 0);
        messages.push({
          id: String(item.item_id ?? `${thread.thread_id}-${tsMicro}`),
          text,
          sentAt: new Date(Math.round(tsMicro / 1000)).toISOString(), // IG는 마이크로초
          direction: String(item.user_id ?? "") === viewerPk ? "outbound" : "inbound",
          ...(attachment ? { attachments: [attachment] } : {})
        });
      }
      if (!messages.length) {
        continue;
      }
      messages.reverse(); // 최신순 → 오래된 순

      const other = (thread.users ?? [])[0];
      // ★발송은 recipient pk(상대 user igid)로 한다(IGDirectTextSendMutation의 recipient_igids).
      //   그래서 1:1 DM은 상대 pk를 id로 저장한다(thread_id 39자리로는 발송 불가). 그룹은 첫 참가자 pk(한계).
      const threadId = String(other?.pk ?? thread.thread_id ?? "");
      conversations.push({
        threadId,
        contact: { id: threadId, name: thread.thread_title ?? other?.full_name ?? other?.username ?? "instagram" },
        messages
      });
    }

    return conversations;
  }, { offscreen: true });
}

// 메시지 발송 — IG 웹은 DM을 GraphQL 뮤테이션(IGDirectTextSendMutation)으로 보낸다(REST broadcast는 막힘).
//   recipientId = 불러온 대화의 threadId(=상대 user pk). 페이지에서 fb_dtsg/lsd(쓰기 CSRF)를 추출해 POST.
export async function sendInstagram(profileDir: string, recipientId: string, text: string): Promise<void> {
  const script = `(async () => {
    try {
      function cookie(name) { var m = document.cookie.match(new RegExp(name + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : ""; }
      // fb_dtsg / lsd 토큰을 페이지 부트스트랩 스크립트에서 추출(쓰기엔 이게 필수 — 없으면 로그인으로 튕김).
      function tok(name) {
        try { if (window.require) { var mod = window.require(name); if (mod && mod.token) return mod.token; } } catch (e1) {}
        var m = document.documentElement.innerHTML.match(new RegExp('"' + name + '".{0,80}?"token":"([^"]+)"'));
        return m ? m[1] : "";
      }
      var csrf = cookie("csrftoken");
      var av = cookie("ds_user_id");        // 보내는(내) 계정 id
      var dtsg = tok("DTSGInitData");
      var lsd = tok("LSD");
      if (!dtsg || !av) { return "fail: 토큰추출 실패 dtsg=" + (dtsg ? "y" : "n") + " lsd=" + (lsd ? "y" : "n") + " av=" + (av ? "y" : "n"); }
      var jazoest = 0; for (var i = 0; i < dtsg.length; i++) { jazoest += dtsg.charCodeAt(i); } jazoest = "2" + jazoest;
      var oti = String(Date.now()) + String(Math.floor(Math.random() * 1000000)); // offline_threading_id(멱등)
      var variables = {
        ig_thread_igid: null,
        offline_threading_id: oti,
        recipient_igids: [${JSON.stringify(recipientId)}],
        replied_to_client_context: null, replied_to_item_id: null, reply_to_message_id: null, sampled: null,
        text: { sensitive_string_value: ${JSON.stringify(text)} },
        mentions: [], mentioned_user_ids: [], commands: null,
        forwarded_from_thread_id: null, is_forwarded_from_own_message: null,
        send_attribution: "igd_web_chat_tab:in_thread"
      };
      var body = new URLSearchParams();
      body.set("av", av);
      body.set("__a", "1");
      body.set("__comet_req", "7");
      body.set("fb_dtsg", dtsg);
      body.set("jazoest", jazoest);
      body.set("lsd", lsd);
      body.set("variables", JSON.stringify(variables));
      body.set("doc_id", "26911679871773184");
      body.set("fb_api_caller_class", "RelayModern");
      body.set("fb_api_req_friendly_name", "IGDirectTextSendMutation");
      body.set("server_timestamps", "true");
      var res = await fetch("/api/graphql", {
        method: "POST",
        headers: {
          "X-CSRFToken": csrf,
          "X-FB-Friendly-Name": "IGDirectTextSendMutation",
          "X-FB-LSD": lsd,
          "X-ASBD-ID": "359341",
          "X-IG-App-ID": "${IG_APP_ID}",
          "content-type": "application/x-www-form-urlencoded"
        },
        credentials: "include",
        body: body.toString()
      });
      var t = await res.text();
      if (t.indexOf("for (;;);") === 0) { t = t.slice(9); } // FB 안티-하이재킹 프리픽스 제거
      var j = null;
      try { j = JSON.parse(t); } catch (e2) { try { j = JSON.parse(t.split("\\n")[0]); } catch (e3) {} }
      if (res.ok && j && j.data && !j.errors) { return "ok:sent"; }
      return "fail status=" + res.status + " body=" + t.slice(0, 250);
    } catch (e) { return "error:" + (e && e.message ? e.message : String(e)); }
  })()`;

  await withInstagramPage(profileDir, async (page) => {
    await delay(1500); // 페이지/세션 로드 대기
    // 로그인 페이지에 쏘지 않게 세션이 살아있는지 인박스 API로 먼저 확인.
    if (!(await callInbox(page))?.inbox) {
      throw new Error(
        "인스타 세션이 만료됐어요('계속' 화면 자동 복구 실패). 'login instagram <라벨>'로 재로그인 후 다시 보내세요."
      );
    }
    const result = (await page.evaluate(script).catch((error) => `evaluate-error:${String(error)}`)) as string;
    if (!result.startsWith("ok")) {
      throw new Error(`Instagram 발송 실패: ${result}`);
    }
    console.log(`📤 Instagram 발송 완료 → ${recipientId} (${result})`);
  }, { offscreen: true });
}
