import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

type LaunchRequestPayload = {
  channel?: unknown;
};

const LAUNCHABLE_CHANNELS = new Set(["instagram"]);
const RUNTIME_BY_CHANNEL: Record<string, { script: string; timeoutMs: number }> = {
  instagram: {
    script: "packages/adapter-instagram/src/cli/login-session.ts",
    timeoutMs: 5 * 60 * 1000
  }
};

const REPO_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../..");
const NODE_BIN_DIR = path.dirname(process.execPath);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Windows: Chrome, fall back to Edge (Chromium-based → same CDP behavior). Built from
  // env vars so no hardcoded C:; undefined entries are dropped by filter(Boolean) below.
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
].filter((value): value is string => Boolean(value));

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let payload: LaunchRequestPayload;

  try {
    payload = (await request.json()) as LaunchRequestPayload;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const channel = typeof payload.channel === "string" ? payload.channel.trim().toLowerCase() : "";
  const runtime = RUNTIME_BY_CHANNEL[channel];

  if (!LAUNCHABLE_CHANNELS.has(channel) || !runtime) {
    return NextResponse.json(
      {
        code: "unsupported_connector_runtime",
        ok: false,
        message: "아직 웹에서 실행할 수 있는 로컬 런타임이 없는 커넥터입니다."
      },
      { status: 400 }
    );
  }

  const chromePath = await findChrome();

  if (!chromePath) {
    return NextResponse.json(
      {
        code: "hosted_runtime_unavailable",
        help:
          "로컬에서 QualiFlow를 실행하면 웹 버튼으로 전용 Chrome을 열 수 있습니다. 배포형 SaaS에서는 데스크톱 connector agent, 브라우저 확장, 또는 공식 OAuth/API 연동이 필요합니다.",
        ok: false,
        message:
          "현재 접속한 서버에서는 사용자 PC의 Chrome을 열 수 없습니다. 로컬 런타임 또는 공식 계정 연동 방식이 필요합니다."
      },
      { status: 501 }
    );
  }

  const tsxPath = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const scriptPath = path.join(REPO_ROOT, runtime.script);

  if (!(await fileExists(tsxPath)) || !(await fileExists(scriptPath))) {
    return NextResponse.json(
      {
        code: "runtime_files_missing",
        ok: false,
        message: "이 배포 환경에서 connector runtime 파일을 찾지 못했습니다."
      },
      { status: 500 }
    );
  }

  const child = spawn(
    tsxPath,
    [scriptPath, "--web", `--timeout-ms=${runtime.timeoutMs}`],
    {
      cwd: REPO_ROOT,
      detached: true,
      env: {
        ...process.env,
        CHROME_PATH: chromePath,
        PATH: `${NODE_BIN_DIR}:${process.env.PATH ?? ""}`
      },
      stdio: "ignore"
    }
  );

  child.unref();

  return NextResponse.json({
    channel,
    message: "전용 브라우저 창을 열었습니다. 열린 창에서 로그인을 완료하면 자동으로 연결됩니다.",
    ok: true
  });
}
