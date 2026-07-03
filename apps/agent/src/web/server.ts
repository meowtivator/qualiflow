// 설치 마법사 로컬 웹서버 — 127.0.0.1 에만 바인딩(외부 노출 금지). 마법사 HTML 을 서빙하고,
// /api/* 가 기존 CLI 로직(pair / addAccount / 채널 로그인 / listAccounts)을 호출한다.
//
// ★보안 경계(AGENTS.md 3항):
//   - HOST=127.0.0.1 고정 → 같은 컴퓨터에서만 접근. 0.0.0.0 으로 열지 않는다.
//   - 페어링 토큰은 pair() 가 OS 키체인(token-store)에 저장하고, 웹 UI 로는 토큰 값을 절대 안 보낸다
//     (/api/status 는 paired: true/false 만 반환).
//   - 채널 세션은 .auth 에 로컬 저장(원래대로). 서버로 안 감.

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import qrcode from "qrcode-terminal";

import { addAccount, listAccounts, sanitizeLabel, sessionPath } from "../accounts";
import { CLOUD_BASE_URL } from "../config";
import { loginInstagram } from "../connectors/instagram";
import { loginTelegram, type TelegramAuthPrompts } from "../connectors/telegram";
import { loginWhatsApp } from "../connectors/whatsapp";
import { loginAlibaba } from "@qualiflow/adapter-alibaba/runtime";
import { pair } from "../pair";
import { loadToken } from "../token-store";
import { WIZARD_HTML } from "./wizard-html";

const HOST = "127.0.0.1";
const PORT = Number(process.env.QUALIFLOW_WIZARD_PORT) || 4317;
const DEFAULT_LABEL = "기본";

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

// 라벨 등록(이미 있으면 무시) — 세션 저장 전에 등록부에 넣어 마법사가 진행 상태를 라벨로 매칭한다.
async function ensureRegistered(channel: string, label: string): Promise<void> {
  await addAccount(channel, label).catch(() => undefined);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
      phoneCode: async () => {
        st.stage = "code"; // 코드 콜백이 불렸다 = 텔레그램이 코드를 보냈다 → 입력 대기
        return codeGate.promise;
      },
      // 2FA 계정은 이번 웹 흐름에서 미지원 — 무한대기 대신 명확한 에러로 종료(다음 단계 과제).
      password: async () => {
        throw new Error("2단계 인증(2FA)이 켜진 계정은 아직 웹 로그인이 안 됩니다 — 터미널 'add telegram'을 쓰세요.");
      },
      onError: (err) => {
        st.stage = "error";
        st.error = err.message;
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

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
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
  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve));
  const target = `http://${HOST}:${PORT}`;
  console.log(`🪄 설치 마법사: ${target}`);
  console.log(`   클라우드: ${CLOUD_BASE_URL}`);
  if (options.open !== false) openBrowser(target);
  // 서버는 계속 떠 있는다(사용자가 마법사를 마칠 때까지). 프로세스 종료는 Ctrl+C.
}
