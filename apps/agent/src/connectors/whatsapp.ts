// WhatsApp 커넥터 — mautrix-whatsapp(whatsmeow)와 같은 "브라우저 없이 WhatsApp Web 멀티디바이스
// 프로토콜에 직접 붙는" 방식의 Node 등가물 Baileys를 쓴다.
//   - 첫 실행: QR을 터미널에 띄움 → 폰(설정→연결된 기기→기기 연결)으로 스캔.
//   - 세션은 .auth/whatsapp-baileys 에 로컬 저장(★서버로 안 감). 이후엔 QR 없이 재연결.
//   - 초기 히스토리 동기화(messaging-history.set)로 받은 대화/메시지를 ChatRawConversation[]로
//     정규화 가능한 형태로 맞춰 .data/whatsapp-conversations.json 에 쓴다(기존 chat 어댑터가 읽음).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WAMessage,
  type WAMessageContent
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const here = dirname(fileURLToPath(import.meta.url));
// src/connectors/ → 네 단계 위가 레포 루트
const REPO_ROOT = resolve(here, "../../../..");
const DEFAULT_AUTH_DIR = resolve(REPO_ROOT, ".auth/whatsapp-baileys");
const DEFAULT_OUTPUT_FILE = resolve(REPO_ROOT, "apps/web/.data/whatsapp-conversations.json");

// 연결 후 초기 히스토리 동기화를 기다리는 시간(기본 25초). 환경변수로 조정.
const SYNC_WAIT_MS = Number(process.env.QUALIFLOW_WA_SYNC_MS) || 25_000;

function extractText(content: WAMessageContent | null | undefined): string {
  if (!content) {
    return "";
  }
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    ""
  );
}

function displayName(jid: string, contacts: Map<string, Contact>, chats: Map<string, Chat>): string {
  const contact = contacts.get(jid);
  return contact?.name ?? contact?.notify ?? contact?.verifiedName ?? chats.get(jid)?.name ?? jid.split("@")[0];
}

export async function fetchWhatsApp(
  options: { authDir?: string; outputFile?: string } = {}
): Promise<ChatRawConversation[]> {
  const authDir = options.authDir ?? DEFAULT_AUTH_DIR;
  const outputFile = options.outputFile ?? DEFAULT_OUTPUT_FILE;
  await mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({ auth: state });
  sock.ev.on("creds.update", saveCreds);

  const chats = new Map<string, Chat>();
  const contacts = new Map<string, Contact>();
  const messagesByJid = new Map<string, WAMessage[]>();

  function collectMessage(message: WAMessage): void {
    const jid = message.key?.remoteJid;
    if (!jid) {
      return;
    }
    const list = messagesByJid.get(jid) ?? [];
    list.push(message);
    messagesByJid.set(jid, list);
  }

  return new Promise<ChatRawConversation[]>((resolveFetch, rejectFetch) => {
    let finished = false;

    async function finish(): Promise<void> {
      if (finished) {
        return;
      }
      finished = true;

      const conversations: ChatRawConversation[] = [];
      for (const [jid, list] of messagesByJid) {
        if (jid.endsWith("@broadcast")) {
          continue; // 상태(스토리) 등은 제외
        }
        const messages: ChatRawMessage[] = list
          .map((message) => ({
            id: message.key?.id ?? `${jid}-${String(message.messageTimestamp ?? "")}`,
            text: extractText(message.message),
            sentAt: new Date(Number(message.messageTimestamp ?? 0) * 1000).toISOString(),
            direction: message.key?.fromMe ? ("outbound" as const) : ("inbound" as const),
            authorName: message.pushName ?? undefined
          }))
          .filter((message) => message.text)
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

        if (!messages.length) {
          continue;
        }
        conversations.push({
          threadId: jid,
          contact: { id: jid, name: displayName(jid, contacts, chats) },
          messages
        });
      }

      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");

      try {
        sock.end(undefined);
      } catch {
        // 소켓 종료 실패는 무시
      }
      resolveFetch(conversations);
    }

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n📱 WhatsApp 폰 앱 → 설정 → 연결된 기기 → 기기 연결 → 아래 QR을 스캔하세요:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ WhatsApp 연결됨 — 최근 대화 동기화 대기 중...");
        setTimeout(() => void finish(), SYNC_WAIT_MS);
      }

      if (connection === "close") {
        const statusCode =
          typeof lastDisconnect?.error === "object" && lastDisconnect?.error !== null
            ? (lastDisconnect.error as { output?: { statusCode?: number } }).output?.statusCode
            : undefined;
        if (statusCode === DisconnectReason.loggedOut) {
          rejectFetch(new Error("WhatsApp 로그아웃됨 — .auth/whatsapp-baileys 를 지우고 다시 QR 스캔하세요."));
        }
        // 그 외 close는 일회성 fetch라 재연결하지 않는다(이미 모았으면 finish가 마무리).
      }
    });

    sock.ev.on("messaging-history.set", ({ chats: chatList, contacts: contactList, messages }) => {
      for (const chat of chatList) {
        if (chat.id) {
          chats.set(chat.id, chat);
        }
      }
      for (const contact of contactList) {
        if (contact.id) {
          contacts.set(contact.id, contact);
        }
      }
      for (const message of messages) {
        collectMessage(message);
      }
    });

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        collectMessage(message);
      }
    });

    // 안전 타임아웃: QR을 안 찍거나 동기화가 안 끝나도 멈춘다.
    setTimeout(() => void finish(), SYNC_WAIT_MS + 5 * 60_000);
  });
}
