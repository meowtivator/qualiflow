#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium, type Page, type Request, type Response } from "playwright-core";

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
  maxWebSocketPayloadChars: number;
  inspectIndexedDb: boolean;
  indexedDbSampleRecords: number;
  maxIndexedDbValueChars: number;
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

type WebSocketEvent = {
  type: "created" | "frame-received" | "frame-sent" | "closed" | "error";
  index: number;
  timestamp: string;
  requestId?: string;
  url?: string;
  opcode?: number;
  payloadSize?: number;
  payloadPreview?: string;
  signals: string[];
  errorMessage?: string;
};

type IndexedDbSnapshot = {
  capturedAt: string;
  pageUrl: string;
  databases: IndexedDbDatabaseSnapshot[];
  errorMessage?: string;
};

type IndexedDbDatabaseSnapshot = {
  name: string;
  version?: number;
  stores: IndexedDbStoreSnapshot[];
  errorMessage?: string;
};

type IndexedDbStoreSnapshot = {
  name: string;
  keyPath?: unknown;
  autoIncrement?: boolean;
  indexNames: string[];
  count?: number;
  sampleRecords: IndexedDbSampleRecord[];
  errorMessage?: string;
};

type IndexedDbSampleRecord = {
  keyPreview: unknown;
  valueKeys: string[];
  valuePreview: unknown;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: DEFAULT_INQUIRY_URL,
    storageState: DEFAULT_STORAGE_STATE,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    headless: false,
    browserChannel: "chrome",
    maxBodyChars: 120_000,
    maxWebSocketPayloadChars: 20_000,
    inspectIndexedDb: true,
    indexedDbSampleRecords: 3,
    maxIndexedDbValueChars: 1_500
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
    } else if (arg === "--max-websocket-payload-chars") {
      args.maxWebSocketPayloadChars = Number(next);
      index += 1;
    } else if (arg === "--no-indexeddb") {
      args.inspectIndexedDb = false;
    } else if (arg === "--indexeddb-sample-records") {
      args.indexedDbSampleRecords = Number(next);
      index += 1;
    } else if (arg === "--max-indexeddb-value-chars") {
      args.maxIndexedDbValueChars = Number(next);
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

async function writeJsonLine(path: string, event: NetworkEvent | WebSocketEvent) {
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function readFramePayload(value: Record<string, unknown>) {
  const response = value.response;
  const request = value.request;
  const frame = isRecord(response) ? response : isRecord(request) ? request : undefined;

  if (!frame) {
    return {};
  }

  return {
    opcode: readNumber(frame, "opcode"),
    payloadData: readString(frame, "payloadData")
  };
}

function createWebSocketEvent(
  type: WebSocketEvent["type"],
  index: number,
  params: unknown,
  requestUrls: Map<string, string>,
  maxPayloadChars: number
): WebSocketEvent {
  const record = isRecord(params) ? params : {};
  const requestId = readString(record, "requestId");
  const explicitUrl = readString(record, "url");
  const url = explicitUrl ?? (requestId ? requestUrls.get(requestId) : undefined);
  const { opcode, payloadData } = readFramePayload(record);
  const payloadPreview = payloadData ? redactText(payloadData).slice(0, maxPayloadChars) : undefined;

  return {
    type,
    index,
    timestamp: new Date().toISOString(),
    requestId,
    url,
    opcode,
    payloadSize: payloadData?.length,
    payloadPreview,
    signals: detectSignals(url ?? "", "", payloadPreview ?? "")
  };
}

function buildIndexedDbSnapshotScript(args: CliArgs) {
  const maxRecords = JSON.stringify(args.indexedDbSampleRecords);
  const maxValueChars = JSON.stringify(args.maxIndexedDbValueChars);

  return String.raw`
    (async () => {
      const maxRecords = ${maxRecords};
      const maxValueChars = ${maxValueChars};
      const indexedDb = globalThis.indexedDB;

      function redactString(value) {
        return String(value)
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
          .replace(/(?:access_token|refresh_token|token|session|sid|csrf|password)=([^&\s]+)/gi, "$1=[REDACTED_VALUE]")
          .replace(/("(?:accessToken|refreshToken|token|session|sid|csrf|password)"\s*:\s*")[^"]+/gi, "$1[REDACTED_VALUE]")
          .replace(/\+?\d[\d\s().-]{8,}\d/g, "[REDACTED_PHONE]")
          .slice(0, maxValueChars);
      }

      function listNames(names) {
        const result = [];

        if (!names) {
          return result;
        }

        for (let index = 0; index < names.length; index += 1) {
          const value = typeof names.item === "function" ? names.item(index) : names[index];

          if (typeof value === "string") {
            result.push(value);
          }
        }

        return result;
      }

      function previewValue(value, depth = 0, seen = new WeakSet()) {
        if (value === null || typeof value === "number" || typeof value === "boolean") {
          return value;
        }

        if (typeof value === "string") {
          return redactString(value);
        }

        if (typeof value === "undefined") {
          return "[undefined]";
        }

        if (typeof value !== "object") {
          return "[" + typeof value + "]";
        }

        if (seen.has(value)) {
          return "[circular]";
        }

        if (depth >= 4) {
          return Array.isArray(value) ? "[array:" + value.length + "]" : "[object]";
        }

        seen.add(value);

        if (Array.isArray(value)) {
          return value.slice(0, 5).map((item) => previewValue(item, depth + 1, seen));
        }

        const entries = Object.entries(value).slice(0, 30);
        const preview = {};

        for (const [key, item] of entries) {
          if (/token|session|cookie|csrf|password|secret/i.test(key)) {
            preview[key] = "[REDACTED_VALUE]";
          } else {
            preview[key] = previewValue(item, depth + 1, seen);
          }
        }

        return preview;
      }

      function valueKeys(value) {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return [];
        }

        return Object.keys(value).slice(0, 80);
      }

      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      async function openDatabase(name) {
        if (!indexedDb) {
          throw new Error("IndexedDB is not available in this page.");
        }

        return requestResult(indexedDb.open(name));
      }

      async function readCursorSamples(store) {
        if (maxRecords <= 0) {
          return [];
        }

        return new Promise((resolve, reject) => {
          const samples = [];
          const request = store.openCursor();

          request.onsuccess = () => {
            const cursor = request.result;

            if (!cursor || samples.length >= maxRecords) {
              resolve(samples);
              return;
            }

            samples.push({
              keyPreview: previewValue(cursor.key),
              valueKeys: valueKeys(cursor.value),
              valuePreview: previewValue(cursor.value)
            });
            cursor.continue();
          };
          request.onerror = () => reject(request.error);
        });
      }

      const snapshot = {
        capturedAt: new Date().toISOString(),
        pageUrl: globalThis.location && globalThis.location.href ? globalThis.location.href : "",
        databases: []
      };

      if (!indexedDb) {
        snapshot.errorMessage = "IndexedDB is not available in this page.";
        return snapshot;
      }

      if (typeof indexedDb.databases !== "function") {
        snapshot.errorMessage = "indexedDB.databases() is not available in this browser.";
        return snapshot;
      }

      const databases = await indexedDb.databases();

      for (const databaseInfo of databases) {
        if (!databaseInfo.name) {
          continue;
        }

        const databaseSnapshot = {
          name: databaseInfo.name,
          version: databaseInfo.version,
          stores: []
        };

        try {
          const database = await openDatabase(databaseInfo.name);
          const storeNames = listNames(database.objectStoreNames);

          for (const storeName of storeNames) {
            const storeSnapshot = {
              name: storeName,
              indexNames: [],
              sampleRecords: []
            };

            try {
              const transaction = database.transaction(storeName, "readonly");
              const store = transaction.objectStore(storeName);
              storeSnapshot.keyPath = previewValue(store.keyPath);
              storeSnapshot.autoIncrement = store.autoIncrement;
              storeSnapshot.indexNames = listNames(store.indexNames);
              storeSnapshot.count = await requestResult(store.count());
              storeSnapshot.sampleRecords = await readCursorSamples(store);
            } catch (error) {
              storeSnapshot.errorMessage = error instanceof Error ? error.message : "Unable to inspect object store.";
            }

            databaseSnapshot.stores.push(storeSnapshot);
          }

          database.close();
        } catch (error) {
          databaseSnapshot.errorMessage = error instanceof Error ? error.message : "Unable to open database.";
        }

        snapshot.databases.push(databaseSnapshot);
      }

      return snapshot;
    })()
  `;
}

async function writeIndexedDbSnapshot(page: Page, outputPath: string, args: CliArgs) {
  const snapshot = (await page.evaluate(buildIndexedDbSnapshotScript(args))) as IndexedDbSnapshot;

  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storageStatePath = resolve(args.storageState);
  const outputDir = resolve(args.outputDir ?? `${args.outputRoot}/${createTimestamp()}`);
  const responsesDir = resolve(outputDir, "responses");
  const eventsPath = resolve(outputDir, "network-events.jsonl");
  const websocketEventsPath = resolve(outputDir, "websocket-events.jsonl");
  const indexedDbSnapshotPath = resolve(outputDir, "indexeddb-snapshot.json");
  const summaryPath = resolve(outputDir, "summary.json");
  const harPath = resolve(outputDir, "network.har.zip");

  await readStorageState(storageStatePath);
  await mkdir(responsesDir, { recursive: true });
  await writeFile(eventsPath, "", "utf8");
  await writeFile(websocketEventsPath, "", "utf8");

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
  let websocketEventIndex = 0;
  let websocketFrameCount = 0;
  let responseBodyCount = 0;
  let candidateResponseCount = 0;
  const websocketRequestUrls = new Map<string, string>();

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  client.on("Network.webSocketCreated", async (params: unknown) => {
    const record = isRecord(params) ? params : {};
    const requestId = readString(record, "requestId");
    const url = readString(record, "url");

    if (requestId && url) {
      websocketRequestUrls.set(requestId, url);
    }

    await writeJsonLine(
      websocketEventsPath,
      createWebSocketEvent("created", websocketEventIndex++, params, websocketRequestUrls, args.maxWebSocketPayloadChars)
    ).catch(() => undefined);
  });
  client.on("Network.webSocketFrameReceived", async (params: unknown) => {
    websocketFrameCount += 1;
    await writeJsonLine(
      websocketEventsPath,
      createWebSocketEvent("frame-received", websocketEventIndex++, params, websocketRequestUrls, args.maxWebSocketPayloadChars)
    ).catch(() => undefined);
  });
  client.on("Network.webSocketFrameSent", async (params: unknown) => {
    websocketFrameCount += 1;
    await writeJsonLine(
      websocketEventsPath,
      createWebSocketEvent("frame-sent", websocketEventIndex++, params, websocketRequestUrls, args.maxWebSocketPayloadChars)
    ).catch(() => undefined);
  });
  client.on("Network.webSocketClosed", async (params: unknown) => {
    await writeJsonLine(
      websocketEventsPath,
      createWebSocketEvent("closed", websocketEventIndex++, params, websocketRequestUrls, args.maxWebSocketPayloadChars)
    ).catch(() => undefined);
  });
  client.on("Network.webSocketFrameError", async (params: unknown) => {
    const record = isRecord(params) ? params : {};
    const event = createWebSocketEvent("error", websocketEventIndex++, params, websocketRequestUrls, args.maxWebSocketPayloadChars);
    event.errorMessage = readString(record, "errorMessage");
    await writeJsonLine(websocketEventsPath, event).catch(() => undefined);
  });

  page.on("request", async (request: Request) => {
    const index = eventIndex++;
    const postData = request.postData() ?? "";
    const event: NetworkEvent = {
      type: "request",
      index,
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
    const index = eventIndex++;
    const contentType = response.headers()["content-type"] ?? "";
    let bodyPreview = "";
    let responseBodyFile: string | undefined;
    let errorMessage: string | undefined;

    if (shouldReadResponseBody(response)) {
      try {
        const rawText = await response.text();
        const redactedText = redactText(rawText).slice(0, args.maxBodyChars);
        const fileName = buildResponseFileName(index, response);
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
      index,
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

  let indexedDbStoreCount = 0;

  if (args.inspectIndexedDb) {
    const snapshot = await writeIndexedDbSnapshot(page, indexedDbSnapshotPath, args);
    indexedDbStoreCount = snapshot.databases.reduce((count, database) => count + database.stores.length, 0);
    console.log(`Saved IndexedDB snapshot: ${indexedDbSnapshotPath}`);
  }

  await context.close();
  await browser.close();

  const summary = {
    url: args.url,
    storageStatePath,
    outputDir,
    eventsPath,
    websocketEventsPath,
    indexedDbSnapshotPath: args.inspectIndexedDb ? indexedDbSnapshotPath : undefined,
    harPath,
    responseBodyCount,
    candidateResponseCount,
    websocketFrameCount,
    indexedDbStoreCount,
    finishedAt: new Date().toISOString()
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Saved inquiry network summary: ${summaryPath}`);
}

await main();
