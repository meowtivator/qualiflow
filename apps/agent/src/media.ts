// 채널에서 다운로드한 미디어 바이트를 로컬 캐시에 저장하고, push 때 서버(/api/agents/media-upload)로
// 올려 '영구 공개 URL'을 받아 attachments를 채운다.
//   - fetch 단계: cacheMedia() — 바이트를 QUALIFLOW_HOME/.media/<key> 에 저장, attachment를
//                 source:"pending"(+ externalRef=key)로 만든다. 25MB 초과/빈 데이터는 "skipped".
//   - push 단계: uploadPendingAttachments() — pending 첨부의 캐시 파일을 업로드해 source:"stored"+url 로 갱신.
// ★key는 호출부가 전역 유니크하게 만든다(예: `${channel}_${messageId}_${i}`) → 평평한 캐시 경로라 label 불필요.
// ★서버 URL 없는 채널(telegram/whatsapp) + 만료 URL 채널(instagram/alibaba)을 한 경로로 영구화한다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { MessageAttachment, MessageAttachmentKind } from "@qualiflow/core";

import { REPO_ROOT } from "./accounts";
import { authedFetch } from "./api-client";

const HOME = process.env.QUALIFLOW_HOME;
// 세션·데이터와 같은 규칙(accounts.ts): 배포본은 ~/.qualiflow, 개발은 레포.
const MEDIA_ROOT = HOME ? resolve(HOME, ".media") : resolve(REPO_ROOT, "apps/web/.data/.media");
const MAX_BYTES = 25 * 1024 * 1024; // 업로드 엔드포인트/버킷과 동일(25MB)

function kindFromMime(mime: string): MessageAttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

// 파일/스토리지 키 안전화(영숫자/_/-/. 만). 길이 제한.
function safeKey(key: string): string {
  return key.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 100) || "media";
}

function cachePath(key: string): string {
  return resolve(MEDIA_ROOT, safeKey(key));
}

// 바이트를 로컬 캐시에 저장 → pending 첨부 반환. 초과/빈 데이터면 skipped(미디어 존재 사실은 보존).
export async function cacheMedia(opts: {
  key: string; // 전역 유니크(예: `${channel}_${messageId}_${i}`)
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
}): Promise<MessageAttachment> {
  const { key, bytes, mimeType, fileName, caption } = opts;
  const base: MessageAttachment = {
    id: safeKey(key),
    kind: kindFromMime(mimeType),
    fileName: fileName ?? safeKey(key),
    mimeType,
    source: "pending",
    caption,
    externalRef: safeKey(key)
  };
  if (!bytes?.length || bytes.length > MAX_BYTES) {
    return { ...base, source: "skipped" };
  }
  const abs = cachePath(key);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  return base;
}

// pending 첨부들을 서버로 업로드 → stored URL로 갱신(멱등). 실패는 error, pending이 아니면 그대로 통과.
export async function uploadPendingAttachments(
  channel: string,
  attachments: MessageAttachment[]
): Promise<MessageAttachment[]> {
  const out: MessageAttachment[] = [];
  for (const att of attachments) {
    if (att.source !== "pending" || !att.externalRef) {
      out.push(att);
      continue;
    }
    try {
      const bytes = await readFile(cachePath(att.externalRef));
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: att.mimeType }), att.fileName ?? att.id);
      form.append("channel", channel);
      form.append("key", att.externalRef);
      const response = await authedFetch("/api/agents/media-upload", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string };
      if (response.ok && data.ok && data.url) {
        out.push({
          id: att.id,
          kind: att.kind,
          fileName: att.fileName,
          mimeType: att.mimeType,
          url: data.url,
          source: "stored",
          caption: att.caption
        });
      } else {
        out.push({ ...att, source: "error" });
      }
    } catch {
      out.push({ ...att, source: "error" });
    }
  }
  return out;
}

// 만료성 CDN URL(instagram/alibaba)을 바이트로 받아온다. 실패/과대면 null.
export async function fetchUrlBytes(url: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    return { bytes: buf, mimeType };
  } catch {
    return null;
  }
}
