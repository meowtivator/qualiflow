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

import { addAccount, listAccounts, sanitizeLabel, sessionPath } from "../accounts";
import { CLOUD_BASE_URL } from "../config";
import { loginInstagram } from "../connectors/instagram";
import { loginAlibaba } from "../fetch";
import { pair } from "../pair";
import { loadToken } from "../token-store";
import { WIZARD_HTML } from "./wizard-html";

const HOST = "127.0.0.1";
const PORT = Number(process.env.QUALIFLOW_WIZARD_PORT) || 4317;
const DEFAULT_LABEL = "기본";

// 창(Chrome)으로 로그인하는 채널 — 터미널 없이 동작하므로 웹에서 바로 트리거 가능.
// (whatsapp=QR / telegram=전화코드 는 터미널 상호작용이라 다음 단계에서 웹 전용 흐름으로 배선)
const WINDOW_LOGIN: Record<string, (profileDir: string) => Promise<void>> = {
  alibaba: loginAlibaba,
  instagram: loginInstagram
};

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
    send(res, 200, { paired: Boolean(token), accounts });
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
      login(sessionPath(channel, label)).catch(() => undefined);
      send(res, 200, { ok: true, started: true });
    } catch (error) {
      send(res, 200, { ok: false, message: error instanceof Error ? error.message : "연결 시작 실패" });
    }
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
