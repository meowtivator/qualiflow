import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

type ConnectorStatus = "disconnected" | "active" | "needs_relogin" | "error";

type ConnectorStatusResponse = {
  channel: string;
  checkedAt: string;
  detail: string;
  source: "local_data" | "runtime_missing";
  status: ConnectorStatus;
};

const CONNECTOR_FILES: Record<string, string[]> = {
  alibaba: ["alibaba-conversations.json"],
  instagram: ["instagram-conversations.json"],
  telegram: ["telegram-dialogs.json", "telegram-conversations.json"],
  whatsapp: ["whatsapp-conversations.json"]
};

const DATA_DIR_CANDIDATES = [
  path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"),
  path.join(/*turbopackIgnore: true*/ process.cwd(), "apps", "web", ".data")
];

async function hasReadableData(fileName: string) {
  for (const dataDir of DATA_DIR_CANDIDATES) {
    const filePath = path.join(dataDir, fileName);

    try {
      await access(filePath);
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;

      if (Array.isArray(parsed) && parsed.length > 0) {
        return true;
      }
    } catch {
      // A missing or malformed local artifact only means this connector runtime
      // has not written a readable status/data file yet.
    }
  }

  return false;
}

async function resolveConnectorStatus(channel: string): Promise<ConnectorStatusResponse> {
  const fileNames = CONNECTOR_FILES[channel];
  const checkedAt = new Date().toISOString();

  if (!fileNames) {
    return {
      channel,
      checkedAt,
      detail: "지원하지 않는 채널입니다.",
      source: "runtime_missing",
      status: "error"
    };
  }

  for (const fileName of fileNames) {
    if (await hasReadableData(fileName)) {
      return {
        channel,
        checkedAt,
        detail: "채널 런타임에서 추출한 대화 데이터가 확인되었습니다.",
        source: "local_data",
        status: "active"
      };
    }
  }

  return {
    channel,
    checkedAt,
    detail: "아직 채널 런타임에서 연결 상태를 확인하지 못했습니다.",
    source: "runtime_missing",
    status: "needs_relogin"
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
