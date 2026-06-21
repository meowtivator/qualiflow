#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const PROFILE_DIR = resolve("../../.auth/instagram-chrome-profile");
const CONNECTION_STATUS_FILE = resolve("../../apps/web/.data/instagram-connection.json");
const LOGIN_URL = "https://www.instagram.com/direct/inbox/";
const DEBUG_PORT = 9223;
const WEB_MODE = process.argv.includes("--web");
const DEFAULT_WEB_TIMEOUT_MS = 5 * 60 * 1000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter((value): value is string => Boolean(value));

async function findChrome(): Promise<string | null> {
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

function getArgValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inlineValue = process.argv.find((arg) => arg.startsWith(prefix));

  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getTimeoutMs(): number {
  const rawValue = getArgValue("--timeout-ms");
  const parsedValue = rawValue ? Number(rawValue) : DEFAULT_WEB_TIMEOUT_MS;

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_WEB_TIMEOUT_MS;
}

function delay(ms: number) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

type ChromeTarget = {
  title?: string;
  type?: string;
  url?: string;
};

async function readChromeTargets(): Promise<ChromeTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as unknown;

    return Array.isArray(payload) ? (payload as ChromeTarget[]) : [];
  } catch {
    return [];
  }
}

function isInstagramInboxTarget(target: ChromeTarget) {
  const url = target.url ?? "";

  return (
    target.type === "page" &&
    url.includes("instagram.com/direct/inbox") &&
    !url.includes("instagram.com/accounts/login")
  );
}

async function waitForInstagramInbox(timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const targets = await readChromeTargets();

    if (targets.some(isInstagramInboxTarget)) {
      return true;
    }

    await delay(1500);
  }

  return false;
}

async function writeConnectionStatus(status: "active" | "needs_relogin", detail: string) {
  const checkedAt = new Date().toISOString();

  await mkdir(dirname(CONNECTION_STATUS_FILE), { recursive: true });
  await writeFile(
    CONNECTION_STATUS_FILE,
    `${JSON.stringify(
      {
        accountKind: "user_account",
        accountLabel: "Instagram local session",
        authMode: "browser_session",
        capabilities: ["read_messages", "send_messages", "sync_history"],
        channel: "instagram",
        checkedAt,
        detail,
        id: "instagram:local-session",
        lastSyncedAt: status === "active" ? checkedAt : undefined,
        ownerLabel: "Local runtime",
        status
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

const chromePath = await findChrome();
if (!chromePath) {
  console.error("Chrome executable was not found. Set CHROME_PATH to the Chrome binary path.");
  process.exit(1);
}

await mkdir(PROFILE_DIR, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    LOGIN_URL
  ],
  { stdio: "ignore" }
);

console.log("\nA dedicated Chrome profile opened for Instagram.");
console.log("If the inbox is already visible, the session is already available in this runtime profile.");
console.log("If not, log in manually, confirm the Instagram DM inbox is visible, then return here and press Enter.\n");

if (WEB_MODE) {
  const connected = await waitForInstagramInbox(getTimeoutMs());

  if (connected) {
    await writeConnectionStatus(
      "active",
      "Instagram runtime confirmed that the dedicated profile can open Instagram Direct."
    );
    console.log(`Connector status written: ${CONNECTION_STATUS_FILE}`);
    chrome.kill("SIGTERM");
    process.exit(0);
  }

  await writeConnectionStatus(
    "needs_relogin",
    "Instagram Direct was not visible before the web login helper timed out. Try connecting again."
  );
  console.error("Instagram Direct was not detected before timeout.");
  chrome.kill("SIGTERM");
  process.exit(1);
}

const rl = createInterface({ input, output });
await rl.question("Press Enter after Instagram Direct is visible... ");
rl.close();

await writeConnectionStatus("active", "Instagram login helper completed. Collector will validate the session during sync.");

console.log(`\nSession profile: ${PROFILE_DIR}`);
console.log(`Connector status written: ${CONNECTION_STATUS_FILE}`);
console.log("The web app can now detect this Instagram connector from /api/connectors/status.");

chrome.kill("SIGTERM");
