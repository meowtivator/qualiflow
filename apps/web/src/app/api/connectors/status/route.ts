import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

type ConnectorStatus = "disconnected" | "active" | "needs_relogin" | "error";

type ConnectorStatusResponse = {
  channel: string;
  checkedAt: string;
  detail: string;
  source: "connection_status" | "runtime_missing";
  status: ConnectorStatus;
};

const SUPPORTED_CHANNELS = new Set(["alibaba", "instagram", "telegram", "whatsapp"]);
const CONNECTOR_STATUSES = new Set<ConnectorStatus>(["disconnected", "active", "needs_relogin", "error"]);

const DATA_DIR_CANDIDATES = [
  path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"),
  path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "web", ".data")
];

type RuntimeStatusRecord = {
  channel?: unknown;
  checkedAt?: unknown;
  detail?: unknown;
  status?: unknown;
};

function normalizeRuntimeStatus(channel: string, value: unknown): ConnectorStatusResponse | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as RuntimeStatusRecord;
  const status = typeof record.status === "string" ? record.status : undefined;

  if (!status || !CONNECTOR_STATUSES.has(status as ConnectorStatus)) {
    return undefined;
  }

  return {
    channel,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : new Date().toISOString(),
    detail:
      typeof record.detail === "string"
        ? record.detail
        : status === "active"
          ? "채널 런타임이 로그인 세션을 확인했습니다."
          : "채널 런타임이 아직 로그인 세션을 확인하지 못했습니다.",
    source: "connection_status",
    status: status as ConnectorStatus
  };
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function readRuntimeStatus(channel: string): Promise<ConnectorStatusResponse | undefined> {
  for (const dataDir of DATA_DIR_CANDIDATES) {
    const perChannelStatus = await readJsonFile(path.join(dataDir, `${channel}-connection.json`));
    const normalizedPerChannel = normalizeRuntimeStatus(channel, perChannelStatus);

    if (normalizedPerChannel) {
      return normalizedPerChannel;
    }

    const connectorStatus = await readJsonFile(path.join(dataDir, "connector-status.json"));

    if (Array.isArray(connectorStatus)) {
      const matched = connectorStatus.find((item) => {
        return item && typeof item === "object" && (item as RuntimeStatusRecord).channel === channel;
      });
      const normalizedMatched = normalizeRuntimeStatus(channel, matched);

      if (normalizedMatched) {
        return normalizedMatched;
      }
    }

    if (connectorStatus && typeof connectorStatus === "object" && channel in connectorStatus) {
      const normalizedMapped = normalizeRuntimeStatus(channel, (connectorStatus as Record<string, unknown>)[channel]);

      if (normalizedMapped) {
        return normalizedMapped;
      }
    }
  }

  return undefined;
}

async function resolveConnectorStatus(channel: string): Promise<ConnectorStatusResponse> {
  const checkedAt = new Date().toISOString();

  if (!SUPPORTED_CHANNELS.has(channel)) {
    return {
      channel,
      checkedAt,
      detail: "지원하지 않는 채널입니다.",
      source: "runtime_missing",
      status: "error"
    };
  }

  const runtimeStatus = await readRuntimeStatus(channel);

  if (runtimeStatus) {
    return runtimeStatus;
  }

  return {
    channel,
    checkedAt,
    detail: "아직 연결된 계정이 없습니다. 연결 버튼을 눌러 로그인을 시작하세요.",
    source: "runtime_missing",
    status: "disconnected"
  };
}

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel")?.trim().toLowerCase();

  if (!channel) {
    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        detail: "channel query가 필요합니다.",
        source: "runtime_missing",
        status: "error"
      },
      { status: 400 }
    );
  }

  return NextResponse.json(await resolveConnectorStatus(channel));
}
