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

const rl = createInterface({ input, output });
await rl.question("Press Enter after Instagram Direct is visible... ");
rl.close();

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
      detail: "Instagram login helper completed. Collector will validate the session during sync.",
      id: "instagram:local-session",
      lastSyncedAt: checkedAt,
      ownerLabel: "Local runtime",
      status: "active"
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`\nSession profile: ${PROFILE_DIR}`);
console.log(`Connector status written: ${CONNECTION_STATUS_FILE}`);
console.log("The web app can now detect this Instagram connector from /api/connectors/status.");

chrome.kill("SIGTERM");
