// WhatsApp 커넥터 — mautrix-whatsapp(whatsmeow)와 같은 "브라우저 없이 WhatsApp Web 멀티디바이스
// 프로토콜에 직접 붙는" 방식의 Node 등가물 Baileys를 쓴다.
//   - 첫 실행: QR을 터미널에 띄움 → 폰(설정→연결된 기기→기기 연결)으로 스캔.
//   - 세션은 .auth/whatsapp-baileys[--label] 에 로컬 저장(★서버로 안 감). 이후엔 QR 없이 재연결.
//   - ★페어링 직후 WhatsApp은 stream error 515("restart required")로 끊는다 = 정상. 이때 재연결해야
//     비로소 로그인 완료 + 히스토리 동기화가 시작된다. (loggedOut 외의 close는 재연결한다.)
//   - syncFullHistory + 히스토리가 잠잠해질 때까지(debounce) 기다렸다가 ChatRawConversation[]로
//     정규화해 outputFile 에 쓴다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

// QUALIFLOW_WA_DEBUG=1 이면 Baileys/ libsignal 내부 로그를 그대로 본다(문제 진단용).
const WA_DEBUG = process.env.QUALIFLOW_WA_DEBUG === "1";

// Baileys 기본 로거는 info 레벨이라 내부 동작을 JSON으로 폭포처럼 찍는다. 조용한 로거를 주입해
// 우리 로그(📥/📨/📦)만 남긴다. (ILogger는 패키지 루트에서 export 안 되어 구조가 같은 스텁을 쓴다.)
type SilentLogger = {
  level: string;
  child: () => SilentLogger;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};
const noop = (): void => undefined;
const silentLogger: SilentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
};

// libsignal(세션 협상)은 로거가 아니라 console.info/warn 으로 직접 찍는다(예: "Closing session:" +
// SessionEntry 통째 덤프). 그 세션-처리 노이즈만 골라 가린다 — 우리 로그(이모지)는 통과.
const LIBSIGNAL_NOISE = /^(Closing|Opening|Migrating|Removing|Session already)\b/;
const originalConsole = { info: console.info, warn: console.warn };
function isLibsignalNoise(args: unknown[]): boolean {
  return typeof args[0] === "string" && LIBSIGNAL_NOISE.test(args[0]) && /session/i.test(args[0]);
}
function muteLibsignalNoise(): void {
  if (WA_DEBUG) {
    return;
  }
  console.info = (...args: unknown[]) => {
    if (!isLibsignalNoise(args)) {
      originalConsole.info(...(args as []));
    }
  };
  console.warn = (...args: unknown[]) => {
    if (!isLibsignalNoise(args)) {
      originalConsole.warn(...(args as []));
    }
  };
}
function restoreConsole(): void {
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
}

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

// 이미 저장된 대화를 읽는다(왓츠앱은 페어링 직후 1회만 히스토리를 주므로, 재연결 fetch가 0개일 때
// 기존 데이터를 빈 결과로 덮어쓰지 않으려고 확인용으로 쓴다).
async function readExistingConversations(file: string): Promise<ChatRawConversation[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatRawConversation[]) : [];
  } catch {
    return [];
  }
}

export async function fetchWhatsApp(
  options: { authDir?: string; outputFile?: string } = {}
): Promise<ChatRawConversation[]> {
  const authDir = options.authDir ?? DEFAULT_AUTH_DIR;
  const outputFile = options.outputFile ?? DEFAULT_OUTPUT_FILE;
  await mkdir(authDir, { recursive: true });
  muteLibsignalNoise(); // libsignal 콘솔 노이즈 가리기(디버그 모드 아니면)
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
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let currentSock: ReturnType<typeof makeWASocket> | undefined;

    async function finish(): Promise<void> {
      if (finished) {
        return;
      }
      finished = true;
      // 남은 타이머/소켓을 정리해야 Node 프로세스가 빠져나간다(안 그러면 터미널을 계속 점유).
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      if (hardTimer) {
        clearTimeout(hardTimer);
      }
      currentSock?.end(undefined); // WebSocket/keepalive 종료 (finished=true라 close 이벤트가 재연결 안 함)

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

      // 재연결 fetch는 히스토리를 다시 안 줘서 0개가 나온다 — 그때 기존 데이터를 덮어쓰지 않는다.
      if (conversations.length === 0) {
        const existing = await readExistingConversations(outputFile);
        if (existing.length > 0) {
          restoreConsole();
          console.log(
            `📦 새 히스토리 없음 — 기존 대화 ${existing.length}개 유지(왓츠앱은 페어링 직후 1회만 히스토리 동기화).`
          );
          resolveFetch(existing);
          return;
        }
      }

      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, `${JSON.stringify(conversations, null, 2)}\n`, "utf8");
      restoreConsole();
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
      const sock = makeWASocket({
        auth: state,
        syncFullHistory: true,
        ...(WA_DEBUG ? {} : { logger: silentLogger })
      });
      currentSock = sock; // finish()에서 닫을 수 있게 최신 소켓을 기억
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
            restoreConsole();
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
    hardTimer = setTimeout(() => void finish(), HARD_TIMEOUT_MS); // 안전 상한
  });
}
