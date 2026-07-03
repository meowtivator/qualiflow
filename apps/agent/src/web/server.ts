// 설치 마법사 로컬 웹서버 — 127.0.0.1 에만 바인딩(외부 노출 금지). 마법사 HTML 을 서빙하고,
// /api/* 가 기존 CLI 로직(pair / addAccount / 채널 로그인 / listAccounts)을 호출한다.
//
// ★보안 경계(AGENTS.md 3항):
//   - HOST=127.0.0.1 고정 → 같은 컴퓨터에서만 접근. 0.0.0.0 으로 열지 않는다.
//   - 페어링 토큰은 pair() 가 OS 키체인(token-store)에 저장하고, 웹 UI 로는 토큰 값을 절대 안 보낸다
//     (/api/status 는 paired: true/false 만 반환).
//   - 채널 세션은 .auth 에 로컬 저장(원래대로). 서버로 안 감.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import qrcode from "qrcode-terminal";

import { addAccount, listAccounts, sanitizeLabel, sessionPath } from "../accounts";
import { AGENT_VERSION, CLOUD_BASE_URL } from "../config";
import { buildAuthUrl, exchangeCode } from "../connectors/email";
import { loginInstagram } from "../connectors/instagram";
import { loginTelegram, type TelegramAuthPrompts } from "../connectors/telegram";
import { loginWhatsApp } from "../connectors/whatsapp";
import { loginAlibaba } from "@qualiflow/adapter-alibaba/runtime";
import { pair } from "../pair";
import { latestRelease, performSelfUpdate } from "../self-update";
import { loadToken } from "../token-store";
import { WIZARD_HTML } from "./wizard-html";

const HOST = "127.0.0.1";
const PORT = Number(process.env.QUALIFLOW_WIZARD_PORT) || 4317;
const DEFAULT_LABEL = "기본";
// 2FA 미지원 안내 문구(센티널). password 콜백이 이걸 throw → onError 가 이 문구면 gramjs 루프를 끊는다.
const TG_2FA_UNSUPPORTED = "2단계 인증(2FA)이 켜진 계정은 아직 웹 로그인이 안 됩니다 — 터미널 'add telegram'을 쓰세요.";

// 창(Chrome)으로 로그인하는 채널 — 터미널 없이 동작하므로 웹에서 바로 트리거 가능.
// (whatsapp=QR / telegram=전화코드 는 아래 웹 전용 흐름으로 배선)
const WINDOW_LOGIN: Record<string, (profileDir: string) => Promise<void>> = {
  alibaba: loginAlibaba,
  instagram: loginInstagram
};

// QR 문자열 → 비트 매트릭스(boolean[][]). qrcode-terminal의 공개 generate(small)이 뱉는
// 유니코드 반블록 문자열을 되읽어 셀 격자로 되돌린다(★새 의존성/딥임포트 없이 공개 API만 사용).
//   small 출력은 한 줄에 세로 2셀을 담는다(코드포인트로 비교 — 소스에 고평면 글리프를 안 남긴다):
//   FULL(U+2588)=위·아래 둘 다 검정, SPACE=둘 다 흰색, UPPER(U+2580)=위만, LOWER(U+2584)=아래만.
const QR_FULL = "█"; // 위·아래 둘 다 검정
const QR_UPPER = "▀"; // 위만 검정
const QR_LOWER = "▄"; // 아래만 검정
function qrMatrix(payload: string): boolean[][] {
  let block = "";
  qrcode.generate(payload, { small: true }, (out: string) => {
    block = out;
  });
  const lines = block.replace(/\n+$/, "").split("\n");
  const rows: boolean[][] = [];
  for (const line of lines) {
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    for (const ch of line) {
      top.push(ch === QR_FULL || ch === QR_UPPER);
      bottom.push(ch === QR_FULL || ch === QR_LOWER);
    }
    rows.push(top, bottom);
  }
  return rows;
}

// 채널 웹 로그인의 진행 상태(프로세스 메모리에만; 서버로 안 감). key = channel\0label.
//   whatsapp: qr(현재 QR 매트릭스, 스캔되면 null), done, error
//   telegram: 2단계(전화→코드) 진행 상태 + 콜백을 채울 deferred
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type WaState = { kind: "whatsapp"; qr: boolean[][] | null; done: boolean; error?: string };
type TgStage = "phone" | "code" | "done" | "error";
type TgState = {
  kind: "telegram";
  stage: TgStage;
  error?: string;
  codeGate?: Deferred<string>; // 코드 입력을 기다리는 게이트(코드 도착 시 resolve)
};
// 창(alibaba/instagram) 로그인 진행 상태(#63) — 로그인은 fire-and-forget(사용자가 창에서 몇 분까지
// 걸릴 수 있어 HTTP 응답을 붙잡지 못함)이라, 실패를 이 상태로 마법사 UI에 표면화한다(에러 안 삼킴).
type WinState = { kind: "window"; status: "connecting" | "done" | "error"; message?: string };
const connectState = new Map<string, WaState | TgState | WinState>();
function ckey(channel: string, label: string): string {
  return channel + ":" + label;
}

// 이메일 OAuth 진행 중인 state → 어떤 라벨/redirect 로 교환할지(콜백이 code와 함께 이걸로 찾는다).
// 메모리에만 둔다(서버로 안 감). state 는 추측 불가한 랜덤 → CSRF/혼선 방지.
const emailOAuth = new Map<string, { label: string; redirectUri: string }>();

// 라벨 등록(이미 있으면 무시) — 세션 저장 전에 등록부에 넣어 마법사가 진행 상태를 라벨로 매칭한다.
async function ensureRegistered(channel: string, label: string): Promise<void> {
  await addAccount(channel, label).catch(() => undefined);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

// CRM 웹(crm.thedozers.com 등 다른 오리진)이 브라우저 fetch 로 읽을 수 있게 CORS 허용.
// ★버전 노출·업데이트 트리거 전용(3개 엔드포인트만) — 시크릿/페어링/상태는 이 헬퍼를 안 쓴다.
// 서버는 127.0.0.1 바인딩이라 '같은 컴퓨터의 브라우저 탭'만 도달할 수 있다(외부 X). 하지만 그 탭이
// '대표가 방문한 아무 웹사이트'일 수도 있어(CSRF), self-update 같은 상태변경은 * 로 열면 위험하다.
// → 허용 Origin 화이트리스트로 좁힌다: 로컬 마법사 자신 + CRM(로컬/배포). 그 외 Origin 은 CORS 헤더를
//   안 붙이거나(읽기) 403 으로 거부(self-update). credentials 는 안 쓰므로 echo 방식으로 충분.
const ALLOWED_ORIGINS = new Set(
  [
    "https://crm.thedozers.com",
    `http://${HOST}:${PORT}`,
    `http://localhost:${PORT}`,
    // 설치본 CLOUD_URL(배포 CRM 오리진). 프로토콜+호스트만(경로/포트 포함) — new URL 로 정규화.
    (() => {
      try {
        return new URL(CLOUD_BASE_URL).origin;
      } catch {
        return "";
      }
    })()
  ].filter(Boolean)
);

// 요청 Origin 이 화이트리스트면 그 값을, 아니면 null(=CORS 헤더 안 붙임).
function allowedOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && ALLOWED_ORIGINS.has(origin) ? origin : null;
}

// 읽기 전용(version/latest)용 — 허용 Origin 이면 그 Origin 을 echo, 아니면 CORS 헤더 없이 응답한다.
//   (CORS 헤더가 없으면 타 오리진 브라우저 fetch 는 응답을 못 읽지만, 서버는 500 을 안 낸다.)
function sendCors(res: ServerResponse, status: number, body: unknown, req: IncomingMessage): void {
  const json = JSON.stringify(body);
  const origin = allowedOrigin(req);
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin"; // Origin 별로 응답이 달라지므로 캐시 오염 방지.
  }
  res.writeHead(status, headers);
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 10_000) raw = raw.slice(0, 10_000); // 방어: 과대 바디 차단
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(WIZARD_HTML);
    return;
  }

  if (req.method === "GET" && url === "/api/cloud-url") {
    send(res, 200, { url: CLOUD_BASE_URL });
    return;
  }

  // 설치된 에이전트 버전 — CRM 웹이 이 값으로 "설치됨/업데이트 있음"을 판단한다. 시크릿 없음(CORS 허용).
  if (req.method === "GET" && url === "/api/version") {
    sendCors(res, 200, { version: AGENT_VERSION, platform: process.platform }, req);
    return;
  }

  // 최신 릴리스 버전 조회(GitHub) — 웹이 설치버전과 비교해 "업데이트 있음"을 표시. 실패해도 마법사는 계속.
  if (req.method === "GET" && url === "/api/latest") {
    try {
      const latest = await latestRelease();
      sendCors(res, 200, { version: latest?.version ?? null }, req);
    } catch (error) {
      sendCors(res, 200, { version: null, message: error instanceof Error ? error.message : "조회 실패" }, req);
    }
    return;
  }

  if (req.method === "GET" && url === "/api/status") {
    const token = await loadToken();
    const accounts = (await listAccounts()).map((a) => ({ channel: a.channel, label: a.label }));
    // 창-로그인(alibaba/instagram) 진행/실패 상태만 골라 "채널 라벨" 키로 준다(#63). 마법사 sckey 와 일치.
    const connecting: Record<string, { status: string; message?: string }> = {};
    for (const [key, st] of connectState) {
      if (st.kind !== "window") continue;
      const [channel, label] = key.split(":");
      connecting[`${channel} ${label}`] = { status: st.status, message: st.message };
    }
    send(res, 200, { paired: Boolean(token), accounts, connecting });
    return;
  }

  if (req.method === "POST" && url === "/api/pair") {
    const body = await readJson(req);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      send(res, 200, { ok: false, message: "코드를 입력하세요." });
      return;
    }
    try {
      await pair(code);
      send(res, 200, { ok: true });
    } catch (error) {
      send(res, 200, { ok: false, message: error instanceof Error ? error.message : "페어링 실패" });
    }
    return;
  }

  if (req.method === "POST" && url === "/api/connect") {
    const body = await readJson(req);
    const channel = typeof body.channel === "string" ? body.channel : "";
    const label = sanitizeLabel(typeof body.label === "string" && body.label ? body.label : DEFAULT_LABEL);
    const login = WINDOW_LOGIN[channel];
    if (!login) {
      send(res, 200, { ok: false, message: "이 채널은 곧 클릭 연결을 지원합니다(현재는 터미널)." });
      return;
    }
    try {
      await addAccount(channel, label).catch(() => undefined); // 이미 등록돼 있으면 무시
      // 로그인 창을 띄운다. 사용자가 창에서 로그인 완료할 때까지 걸리므로 응답은 기다리지 않는다(fire-and-forget).
      // ★단, 결과(성공/실패)는 connectState 에 기록해 /api/status 로 마법사에 표면화한다(에러 안 삼킴, #63).
      const key = ckey(channel, label);
      connectState.set(key, { kind: "window", status: "connecting" });
      login(sessionPath(channel, label))
        .then(() => connectState.set(key, { kind: "window", status: "done" }))
        .catch((error: unknown) =>
          connectState.set(key, {
            kind: "window",
            status: "error",
            message: error instanceof Error ? error.message : "로그인 창을 열지 못했습니다."
          })
        );
      send(res, 200, { ok: true, started: true });
    } catch (error) {
      send(res, 200, { ok: false, message: error instanceof Error ? error.message : "연결 시작 실패" });
    }
    return;
  }

  // WhatsApp QR 웹 로그인 시작 — Baileys 연결을 띄우고 QR을 메모리에 보관(마법사가 /api/wa-qr로 폴링).
  if (req.method === "POST" && url === "/api/connect-whatsapp") {
    const body = await readJson(req);
    const label = sanitizeLabel(typeof body.label === "string" && body.label ? body.label : DEFAULT_LABEL);
    const key = ckey("whatsapp", label);
    const st: WaState = { kind: "whatsapp", qr: null, done: false };
    connectState.set(key, st);
    // fire-and-forget: 로그인이 끝날 때까지(스캔) 오래 걸리므로 응답은 즉시 준다. 진행은 /api/wa-qr로.
    loginWhatsApp({
      authDir: sessionPath("whatsapp", label),
      onQr: (qr) => {
        st.qr = qrMatrix(qr);
      }
    })
      .then(async () => {
        await ensureRegistered("whatsapp", label);
        st.qr = null;
        st.done = true;
      })
      .catch((error: unknown) => {
        st.qr = null;
        st.error = error instanceof Error ? error.message : "WhatsApp 로그인 실패";
      });
    send(res, 200, { ok: true, started: true });
    return;
  }

  // 현재 WhatsApp QR 매트릭스(있으면) / done / error 를 마법사에 준다. QR 원문 문자열은 넘기지 않는다.
  if (req.method === "GET" && url === "/api/wa-qr") {
    const label = sanitizeLabel(new URL(req.url || "/", "http://x").searchParams.get("label") || DEFAULT_LABEL);
    const st = connectState.get(ckey("whatsapp", label));
    if (!st || st.kind !== "whatsapp") {
      send(res, 200, { qr: null, done: false });
      return;
    }
    send(res, 200, { qr: st.qr, done: st.done, error: st.error ?? null });
    return;
  }

  // Telegram 1단계 — 전화번호로 로그인 시작. 텔레그램이 코드를 사용자 앱/문자로 보낸다 → "코드 대기".
  if (req.method === "POST" && url === "/api/connect-telegram") {
    const body = await readJson(req);
    const label = sanitizeLabel(typeof body.label === "string" && body.label ? body.label : DEFAULT_LABEL);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) {
      send(res, 200, { ok: false, message: "전화번호를 입력하세요(국가코드 포함, 예: +8210...)." });
      return;
    }
    const key = ckey("telegram", label);
    const codeGate = deferred<string>();
    const st: TgState = { kind: "telegram", stage: "phone", codeGate };
    connectState.set(key, st);

    const prompts: TelegramAuthPrompts = {
      phoneNumber: async () => phone,
      // ★게이트 재무장: gramjs auth.js 의 phoneCode 루프(while(1))는 SignIn 실패 시 onError 후
      //   phoneCode() 를 다시 부른다. 매번 '다음 제출'을 기다리는 새 deferred 를 만들어 돌려줘야
      //   틀린 코드 뒤 사용자가 새 코드를 넣을 때까지 대기한다. (안 그러면 이미 resolve된 같은
      //   promise 를 즉시 돌려줘 같은 틀린 코드로 SignIn 무한반복 → FLOOD_WAIT/차단.)
      phoneCode: async () => {
        st.codeGate = deferred<string>(); // 재무장 — 항상 '다음 코드 제출'을 기다린다
        st.stage = "code"; // 코드 콜백이 불렸다 = 텔레그램이 코드를 보냈다 → 입력 대기
        return st.codeGate.promise;
      },
      // 2FA 계정은 이번 웹 흐름에서 미지원. ★단순 throw 하면 gramjs signInWithPassword 의 while(1)
      //   (auth.js:307)이 onError 후 password() 를 즉시 다시 불러 무한반복한다(phoneCode 와 같은 함정).
      //   그래서 아래 onError 가 이 문구를 만나면 truthy 를 반환해 루프를 끊는다(loginTelegram reject).
      password: async () => {
        throw new Error(TG_2FA_UNSUPPORTED);
      },
      // gramjs onError 반환이 truthy면 while(1) 루프를 끊고 loginTelegram 이 AUTH_USER_CANCEL 로
      //   reject 된다(auth.js:139-142, 325-328). 코드 오류(만료/오타)는 falsy 를 반환해 루프를 안 끊는다
      //   — phoneCode 재무장(위)이 '다음 코드'를 기다려 사용자가 새 코드로 재시도할 수 있게. 반면 2FA
      //   미지원은 회복 불가라 truthy 로 즉시 끊어 무한루프를 막는다.
      onError: (err): boolean => {
        st.stage = err.message === TG_2FA_UNSUPPORTED ? "error" : "code";
        st.error = err.message; // PHONE_CODE_INVALID / PHONE_CODE_EXPIRED / 2FA 안내를 그대로 노출
        return err.message === TG_2FA_UNSUPPORTED; // 2FA는 즉시 중단, 코드 오류는 계속(재시도 가능)
      }
    };

    loginTelegram(sessionPath("telegram", label), prompts)
      .then(async () => {
        await ensureRegistered("telegram", label);
        st.stage = "done";
      })
      .catch((error: unknown) => {
        st.stage = "error";
        st.error = error instanceof Error ? error.message : "Telegram 로그인 실패";
      });

    send(res, 200, { ok: true, started: true });
    return;
  }

  // Telegram 2단계 — 사용자가 앱/문자로 받은 코드를 입력. 코드 게이트를 열어 로그인을 완료시킨다.
  if (req.method === "POST" && url === "/api/connect-telegram-code") {
    const body = await readJson(req);
    const label = sanitizeLabel(typeof body.label === "string" && body.label ? body.label : DEFAULT_LABEL);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const st = connectState.get(ckey("telegram", label));
    if (!st || st.kind !== "telegram" || !st.codeGate) {
      send(res, 200, { ok: false, message: "먼저 전화번호로 로그인을 시작하세요." });
      return;
    }
    if (!code) {
      send(res, 200, { ok: false, message: "받은 코드를 입력하세요." });
      return;
    }
    st.error = undefined; // 새 코드 제출 = 이전 코드 오류를 지운다(재시도 진입)
    st.codeGate.resolve(code); // phoneCode 콜백이 이 값을 받아 로그인 진행
    send(res, 200, { ok: true });
    return;
  }

  // Telegram 진행 상태(전화 대기 / 코드 대기 / 완료 / 에러)를 마법사에 준다.
  if (req.method === "GET" && url === "/api/tg-state") {
    const label = sanitizeLabel(new URL(req.url || "/", "http://x").searchParams.get("label") || DEFAULT_LABEL);
    const st = connectState.get(ckey("telegram", label));
    if (!st || st.kind !== "telegram") {
      send(res, 200, { stage: "phone", error: null });
      return;
    }
    send(res, 200, { stage: st.stage, error: st.error ?? null });
    return;
  }

  // 이메일 OAuth 시작 — 구글 동의 URL을 만들어 돌려준다(브라우저는 클라이언트가 연다). redirect 는
  // 이 마법사 서버 자신(127.0.0.1:PORT/oauth/callback) — loopback 이라 토큰이 이 컴퓨터를 안 떠난다.
  if (req.method === "POST" && url === "/api/connect-email") {
    const body = await readJson(req);
    const label = sanitizeLabel(typeof body.label === "string" && body.label ? body.label : DEFAULT_LABEL);
    const redirectUri = `http://${HOST}:${PORT}/oauth/callback`;
    // 추측 불가한 state(랜덤 16바이트) — 콜백에서 이 값으로 라벨/redirect 를 되찾고, CSRF 를 막는다.
    const state = randomBytes(16).toString("hex");
    emailOAuth.set(state, { label, redirectUri });
    const key = ckey("email", label);
    connectState.set(key, { kind: "window", status: "connecting" });
    try {
      const authUrl = buildAuthUrl(redirectUri, state); // GMAIL_CLIENT_ID 없으면 여기서 throw
      send(res, 200, { ok: true, authUrl });
    } catch (error) {
      emailOAuth.delete(state);
      connectState.set(key, { kind: "window", status: "error", message: error instanceof Error ? error.message : "설정 필요" });
      send(res, 200, { ok: false, message: error instanceof Error ? error.message : "이메일 연결 시작 실패" });
    }
    return;
  }

  // 구글 OAuth 콜백 — 사용자가 승인하면 구글이 이 loopback URL로 code를 돌려준다. code→refresh_token 교환
  // 후 로컬 저장(★서버로 안 감) + 계정 등록. 브라우저 탭에는 결과 안내 HTML을 그린다(탭 닫고 마법사로).
  if (req.method === "GET" && url === "/oauth/callback") {
    const params = new URL(req.url || "/", `http://${HOST}:${PORT}`).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code") ?? "";
    const oauthError = params.get("error");
    const pending = emailOAuth.get(state);
    if (!pending) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(oauthResultHtml("연결 실패", "세션을 찾을 수 없습니다. 마법사에서 다시 시도하세요."));
      return;
    }
    emailOAuth.delete(state);
    const key = ckey("email", pending.label);
    if (oauthError || !code) {
      connectState.set(key, { kind: "window", status: "error", message: oauthError ?? "승인 코드가 없습니다." });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(oauthResultHtml("연결 취소됨", "승인이 완료되지 않았습니다. 마법사로 돌아가 다시 시도하세요."));
      return;
    }
    try {
      await addAccount("email", pending.label).catch(() => undefined); // 이미 등록돼 있으면 무시
      await exchangeCode(sessionPath("email", pending.label), code, pending.redirectUri);
      connectState.set(key, { kind: "window", status: "done" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(oauthResultHtml("이메일 연결 완료", "이 탭을 닫고 마법사로 돌아가세요."));
    } catch (error) {
      connectState.set(key, { kind: "window", status: "error", message: error instanceof Error ? error.message : "토큰 교환 실패" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(oauthResultHtml("연결 실패", error instanceof Error ? error.message : "토큰 교환에 실패했습니다."));
    }
    return;
  }

  // CORS 프리플라이트(브라우저가 non-simple 요청 전에 보냄) — 허용 Origin 이면 그 Origin+메서드를 echo,
  // 아니면 CORS 헤더 없이 204(브라우저가 실제 요청을 막는다). self-update/version/latest 공통.
  if (req.method === "OPTIONS" && (url === "/api/self-update" || url === "/api/version" || url === "/api/latest")) {
    const origin = allowedOrigin(req);
    const headers: Record<string, string> = { vary: "Origin" };
    if (origin) {
      headers["access-control-allow-origin"] = origin;
      headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
      headers["access-control-allow-headers"] = "content-type";
      headers["access-control-max-age"] = "600";
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // 자가 업데이트 — 명시 트리거(웹의 [업데이트] 버튼)로만. 최신 설치본을 받아 임시폴더에 풀고
  // 설치 파일이 든 폴더를 연다(자동 실행 아님 — 사용자가 install 파일을 실행해 서비스 재등록·재시작).
  // ★보안: self-update.ts 가 우리 릴리스 URL 화이트리스트 + 원자적 검증을 수행(그 파일 주석 참조).
  if (req.method === "POST" && url === "/api/self-update") {
    // ★CSRF 완화: 상태변경이므로 요청 Origin 이 화이트리스트일 때만 처리. Origin 없음(브라우저 fetch 는
    //   항상 붙임 → 없으면 스크립트/서버간 호출)도 거부해 '아무 웹사이트가 트리거'를 막는다.
    if (!allowedOrigin(req)) {
      sendCors(res, 403, { ok: false, message: "허용되지 않은 출처(Origin)입니다 — 업데이트를 거부합니다." }, req);
      return;
    }
    try {
      const result = await performSelfUpdate();
      // applying=true(Windows 자동 적용 시작): 무음 업데이터가 상주를 교체·재시작 중 → 웹이 버전 폴링으로
      //   완료를 확인한다. applying=false(mac/linux, 또는 자동 실패 폴백): 폴더를 열었으니 수동 실행 안내.
      const message = result.applying
        ? `새 버전 ${result.version} 을(를) 적용 중입니다. 자동 재시작이 끝나면 최신 버전으로 바뀝니다.`
        : `새 버전 ${result.version} 설치본을 열었습니다. 폴더의 설치 파일을 실행하면 업데이트됩니다.`;
      sendCors(res, 200, {
        ok: true,
        version: result.version,
        folder: result.folder,
        applying: result.applying,
        message
      }, req);
    } catch (error) {
      sendCors(res, 200, { ok: false, message: error instanceof Error ? error.message : "업데이트 실패" }, req);
    }
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

// OAuth 콜백 탭에 그리는 최소 안내 HTML(마법사 본체와 별개 — 그냥 결과만).
function oauthResultHtml(title: string, message: string): string {
  const safe = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${safe(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f5fb;color:#1c1b22;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e7e5ee;border-radius:14px;padding:32px 28px;max-width:380px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#5b5966;line-height:1.6;margin:0}</style></head>
<body><div class="card"><h1>${safe(title)}</h1><p>${safe(message)}</p></div></body></html>`;
}

function openBrowser(target: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const args = process.platform === "win32" ? ["", target] : [target];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    // 브라우저 자동 열기 실패는 치명적 아님 — URL 을 콘솔에 남긴다.
  }
}

export async function startWizard(options: { open?: boolean } = {}): Promise<void> {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, message: "서버 오류" });
    });
  });
  // 포트 충돌 방어(EADDRINUSE): 이미 다른 마법사 인스턴스가 4317 을 서빙 중이면 크래시하지 않고
  // 조용히 정상 종료(exit 0). 상주 서비스가 재시작 루프로 크래시 로그를 쏟아내는 것을 막는다.
  // 그 외 리슨 에러는 삼키지 않고 그대로 throw(reject) 해 진짜 문제는 드러낸다.
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.log(`🪄 마법사가 이미 ${HOST}:${PORT} 에서 실행 중입니다 — 이 인스턴스는 종료합니다.`);
        process.exit(0);
      }
      reject(err);
    });
    server.listen(PORT, HOST, resolve);
  });
  const target = `http://${HOST}:${PORT}`;
  console.log(`🪄 설치 마법사: ${target}`);
  console.log(`   클라우드: ${CLOUD_BASE_URL}`);
  if (options.open !== false) openBrowser(target);
  // 서버는 계속 떠 있는다(사용자가 마법사를 마칠 때까지). 프로세스 종료는 Ctrl+C.
}
