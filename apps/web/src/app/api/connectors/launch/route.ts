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
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
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
        ok: false,
        message: "This connector does not have a web-launchable local runtime yet."
      },
      { status: 400 }
    );
  }

  const chromePath = await findChrome();

  if (!chromePath) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local Chrome was not found on this server. Hosted QualiFlow cannot open the user's browser; use a local runtime agent or official OAuth connector."
      },
      { status: 501 }
    );
  }

  const tsxPath = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const scriptPath = path.join(REPO_ROOT, runtime.script);

  if (!(await fileExists(tsxPath)) || !(await fileExists(scriptPath))) {
    return NextResponse.json(
      {
        ok: false,
        message: "Connector runtime files are missing in this deployment."
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
    message: "Local connector runtime launched. Complete login in the dedicated browser window.",
    ok: true
  });
}
