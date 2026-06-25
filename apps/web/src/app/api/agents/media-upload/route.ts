// POST /api/agents/media-upload — 에이전트가 채널에서 다운로드한 미디어 바이트를 올린다(토큰 인증).
// 흐름: Bearer 토큰 → HMAC 해시 → resolve_agent_by_token 으로 workspace_id 도출(클라이언트가 못 정함) →
//       service-role로 공개 버킷 message-media 에 업로드 → 공개 URL 반환.
// ★보안: 저장 경로는 토큰에서 도출한 <workspaceId>/<channel>/<key> 로 서버가 강제 → 남의 워크스페이스로 못 씀.
//         크기 25MB·MIME 화이트리스트는 여기 + 버킷(0013) 양쪽에서 막는다. service-role 키는 서버 전용.
// 본문: multipart/form-data { file(Blob), channel, key(멱등키 예: <externalMessageId>-<i>), mimeType? }

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { agentTokenErrorResponse, bearerToken } from "@/lib/agents/agent-request";
import { hmacHash, isPairingConfigured } from "@/lib/agents/pairing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "message-media";
const MAX_BYTES = 25 * 1024 * 1024; // 25MB (버킷 file_size_limit 과 일치)
// 확장자 매핑(공개 URL 보기 좋게). 화이트리스트 = 0013 버킷 allowed_mime_types 와 일치.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};

function sanitizeSegment(value: string, max: number): string {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, max);
}

export async function POST(request: Request) {
  if (!isPairingConfigured()) {
    return NextResponse.json({ ok: false, message: "서버에 페어링 시크릿이 설정되지 않았습니다." }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, message: "에이전트 토큰이 필요합니다." }, { status: 401 });
  }

  // 1) 토큰 → 워크스페이스 도출(스푸핑 차단 + 경로 스코프).
  const supabase = await createClient();
  const { data: resolved, error: resolveError } = await supabase.rpc("resolve_agent_by_token", {
    p_token_hash: hmacHash(token)
  });
  if (resolveError) {
    return agentTokenErrorResponse(resolveError, "토큰 검증에 실패했습니다.");
  }
  const agent = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!agent?.workspace_id) {
    return NextResponse.json({ ok: false, message: "유효하지 않은 에이전트 토큰입니다." }, { status: 401 });
  }

  // 2) multipart 파싱.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "multipart 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  const file = form.get("file");
  const channel = String(form.get("channel") ?? "").trim();
  const key = String(form.get("key") ?? "").trim();
  if (!(file instanceof Blob) || !channel || !key) {
    return NextResponse.json({ ok: false, message: "file, channel, key가 필요합니다." }, { status: 400 });
  }

  const mime = file.type || String(form.get("mimeType") ?? "");
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    return NextResponse.json({ ok: false, message: `허용되지 않는 형식: ${mime || "unknown"}` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: "파일이 25MB를 초과합니다." }, { status: 413 });
  }

  // 3) service-role로 업로드. 경로는 서버가 강제(토큰 workspace + sanitized channel/key). upsert=멱등.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, message: "서버 저장소 설정이 없습니다." }, { status: 503 });
  }
  const safeChannel = sanitizeSegment(channel, 24) || "unknown";
  const safeKey = sanitizeSegment(key, 80) || randomUUID();
  const path = `${agent.workspace_id}/${safeChannel}/${safeKey}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: true });
  if (uploadError) {
    return NextResponse.json({ ok: false, message: `업로드 실패: ${uploadError.message}` }, { status: 500 });
  }

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: publicData.publicUrl, path });
}
