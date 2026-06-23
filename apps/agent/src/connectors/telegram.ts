// Telegram 커넥터 — gramjs(MTProto). ★봇 API가 아니라 개인 계정 클라이언트로 로그인해
// 내 인박스(DM·그룹)를 읽는다. api_id/api_hash + 전화 코드 로그인.
//   - 세션 문자열은 .auth/telegram--<label>/session.txt 에 로컬 저장(★서버로 안 감).
//   - 결과는 ChatRawConversation[]로 정규화 가능한 형태로 outputFile 에 쓴다(기존 chat 어댑터가 읽음).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const TELEGRAM_HISTORY_LIMIT = Number(process.env.QUALIFLOW_TG_HISTORY) || 100; // 대화당 최근 메시지 수

function getApiCreds(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (!apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH 가 없습니다. apps/web/.env.local 에 넣으세요.");
  }
  return { apiId, apiHash };
}

function sessionFile(sessionDir: string): string {
  return resolve(sessionDir, "session.txt");
}

async function loadSession(sessionDir: string): Promise<string> {
  try {
    return (await readFile(sessionFile(sessionDir), "utf8")).trim();
  } catch {
    return "";
  }
}

async function saveSession(sessionDir: string, session: string): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionFile(sessionDir), session, "utf8");
}

// 전화 코드 로그인(대화형). 세션 문자열을 sessionDir 에 저장한다.
export async function loginTelegram(sessionDir: string): Promise<void> {
  const { apiId, apiHash } = getApiCreds();
  const client = new TelegramClient(new StringSession(await loadSession(sessionDir)), apiId, apiHash, {
    connectionRetries: 5
  });

  const rl = createInterface({ input, output });
  try {
    await client.start({
      phoneNumber: async () => (await rl.question("전화번호(국가코드 포함, 예: +821012345678): ")).trim(),
      password: async () => (await rl.question("2단계 비밀번호(없으면 그냥 Enter): ")).trim(),
      phoneCode: async () => (await rl.question("받은 인증 코드: ")).trim(),
      onError: (err) => console.error("로그인 중 오류:", err instanceof Error ? err.message : err)
    });
  } finally {
    rl.close();
  }

  await saveSession(sessionDir, String(client.session.save()));
  console.log("✅ Telegram 로그인 완료 — 세션을 로컬에 저장했습니다.");
  await client.disconnect();
}

// 저장된 세션으로 연결해 인박스를 읽어 ChatRawConversation[]로 정규화한다.
export async function fetchTelegram(sessionDir: string): Promise<ChatRawConversation[]> {
  const { apiId, apiHash } = getApiCreds();
  const session = await loadSession(sessionDir);
  if (!session) {
    throw new Error("Telegram 세션이 없습니다. 먼저 'add telegram <라벨>'로 로그인하세요.");
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.connect();
  try {
    const dialogs = await client.getDialogs({ limit: 50 });
    const conversations: ChatRawConversation[] = [];

    for (const dialog of dialogs) {
      // 방송 채널(대량/노이즈)은 제외 — DM·그룹 위주.
      if (dialog.isChannel && !dialog.isGroup) {
        continue;
      }
      const entity = dialog.entity;
      if (!entity) {
        continue;
      }

      // 대화당 최근 메시지 깊이(전체 이력 페이지네이션은 추후 — 지금은 넉넉한 최근 창).
      const rawMessages = await client.getMessages(entity, { limit: TELEGRAM_HISTORY_LIMIT });
      const messages: ChatRawMessage[] = [];
      for (const message of rawMessages) {
        const text = message.message ?? "";
        if (!text) {
          continue; // 텍스트 없는(미디어 등) 메시지는 건너뜀
        }
        messages.push({
          id: String(message.id),
          text,
          sentAt: new Date(message.date * 1000).toISOString(),
          direction: message.out ? "outbound" : "inbound"
        });
      }
      if (!messages.length) {
        continue;
      }
      messages.reverse(); // getMessages는 최신순 → 오래된 순으로 뒤집는다.

      conversations.push({
        threadId: String(dialog.id),
        contact: { id: String(dialog.id), name: dialog.title ?? dialog.name ?? String(dialog.id) },
        messages
      });
    }

    return conversations;
  } finally {
    await client.disconnect();
  }
}
