// WhatsApp 커넥터 — mautrix-whatsapp(whatsmeow)와 같은 "브라우저 없이 WhatsApp Web 멀티디바이스
// 프로토콜에 직접 붙는" 방식의 Node 등가물 Baileys를 쓴다.
//   - 첫 실행: QR을 터미널에 띄움 → 폰(설정→연결된 기기→기기 연결)으로 스캔.
//   - 세션은 .auth/whatsapp-baileys[--label] 에 로컬 저장(★서버로 안 감). 이후엔 QR 없이 재연결.
//   - ★페어링 직후 WhatsApp은 stream error 515("restart required")로 끊는다 = 정상. 이때 재연결해야
//     비로소 로그인 완료 + 히스토리 동기화가 시작된다. (loggedOut 외의 close는 재연결한다.)
//   - syncFullHistory + 히스토리가 잠잠해질 때까지(debounce) 기다렸다가 ChatRawConversation[]로
//     정규화해 outputFile 에 쓴다.

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

// 히스토리가 이 시간(ms)동안 더 안 오면 동기화 끝으로 보고 마무리한다(연결/이벤트마다 리셋).
// 첫 페어링 직후 히스토리가 늦게 오기도 해서 넉넉히 둔다.
const SYNC_QUIET_MS = Number(process.env.QUALIFLOW_WA_SYNC_MS) || 20_000;
// 전체 상한(여기까진 무조건 마무리).
const HARD_TIMEOUT_MS = 3 * 60_000;
const MAX_RECONNECTS = 6;

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
    let reconnects = 0;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;

    async function finish(): Promise<void> {
      if (finished) {
        return;
      }
      finished = true;
      if (quietTimer) {
        clearTimeout(quietTimer);
      }

      const conversations: ChatRawConversation[] = [];
      for (const [jid, list] of messagesByJid) {
        if (jid.endsWith("@broadcast")) {
          continue; // 상태(스토리) 등 제외
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
      console.log(`📦 WhatsApp 대화 ${conversations.length}개 동기화 완료.`);
      resolveFetch(conversations);
    }

    // 히스토리가 잠잠해지면(SYNC_QUIET_MS 동안 새 이벤트 없음) 마무리. 연결/이벤트마다 리셋.
    function scheduleFinish(): void {
      if (finished) {
        return;
      }
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      quietTimer = setTimeout(() => void finish(), SYNC_QUIET_MS);
    }

    function connect(): void {
      // syncFullHistory: 새로 연결한 기기에 폰이 더 많은 과거 대화를 밀어주도록 요청.
      const sock = makeWASocket({ auth: state, syncFullHistory: true });
      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log("\n📱 WhatsApp 폰 앱 → 설정 → 연결된 기기 → 기기 연결 → 아래 QR을 스캔하세요:\n");
          qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
          console.log("✅ WhatsApp 연결됨 — 대화 동기화 대기 중...");
          scheduleFinish();
        }

        if (connection === "close") {
          const statusCode =
            typeof lastDisconnect?.error === "object" && lastDisconnect?.error !== null
              ? (lastDisconnect.error as { output?: { statusCode?: number } }).output?.statusCode
              : undefined;

          if (statusCode === DisconnectReason.loggedOut) {
            rejectFetch(new Error("WhatsApp 로그아웃됨 — 세션 폴더를 지우고 다시 QR 스캔하세요."));
            return;
          }
          // ★515(restart required) 등 loggedOut이 아닌 close는 재연결한다(페어링 직후 정상 흐름).
          if (!finished && reconnects < MAX_RECONNECTS) {
            reconnects += 1;
            console.log(`🔄 재연결 (${reconnects}/${MAX_RECONNECTS})...`);
            connect();
          }
        }
      });

      sock.ev.on("messaging-history.set", ({ chats: chatList, contacts: contactList, messages, isLatest }) => {
        console.log(
          `📥 히스토리 동기화: 대화 ${chatList.length} · 연락처 ${contactList.length} · 메시지 ${messages.length} · 마지막=${isLatest ?? "?"}`
        );
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
        scheduleFinish(); // 히스토리가 오는 동안 계속 미룬다(다 올 때까지 대기).
      });

      sock.ev.on("messages.upsert", ({ messages }) => {
        if (messages.length) {
          console.log(`📨 새 메시지 ${messages.length}건`);
        }
        for (const message of messages) {
          collectMessage(message);
        }
      });
    }

    connect();
    setTimeout(() => void finish(), HARD_TIMEOUT_MS); // 안전 상한
  });
}
