// WhatsApp 커넥터 — mautrix-whatsapp(whatsmeow)와 같은 "브라우저 없이 WhatsApp Web 멀티디바이스
// 프로토콜에 직접 붙는" 방식의 Node 등가물 Baileys를 쓴다.
//   - 첫 실행: QR을 터미널에 띄움 → 폰(설정→연결된 기기→기기 연결)으로 스캔.
//   - 세션은 .auth/whatsapp-baileys[--label] 에 로컬 저장(★서버로 안 감). 이후엔 QR 없이 재연결.
//   - ★페어링 직후 WhatsApp은 stream error 515("restart required")로 끊는다 = 정상. 이때 재연결해야
//     비로소 로그인 완료 + 히스토리 동기화가 시작된다. (loggedOut 외의 close는 재연결한다.)
//   - syncFullHistory + 히스토리가 잠잠해질 때까지(debounce) 기다렸다가 ChatRawConversation[]로
//     정규화해 outputFile 에 쓴다.

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parsePhoneNumberFromString } from "libphonenumber-js";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import type { MessageAttachment } from "@qualiflow/core";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  jidNormalizedUser,
  useMultiFileAuthState,
  type Chat,
  type Contact,
  type WAMessage,
  type WAMessageContent
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

import { cacheMedia } from "../media";

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

// 한 메시지에 사진/영상/문서/오디오가 있으면 바이트를 받아 pending 첨부 1개로 만든다.
// 미디어 없거나 다운로드 실패면 undefined. ★throw하지 않아 한 건 실패가 전체 동기화를 막지 않는다.
//   messageId: cacheMedia key를 전역 유니크하게 만들기 위해 호출부가 정한 메시지 id를 그대로 받는다
//   (key.id가 null일 수 있어 텍스트 경로와 같은 fallback 값을 쓴다).
async function buildWhatsAppAttachment(
  message: WAMessage,
  messageId: string
): Promise<MessageAttachment | undefined> {
  const content = message.message;
  // 우리가 영구화하는 4종(이미지/영상/문서/오디오) 중 실린 노드를 고른다. 그 외(텍스트/통화/시스템)는 미디어 아님.
  const media =
    content?.imageMessage ??
    content?.videoMessage ??
    content?.documentMessage ??
    content?.audioMessage;
  if (!media) {
    return undefined;
  }
  try {
    // downloadMediaMessage: WAMessage를 받아 암호화된 미디어를 풀어 Buffer로 준다("buffer" 지정).
    const bytes = await downloadMediaMessage(message, "buffer", {});
    const mimeType = media.mimetype ?? "application/octet-stream"; // 노드가 준 MIME(예: image/jpeg)
    // 캡션은 이미지/영상/문서에만 있다(오디오엔 없음). 문서만 원본 파일명을 갖는다.
    const caption = content?.imageMessage?.caption ?? content?.videoMessage?.caption ?? content?.documentMessage?.caption ?? undefined;
    return await cacheMedia({
      key: `whatsapp_${messageId}_0`,
      bytes,
      mimeType,
      fileName: content?.documentMessage?.fileName ?? undefined,
      caption
    });
  } catch {
    return undefined; // 다운로드 실패 — 미디어는 건너뛰되 나머지는 계속.
  }
}

// ISO 국가코드(예: "KR") → 국기 이모지(🇰🇷). 알파벳 2글자를 regional-indicator 코드포인트로 변환.
function countryFlag(iso2: string): string {
  if (iso2.length !== 2) return "";
  return iso2
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

// @lid jid 를 전화번호로 풀고 국제표기+국기로 포맷한다(예: "+82 10 5874 5767 🇰🇷").
// Baileys 가 페어링 때 .auth/<세션>/lid-mapping-<lid>_reverse.json 에 lid→전화번호를 로컬 저장해 둔 걸 읽는다.
// (이 파일들은 세션 디렉터리 안에만 있고 서버로 가지 않는다 — 보안 경계 유지.)
function resolveLidPhone(jid: string, authDir: string): string | undefined {
  const lidNum = jid.split("@")[0];
  let digits: string;
  try {
    const raw = readFileSync(resolve(authDir, `lid-mapping-${lidNum}_reverse.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown; // 내용은 "821058745767" 같은 JSON 문자열(숫자만).
    digits = typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    return undefined; // 매핑 파일 없음 = 풀 수 없음.
  }
  if (!/^\d{6,15}$/.test(digits)) return undefined;
  const phone = parsePhoneNumberFromString(`+${digits}`);
  if (!phone) return `+${digits}`; // 파싱 실패해도 최소한 +숫자 로는 보여준다.
  const flag = phone.country ? countryFlag(phone.country) : "";
  return flag ? `${phone.formatInternational()} ${flag}` : phone.formatInternational();
}

// 이름 우선순위: 저장된 연락처(이름/notify/인증명) → 채팅방 이름 → 상대가 설정한 pushName.
// ★진짜 이름이 하나도 없을 때: @lid(프라이버시 식별자) 스레드면 의미 없는 lid 숫자 대신 전화번호로 보여준다.
//   (@lid 는 연락처 맵 키와 어긋나 이름 조회가 빗나가므로 실데이터에선 거의 전부 이 분기로 떨어진다.)
function displayName(
  jid: string,
  contacts: Map<string, Contact>,
  chats: Map<string, Chat>,
  authDir: string,
  pushName?: string
): string {
  const contact = contacts.get(jid);
  const named = contact?.name ?? contact?.notify ?? contact?.verifiedName ?? chats.get(jid)?.name ?? pushName;
  if (named) return named;
  if (jid.endsWith("@lid")) {
    const phone = resolveLidPhone(jid, authDir);
    if (phone) return phone;
  }
  return jid.split("@")[0];
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
  options: { authDir: string; outputFile: string }
): Promise<ChatRawConversation[]> {
  const { authDir, outputFile } = options;
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
        // 각 메시지를 텍스트로 변환하면서 미디어가 있으면 다운로드해 첨부를 붙인다(다운로드는 비동기 → Promise.all).
        const built = await Promise.all(
          list.map(async (message): Promise<ChatRawMessage | undefined> => {
            const id = message.key?.id ?? `${jid}-${String(message.messageTimestamp ?? "")}`;
            const text = extractText(message.message); // 미디어 캡션도 여기에 포함된다.
            const attachment = await buildWhatsAppAttachment(message, id);
            if (!text && !attachment) {
              return undefined; // 텍스트도 첨부도 없으면(통화/시스템/다운로드 실패) 버린다 — 기존 텍스트 필터와 동일한 효과.
            }
            return {
              id,
              text,
              sentAt: new Date(Number(message.messageTimestamp ?? 0) * 1000).toISOString(),
              direction: message.key?.fromMe ? ("outbound" as const) : ("inbound" as const),
              authorName: message.pushName ?? undefined,
              ...(attachment ? { attachments: [attachment] } : {})
            };
          })
        );
        const messages: ChatRawMessage[] = built
          .filter((message): message is ChatRawMessage => message !== undefined)
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

        if (!messages.length) {
          continue;
        }
        // 상대(inbound)가 보낸 메시지의 pushName을 이름 후보로 뽑는다(연락처 맵이 비었을 때 대비).
        const pushName = list.find((message) => !message.key?.fromMe && message.pushName)?.pushName ?? undefined;
        conversations.push({
          threadId: jid,
          contact: { id: jid, name: displayName(jid, contacts, chats, authDir, pushName) },
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
        // 메타데이터만 든 빈 청크(대화 0·메시지 0)는 로그하지 않는다(노이즈).
        if (chatList.length || contactList.length || messages.length) {
          console.log(
            `📥 히스토리 동기화: 대화 ${chatList.length} · 연락처 ${contactList.length} · 메시지 ${messages.length} · 마지막=${isLatest ?? "?"}`
          );
        }
        for (const chat of chatList) {
          if (chat.id) {
            chats.set(chat.id, chat);
          }
        }
        for (const contact of contactList) {
          if (contact.id) {
            contacts.set(contact.id, contact);
            // ★@lid(프라이버시 식별자) 스레드는 전화번호 jid 로 색인된 연락처와 키가 달라 이름 조회가
            //   빗나간다. 연락처가 lid 를 들고 있으면 그 키로도 색인해 @lid 스레드에서 이름을 찾게 한다.
            const lid = (contact as { lid?: unknown }).lid;
            if (typeof lid === "string" && lid) contacts.set(lid, contact);
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

// 메시지 발송. 저장된 세션으로 연결 → connection:open에서 한 건 보내고 소켓 종료.
//   to = "me"(내 번호, 나에게 테스트) | 불러온 대화의 threadId(=상대 jid, 예: 1234@s.whatsapp.net)
export async function sendWhatsApp(options: { authDir: string; to: string; text: string }): Promise<void> {
  const authDir = options.authDir;
  muteLibsignalNoise();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  await new Promise<void>((resolveSend, rejectSend) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const done = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle); // ★이걸 안 지우면 발송 후에도 타이머가 살아 터미널을 계속 점유
      }
      restoreConsole();
      if (error) {
        rejectSend(error);
      } else {
        resolveSend();
      }
    };

    const sock = makeWASocket({ auth: state, ...(WA_DEBUG ? {} : { logger: silentLogger }) });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        const myId = sock.user?.id;
        const jid = options.to === "me" ? (myId ? jidNormalizedUser(myId) : "") : options.to;
        if (!jid) {
          sock.end(undefined);
          done(new Error("WhatsApp 발송 대상(jid)을 확인하지 못했습니다."));
          return;
        }
        sock
          .sendMessage(jid, { text: options.text })
          .then(() => {
            console.log(`📤 WhatsApp 발송 완료 → ${jid}`);
            sock.end(undefined);
            done();
          })
          .catch((error: unknown) => {
            sock.end(undefined);
            done(error instanceof Error ? error : new Error(String(error)));
          });
        return;
      }

      if (connection === "close" && !settled) {
        const statusCode =
          typeof lastDisconnect?.error === "object" && lastDisconnect?.error !== null
            ? (lastDisconnect.error as { output?: { statusCode?: number } }).output?.statusCode
            : undefined;
        done(
          statusCode === DisconnectReason.loggedOut
            ? new Error("WhatsApp 로그아웃됨 — 다시 'add whatsapp <라벨>'로 QR 스캔하세요.")
            : new Error("WhatsApp 연결이 끊겼습니다(다시 시도하세요).")
        );
      }
    });

    timeoutHandle = setTimeout(() => done(new Error("WhatsApp 발송 타임아웃(연결 실패).")), 60_000);
  });
}
