-- 메시지 미디어(사진·영상) 영구 저장용 '공개' 버킷.
-- 에이전트가 채널에서 다운로드한 바이트를 /api/agents/media-upload(service-role)로 올리고,
-- CRM은 공개 URL(/storage/v1/object/public/message-media/<path>)로 <img>/<video>를 만료 없이 표시한다.
-- ★공개 버킷이라 객체 읽기는 인증 불필요(데모 단순화 — 추후 비공개+서명URL로 조일 수 있음).
--   업로드는 service-role(RLS 우회)만 가능 → 경로 <workspaceId>/<channel>/<key> 는 엔드포인트가 토큰에서
--   도출한 workspace로 강제하므로, 에이전트는 자기 워크스페이스 밑으로만 쓴다.
-- ★버킷 레벨 제약(file_size_limit/allowed_mime_types)으로 과대·비허용 업로드를 DB단에서도 막는다(이중 방어).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-media',
  'message-media',
  true,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
