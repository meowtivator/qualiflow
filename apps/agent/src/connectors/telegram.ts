// Telegram 커넥터 — gramjs(MTProto). ★봇 API가 아니라 개인 계정 클라이언트로 로그인해
// 내 인박스(DM·그룹)를 읽는다. api_id/api_hash + 전화 코드 로그인.
//   - 세션 문자열은 .auth/telegram--<label>/session.txt 에 로컬 저장(★서버로 안 감).
//   - 결과는 ChatRawConversation[]로 정규화 가능한 형태로 outputFile 에 쓴다(기존 chat 어댑터가 읽음).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import type { ChatRawConversation, ChatRawMessage } from "@qualiflow/adapter-chat";
import type { MessageAttachment } from "@qualiflow/core";
import { Api, TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";

import { cacheMedia } from "../media";

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

// 클라이언트 생성 + gramjs 로그 끄기(INFO/WARN + 업데이트 루프 TIMEOUT 노이즈 제거).
function newClient(session: string, apiId: number, apiHash: string): TelegramClient {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  client.setLogLevel(LogLevel.NONE);
  return client;
}

// 로그인에 필요한 값(전화번호/코드/2FA비번)을 어디서 얻을지 주입하는 콜백들.
// CLI는 readline(터미널)으로, 웹 마법사는 HTTP로 받은 값을 Promise로 넘긴다.
export type TelegramAuthPrompts = {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
  // 반환값이 truthy면 gramjs 로그인 루프(while(1))가 멈추고 loginTelegram 이 reject 된다(auth.js).
  // 코드 오류처럼 재시도 가능한 실패는 falsy 를 돌려 루프를 유지, 회복 불가(2FA 등)는 truthy 로 끊는다.
  onError?: (err: Error) => boolean | void;
};

// 전화 코드 로그인. prompts를 주면 그 값으로(웹), 안 주면 readline(터미널). 세션을 sessionDir 에 저장한다.
export async function loginTelegram(sessionDir: string, prompts?: TelegramAuthPrompts): Promise<void> {
  const { apiId, apiHash } = getApiCreds();
  const client = newClient(await loadSession(sessionDir), apiId, apiHash);

  if (prompts) {
    // 웹 흐름: 주입된 콜백으로 로그인(전화/코드/2FA는 마법사가 HTTP로 공급).
    await client.start({
      phoneNumber: prompts.phoneNumber,
      phoneCode: prompts.phoneCode,
      password: prompts.password,
      // async 래퍼: gramjs 는 onError 반환을 await 해 truthy면 로그인 루프를 멈춘다(Promise<boolean> 기대).
      //   Boolean(...) 로 void/undefined 를 false 로 좁힌다(콜백이 값을 안 주면 = 루프 계속).
      onError: async (err) => Boolean(prompts.onError?.(err instanceof Error ? err : new Error(String(err))))
    });
  } else {
    // CLI 흐름: 터미널에서 물어본다(기존 동작).
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
  }

  await saveSession(sessionDir, String(client.session.save()));
  console.log("✅ Telegram 로그인 완료 — 세션을 로컬에 저장했습니다.");
  await client.destroy(); // ★disconnect()는 업데이트 루프를 안 멈춤(while !_destroyed) → destroy()로 완전 정리
}

// 한 메시지의 미디어(사진/문서 등)를 바이트로 받아 pending 첨부 1개로 만든다. 미디어 없거나
// 다운로드 실패면 undefined(텍스트 경로는 그대로). ★실패해도 throw하지 않아 한 건 때문에 전체 fetch가 멈추지 않는다.
async function buildTelegramAttachment(
  client: TelegramClient,
  message: Api.Message
): Promise<MessageAttachment | undefined> {
  if (!message.media) {
    return undefined; // 미디어 없는 순수 텍스트 메시지
  }
  try {
    // client.downloadMedia: 사진/문서 모두 처리, Buffer|string|undefined 반환 → Buffer일 때만 진행.
    const downloaded = await client.downloadMedia(message);
    if (!Buffer.isBuffer(downloaded)) {
      return undefined;
    }
    const doc = message.document; // 문서(=동영상/오디오/파일)면 여기에 mimeType과 attributes가 있다.
    // 사진은 항상 jpeg, 문서는 서버가 준 mimeType, 둘 다 아니면(스티커 등) 일반 바이너리로.
    const mimeType = message.photo
      ? "image/jpeg"
      : (doc?.mimeType ?? "application/octet-stream");
    // 파일명은 문서의 DocumentAttributeFilename 속성에서만 얻을 수 있다(없으면 cacheMedia가 key로 대체).
    const fileNameAttr = doc?.attributes.find(
      (attr): attr is Api.DocumentAttributeFilename => attr instanceof Api.DocumentAttributeFilename
    );
    return await cacheMedia({
      key: `telegram_${message.id}_0`,
      bytes: downloaded,
      mimeType,
      fileName: fileNameAttr?.fileName,
      caption: message.message || undefined
    });
  } catch {
    return undefined; // 다운로드 실패 — 미디어는 건너뛰되 나머지는 계속.
  }
}

// 저장된 세션으로 연결해 인박스를 읽어 ChatRawConversation[]로 정규화한다.
export async function fetchTelegram(sessionDir: string): Promise<ChatRawConversation[]> {
  const { apiId, apiHash } = getApiCreds();
  const session = await loadSession(sessionDir);
  if (!session) {
    throw new Error("Telegram 세션이 없습니다. 먼저 'add telegram <라벨>'로 로그인하세요.");
  }

  const client = newClient(session, apiId, apiHash);
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
        const text = message.message ?? ""; // 미디어의 캡션도 여기에 담긴다.
        const attachment = await buildTelegramAttachment(client, message);
        if (!text && !attachment) {
          continue; // 텍스트도 첨부도 없으면(예: 다운로드 실패한 미디어, 서비스 메시지) 건너뜀
        }
        messages.push({
          id: String(message.id),
          text,
          sentAt: new Date(message.date * 1000).toISOString(),
          direction: message.out ? "outbound" : "inbound",
          ...(attachment ? { attachments: [attachment] } : {})
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
    await client.destroy(); // ★disconnect()는 업데이트 루프를 안 멈춤(while !_destroyed) → destroy()로 완전 정리
  }
}

// 발송 대상 해석: "me"=Saved Messages, @사용자명=그대로, 숫자=불러온 대화 id를 dialogs에서 찾아 엔티티 확보.
async function resolveTelegramTarget(client: TelegramClient, recipient: string): Promise<unknown> {
  if (recipient === "me") {
    return "me";
  }
  if (/^@?[A-Za-z]/.test(recipient)) {
    return recipient; // 사용자명/링크는 gramjs가 직접 해석
  }
  // 숫자 id(불러온 threadId): 엔티티 해시가 세션에 있어야 보내지므로 dialogs로 캐시를 채운 뒤 찾는다.
  const dialogs = await client.getDialogs({ limit: 100 });
  const match = dialogs.find((dialog) => String(dialog.id) === recipient);
  if (!match?.entity) {
    throw new Error(`Telegram 대상 '${recipient}'을 못 찾았습니다(불러온 대화의 threadId나 @사용자명을 쓰세요).`);
  }
  return match.entity;
}

// 메시지 발송. 저장된 세션으로 연결해 한 건 보내고 끊는다.
export async function sendTelegram(sessionDir: string, recipient: string, text: string): Promise<void> {
  const { apiId, apiHash } = getApiCreds();
  const session = await loadSession(sessionDir);
  if (!session) {
    throw new Error("Telegram 세션이 없습니다. 먼저 'add telegram <라벨>'로 로그인하세요.");
  }
  const client = newClient(session, apiId, apiHash);
  await client.connect();
  try {
    const target = await resolveTelegramTarget(client, recipient);
    await client.sendMessage(target as never, { message: text });
  } finally {
    await client.destroy(); // ★disconnect()는 업데이트 루프를 안 멈춤(while !_destroyed) → destroy()로 완전 정리
  }
}
