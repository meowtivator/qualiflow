#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium, type Request, type Response } from "playwright-core";

const DEFAULT_INQUIRY_URL =
  "https://onetalk.alibaba.com/message/weblitePWA.htm?spm=a2700.product_home_fy25.home_header.108.2ce23a90UlLW4M&isGray=1&from=menu&hideMenu=1#/";
const DEFAULT_STORAGE_STATE = "../../.auth/alibaba.storage.json";
const DEFAULT_OUTPUT_ROOT = "../../.captures/alibaba-inquiry";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-csrf-token",
  "x-xsrf-token"
]);
const INQUIRY_SIGNAL_PATTERNS = [
  "onetalk",
  "message",
  "inquiry",
  "conversation",
  "chat",
  "buyer",
  "contact",
  "sender",
  "receiver"
];

type CliArgs = {
  url: string;
  storageState: string;
  outputDir?: string;
  outputRoot: string;
  headless: boolean;
  browserChannel?: "chrome" | "msedge" | "chromium";
  executablePath?: string;
  maxBodyChars: number;
};

type NetworkEvent = {
  type: "request" | "response";
  index: number;
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postDataPreview?: string;
  responseBodyFile?: string;
  responseBodyPreview?: string;
  signals: string[];
  errorMessage?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: DEFAULT_INQUIRY_URL,
    storageState: DEFAULT_STORAGE_STATE,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    headless: false,
    browserChannel: "chrome",
    maxBodyChars: 120_000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--url") {
      args.url = next;
      index += 1;
    } else if (arg === "--storage-state") {
      args.storageState = next;
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = next;
      index += 1;
    } else if (arg === "--output-root") {
      args.outputRoot = next;
      index += 1;
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--headed") {
      args.headless = false;
    } else if (arg === "--channel") {
      args.browserChannel = next as CliArgs["browserChannel"];
      index += 1;
    } else if (arg === "--executable-path") {
      args.executablePath = next;
      index += 1;
    } else if (arg === "--max-body-chars") {
      args.maxBodyChars = Number(next);
      index += 1;
    }
  }

  return args;
}

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeHeaders(headers: Record<string, string>) {
  const sanitized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();

    if (SENSITIVE_HEADER_NAMES.has(normalizedName)) {
      sanitized[name] = "[REDACTED_HEADER]";
    } else {
      sanitized[name] = redactText(value).slice(0, 500);
    }
  }

  return sanitized;
}

function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?:access_token|refresh_token|token|session|sid|csrf|password)=([^&\s]+)/gi, "$1=[REDACTED_VALUE]")
    .replace(/(\"(?:accessToken|refreshToken|token|session|sid|csrf|password)\"\s*:\s*\")[^\"]+/gi, "$1[REDACTED_VALUE]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[REDACTED_PHONE]");
}

function detectSignals(url: string, contentType = "", body = "") {
  const haystack = `${url}\n${contentType}\n${body.slice(0, 20_000)}`.toLowerCase();
  return INQUIRY_SIGNAL_PATTERNS.filter((pattern) => haystack.includes(pattern));
}

function shouldReadResponseBody(response: Response) {
  const request = response.request();
  const resourceType = request.resourceType();
  const contentType = response.headers()["content-type"] ?? "";

  if (!["fetch", "xhr"].includes(resourceType)) {
    return false;
  }

  return /json|text|javascript|x-www-form-urlencoded/i.test(contentType);
}

function buildResponseFileName(index: number, response: Response) {
  let host = "unknown";
  let path = "response";

  try {
    const url = new URL(response.url());
    host = url.hostname.replace(/^www\./, "");
    path = url.pathname.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "response";
  } catch {
    // Keep fallback names.
  }

  return `${String(index).padStart(4, "0")}-${host}-${path}.txt`.slice(0, 180);
}

async function readStorageState(path: string) {
  await readFile(path, "utf8");
}

async function writeJsonLine(path: string, event: NetworkEvent) {
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storageStatePath = resolve(args.storageState);
  const outputDir = resolve(args.outputDir ?? `${args.outputRoot}/${createTimestamp()}`);
  const responsesDir = resolve(outputDir, "responses");
  const eventsPath = resolve(outputDir, "network-events.jsonl");
  const summaryPath = resolve(outputDir, "summary.json");
  const harPath = resolve(outputDir, "network.har.zip");

  await readStorageState(storageStatePath);
  await mkdir(responsesDir, { recursive: true });

  const browser = await chromium.launch({
    headless: args.headless,
    channel: args.executablePath ? undefined : args.browserChannel,
    executablePath: args.executablePath
  });
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: 1440, height: 1000 },
    recordHar: {
      path: harPath
    }
  });
  const page = await context.newPage();
  let eventIndex = 0;
  let responseBodyCount = 0;
  let candidateResponseCount = 0;

  page.on("request", async (request: Request) => {
    const postData = request.postData() ?? "";
    const event: NetworkEvent = {
      type: "request",
      index: eventIndex++,
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      requestHeaders: sanitizeHeaders(request.headers()),
      postDataPreview: postData ? redactText(postData).slice(0, 2_000) : undefined,
      signals: detectSignals(request.url(), "", postData)
    };

    await writeJsonLine(eventsPath, event).catch(() => undefined);
  });

  page.on("response", async (response: Response) => {
    const contentType = response.headers()["content-type"] ?? "";
    let bodyPreview = "";
    let responseBodyFile: string | undefined;
    let errorMessage: string | undefined;

    if (shouldReadResponseBody(response)) {
      try {
        const rawText = await response.text();
        const redactedText = redactText(rawText).slice(0, args.maxBodyChars);
        const fileName = buildResponseFileName(eventIndex, response);
        responseBodyFile = `responses/${fileName}`;
        bodyPreview = redactedText.slice(0, 4_000);
        responseBodyCount += 1;

        await writeFile(resolve(outputDir, responseBodyFile), redactedText, "utf8");
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Unable to read response body.";
      }
    }

    const signals = detectSignals(response.url(), contentType, bodyPreview);

    if (signals.length > 0 && shouldReadResponseBody(response)) {
      candidateResponseCount += 1;
    }

    const event: NetworkEvent = {
      type: "response",
      index: eventIndex++,
      timestamp: new Date().toISOString(),
      method: response.request().method(),
      url: response.url(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      contentType,
      responseHeaders: sanitizeHeaders(response.headers()),
      responseBodyFile,
      responseBodyPreview: bodyPreview || undefined,
      signals,
      errorMessage
    };

    await writeJsonLine(eventsPath, event).catch(() => undefined);
  });

  await page.goto(args.url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000
  });

  console.log(`Alibaba inquiry recorder opened: ${args.url}`);
  console.log("Use the browser manually. Open inquiry lists, click buyer threads, and scroll/load more messages.");
  console.log(`Capture directory: ${outputDir}`);

  const rl = createInterface({ input, output });
  await rl.question("Press Enter here when you are done recording...");
  rl.close();

  await context.close();
  await browser.close();

  const summary = {
    url: args.url,
    storageStatePath,
    outputDir,
    eventsPath,
    harPath,
    responseBodyCount,
    candidateResponseCount,
    finishedAt: new Date().toISOString()
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Saved inquiry network summary: ${summaryPath}`);
}

await main();
