import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

type ConnectorStatus = "disconnected" | "active" | "needs_relogin" | "error";

type ConnectorConnectionStatus = {
  accountKind?: string;
  accountLabel: string;
  authMode?: string;
  capabilities?: string[];
  channel: string;
  checkedAt: string;
  detail: string;
  externalAccountId?: string;
  id: string;
  lastSyncedAt?: string;
  ownerLabel?: string;
  ownerUserId?: string;
  source: "connection_status" | "runtime_missing";
  status: ConnectorStatus;
};

const SUPPORTED_CHANNELS = new Set(["alibaba", "instagram", "telegram", "whatsapp"]);
const CONNECTOR_STATUSES = new Set<ConnectorStatus>(["disconnected", "active", "needs_relogin", "error"]);
const SYNC_DATA_FILES_BY_CHANNEL: Record<string, string[]> = {
  alibaba: ["alibaba-conversations.json"],
  instagram: ["instagram-conversations.json"],
  telegram: ["telegram-conversations.json"],
  whatsapp: ["whatsapp-conversations.json"]
};

const DATA_DIR_CANDIDATES = [
  path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"),
  path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "web", ".data")
];

type RuntimeStatusRecord = {
  accountKind?: unknown;
  accountLabel?: unknown;
  authMode?: unknown;
  capabilities?: unknown;
  channel?: unknown;
  checkedAt?: unknown;
  detail?: unknown;
  externalAccountId?: unknown;
  id?: unknown;
  lastSyncedAt?: unknown;
  ownerLabel?: unknown;
  ownerUserId?: unknown;
  status?: unknown;
};

type DisconnectRequestPayload = {
  channel?: unknown;
  connectionId?: unknown;
  deleteData?: unknown;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeRuntimeStatus(
  value: unknown,
  fallback: { channel?: string; id?: string } = {}
): ConnectorConnectionStatus | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as RuntimeStatusRecord;
  const channel = typeof record.channel === "string" ? record.channel : fallback.channel;
  const id = typeof record.id === "string" ? record.id : fallback.id ?? (channel ? `${channel}:default` : undefined);
  const status = typeof record.status === "string" ? record.status : undefined;

  if (!id || !channel || !SUPPORTED_CHANNELS.has(channel) || !status || !CONNECTOR_STATUSES.has(status as ConnectorStatus)) {
    return undefined;
  }

  return {
    accountKind: typeof record.accountKind === "string" ? record.accountKind : undefined,
    accountLabel:
      typeof record.accountLabel === "string" && record.accountLabel.trim()
        ? record.accountLabel
        : `${channel} 계정`,
    authMode: typeof record.authMode === "string" ? record.authMode : undefined,
    capabilities: isStringArray(record.capabilities) ? record.capabilities : undefined,
    channel,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : new Date().toISOString(),
    detail:
      typeof record.detail === "string"
        ? record.detail
        : status === "active"
          ? "채널 런타임이 로그인 세션을 확인했습니다."
          : "채널 런타임이 아직 로그인 세션을 확인하지 못했습니다.",
    externalAccountId: typeof record.externalAccountId === "string" ? record.externalAccountId : undefined,
    id,
    lastSyncedAt: typeof record.lastSyncedAt === "string" ? record.lastSyncedAt : undefined,
    ownerLabel: typeof record.ownerLabel === "string" ? record.ownerLabel : undefined,
    ownerUserId: typeof record.ownerUserId === "string" ? record.ownerUserId : undefined,
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

function shouldRemoveConnection(connection: ConnectorConnectionStatus | undefined, channel: string, connectionId?: string) {
  if (!connection) {
    return false;
  }

  if (connectionId) {
    return connection.id === connectionId;
  }

  return connection.channel === channel;
}

function removeFromConnectorStatusPayload(value: unknown, channel: string, connectionId?: string) {
  if (Array.isArray(value)) {
    const nextValue = value.filter((item) => !shouldRemoveConnection(normalizeRuntimeStatus(item), channel, connectionId));
    return {
      changed: nextValue.length !== value.length,
      value: nextValue
    };
  }

  if (!value || typeof value !== "object") {
    return {
      changed: false,
      value
    };
  }

  let changed = false;
  const nextEntries = Object.entries(value).filter(([key, item]) => {
    const fallback = SUPPORTED_CHANNELS.has(key) ? { channel: key, id: `${key}:default` } : { id: key };
    const normalized = normalizeRuntimeStatus(item, fallback);
    const shouldRemove = shouldRemoveConnection(normalized, channel, connectionId);

    if (shouldRemove) {
      changed = true;
    }

    return !shouldRemove;
  });

  return {
    changed,
    value: Object.fromEntries(nextEntries)
  };
}

function normalizeConnectorStatusPayload(value: unknown): ConnectorConnectionStatus[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const normalized = normalizeRuntimeStatus(item);
      return normalized ? [normalized] : [];
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const fallback = SUPPORTED_CHANNELS.has(key) ? { channel: key, id: `${key}:default` } : { id: key };
    const normalized = normalizeRuntimeStatus(item, fallback);

    return normalized ? [normalized] : [];
  });
}

async function readRuntimeStatuses(): Promise<ConnectorConnectionStatus[]> {
  const connectionsById = new Map<string, ConnectorConnectionStatus>();

  for (const dataDir of DATA_DIR_CANDIDATES) {
    const connectorStatus = await readJsonFile(path.join(dataDir, "connector-status.json"));

    for (const connection of normalizeConnectorStatusPayload(connectorStatus)) {
      connectionsById.set(connection.id, connection);
    }

    for (const channel of SUPPORTED_CHANNELS) {
      const perChannelStatus = await readJsonFile(path.join(dataDir, `${channel}-connection.json`));
      const normalizedPerChannel = normalizeRuntimeStatus(perChannelStatus, { channel, id: `${channel}:default` });

      if (normalizedPerChannel) {
        connectionsById.set(normalizedPerChannel.id, normalizedPerChannel);
      }
    }
  }

  return [...connectionsById.values()].sort((a, b) => {
    if (a.channel !== b.channel) {
      return a.channel.localeCompare(b.channel);
    }

    return a.accountLabel.localeCompare(b.accountLabel);
  });
}

function createMissingStatus(channel: string, connectionId?: string): ConnectorConnectionStatus {
  return {
    accountLabel: `${channel} 계정`,
    channel,
    checkedAt: new Date().toISOString(),
    detail: "아직 연결된 계정이 없습니다. 연결 버튼을 눌러 로그인을 시작하세요.",
    id: connectionId ?? `${channel}:default`,
    source: "runtime_missing",
    status: "disconnected"
  };
}

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel")?.trim().toLowerCase();
  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();

  if (!channel && !connectionId) {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      connections: await readRuntimeStatuses()
    });
  }

  if (channel && !SUPPORTED_CHANNELS.has(channel)) {
    return NextResponse.json(
      {
        ...createMissingStatus(channel, connectionId),
        detail: "지원하지 않는 채널입니다.",
        status: "error"
      },
      { status: 400 }
    );
  }

  const connections = await readRuntimeStatuses();
  const matchedById = connectionId ? connections.find((connection) => connection.id === connectionId) : undefined;
  const sameChannelConnections = channel ? connections.filter((connection) => connection.channel === channel) : [];
  const activeSameChannelConnections = sameChannelConnections.filter((connection) => connection.status === "active");
  const matched =
    matchedById ??
    (connectionId && activeSameChannelConnections.length === 1 ? activeSameChannelConnections[0] : undefined) ??
    (!connectionId ? sameChannelConnections[0] : undefined);

  if (matched) {
    return NextResponse.json(matched);
  }

  return NextResponse.json(createMissingStatus(channel ?? "unknown", connectionId));
}

export async function DELETE(request: NextRequest) {
  let payload: DisconnectRequestPayload;

  try {
    payload = (await request.json()) as DisconnectRequestPayload;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }

  const channel = typeof payload.channel === "string" ? payload.channel.trim().toLowerCase() : "";
  const connectionId = typeof payload.connectionId === "string" ? payload.connectionId.trim() : undefined;
  const deleteData = payload.deleteData === true;

  if (!SUPPORTED_CHANNELS.has(channel)) {
    return NextResponse.json({ ok: false, message: "Unsupported channel." }, { status: 400 });
  }

  const removedStatusFiles: string[] = [];
  const removedDataFiles: string[] = [];
  const errors: string[] = [];

  for (const dataDir of DATA_DIR_CANDIDATES) {
    const perChannelStatusPath = path.join(dataDir, `${channel}-connection.json`);
    const perChannelStatus = normalizeRuntimeStatus(await readJsonFile(perChannelStatusPath), {
      channel,
      id: `${channel}:default`
    });

    if (shouldRemoveConnection(perChannelStatus, channel, connectionId)) {
      try {
        await rm(perChannelStatusPath, { force: true });
        removedStatusFiles.push(perChannelStatusPath);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Failed to remove ${perChannelStatusPath}`);
      }
    }

    const connectorStatusPath = path.join(dataDir, "connector-status.json");
    const connectorStatus = await readJsonFile(connectorStatusPath);
    const nextConnectorStatus = removeFromConnectorStatusPayload(connectorStatus, channel, connectionId);

    if (nextConnectorStatus.changed) {
      try {
        await writeFile(connectorStatusPath, `${JSON.stringify(nextConnectorStatus.value, null, 2)}\n`, "utf8");
        removedStatusFiles.push(connectorStatusPath);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Failed to update ${connectorStatusPath}`);
      }
    }

    if (deleteData) {
      for (const fileName of SYNC_DATA_FILES_BY_CHANNEL[channel] ?? []) {
        const dataFilePath = path.join(dataDir, fileName);

        try {
          await rm(dataFilePath, { force: true });
          removedDataFiles.push(dataFilePath);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `Failed to remove ${dataFilePath}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        errors,
        removedDataFiles,
        removedStatusFiles
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    deleteData,
    ok: true,
    removedDataFiles,
    removedStatusFiles
  });
}
