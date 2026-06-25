# 영구 미디어(사진·영상) 수집 설계 — Phase 2 (download → Supabase Storage)

상태: **승인됨(2026-06-25)**. 추천값 확정 — A=공개 버킷, B=웹 엔드포인트가 바이트 수신.
선행: Phase 1(PR#47) 완료 — `MessageAttachment` 계약 확장 + `0012`로 ingest가 `messages.attachments` 저장(클라우드 적용·검증).

## 목표
4채널(alibaba·telegram·whatsapp·instagram)의 사진/영상을 **우리 저장소에 재호스팅**해, CRM(crm.thedozers.com)에서 **만료 없이 영구히** 표시한다. (instagram CDN 만료, telegram/whatsapp 공개 URL 부재 문제를 한 경로로 해결.)

## 데이터 흐름
1. **에이전트 `fetch` — 미디어 바이트 다운로드** (채널별):
   - telegram(gramjs): `client.downloadMedia(message)` → Buffer. `message.media`로 종류 판별(photo/document(video/file)).
   - whatsapp(Baileys): `downloadMediaMessage(message, "buffer", {})` → Buffer. `imageMessage|videoMessage|documentMessage`.
   - instagram(비공개 web API): 아이템의 `image_versions2.candidates[0].url` / `video_versions[0].url` 을 fetch → 바이트.
   - alibaba(스크랩): 메시지 버블의 이미지 `src`(alicdn)를 fetch → 바이트.
   - 각 미디어를 로컬 캐시(`QUALIFLOW_HOME/.media/<channel>/<label>/<msgId>.<ext>`)에 저장 + 정규화 메시지의 `attachments`에 `{kind, mimeType, fileName, source:"pending", externalRef:<로컬키>}` 로 기록(텍스트 없어도 메시지 보존).
2. **에이전트 `push` — Storage 업로드** (C+ 경계 준수):
   - `source:"pending"`인 첨부마다, 토큰 인증된 **새 엔드포인트 `POST /api/agents/media-upload`** 에 바이트(+channel/label/msgId/mime/fileName) 전송.
   - 웹이 **service-role**로 버킷 `message-media`에 업로드(경로: `<workspaceId>/<channel>/<uuid>.<ext>` — 추측 불가). 멱등(같은 키 재업로드는 기존 URL 반환).
   - 응답으로 **공개 URL** 반환 → 에이전트가 그 URL로 첨부를 `{source:"stored", url:<공개URL>}` 로 갱신.
   - 그 다음 기존 `ingest`에 attachments(이제 stored URL 포함)를 함께 보냄.
3. **ingest**: 이미 `0012`가 `messages.attachments`(jsonb)를 저장 → 변경 없음.
4. **CRM 표시**: 메시지 타임라인이 `attachments`를 렌더 — `image`→`<img>`, `video`→`<video controls>`, `file`→다운로드 링크. (bpd 쪽 소폭 추가.)

## 결정(확정)
- **A. 버킷 공개 범위 = 공개 read**. 경로가 추측 불가 UUID라 일반 노출은 아니지만, URL을 아는 사람은 봄 → **데모 단순화**. 추후 비공개+서명URL로 조일 수 있음(★후속 옵션).
- **B. 업로드 경로 = 웹 엔드포인트가 바이트 수신**(`/api/agents/media-upload`, 토큰 인증, 기존 `/api/agents/*` 패턴). 서명-업로드-URL 직업로드는 대안(웹 부하↓·복잡↑) — 미채택.

## 안전장치(비즈니스 규칙)
- 크기 상한 **25MB**/파일 초과 시 다운로드/업로드 스킵하고 `{kind, source:"skipped", reason:"too_large"}` 자리표시.
- MIME 화이트리스트: `image/*`, `video/*`(+ 추후 audio/pdf). 그 외는 자리표시.
- `attachments`가 비텍스트 메시지를 살리되, 다운로드 실패 시에도 메시지는 보존(첨부는 `source:"error"`).

## 경계 스캔
- **DB/인프라**: 새 Supabase Storage 버킷 `message-media`(공개 read 정책). messages 스키마/`attachments` 컬럼은 변경 없음(계약에 이미 있음).
- **시크릿/인증/외부입력 경로 신설**: `POST /api/agents/media-upload` — 에이전트 토큰으로 인증, service-role로 Storage 업로드. **보안 검토 포인트**: 크기·MIME 상한, 토큰당 워크스페이스 경로 강제, 레이트리밋.
- **비즈니스 판단**: 25MB 상한, MIME 화이트리스트, 공개 버킷 선택 — 본 문서에 명시.
- **공개 계약(packages/core)**: `MessageAttachment.source`에 `"skipped"|"error"` 값 추가 가능성(현재 `channel-url|stored|pending`) — 확장 시 보고.

## 영향 파일(예상)
- `apps/agent/src/connectors/{telegram,whatsapp,instagram}.ts` + `packages/adapter-alibaba`(추출) — 미디어 바이트 다운로드 + attachments 기록.
- `apps/agent/src/media.ts`(신규) — 로컬 미디어 캐시 + 업로드 호출.
- `apps/agent/src/push.ts` — push 전 `source:"pending"` 첨부 업로드.
- `apps/web/src/app/api/agents/media-upload/route.ts`(신규) — 토큰 인증 + Storage 업로드.
- `supabase/migrations/0013_storage_message_media.sql`(신규) — 버킷 + 공개 read 정책.
- (bpd) `src/features/messenger/message-timeline.tsx` + `adapters.ts` — attachments 렌더.

## 검증
- 단위: 25MB 초과/비허용 MIME → 자리표시. 업로드 멱등(같은 키 2회 → 같은 URL).
- e2e: telegram/instagram에 사진 있는 대화 fetch→push → `messages.attachments[].url`이 우리 Storage 공개 URL → 브라우저에서 그 URL 200·이미지 표시 → CRM 메시지에 `<img>`로 뜸.
- 영구성: 업로드 후 원본 채널 URL이 만료돼도 우리 URL은 유효.

## 후속(비범위)
- 비공개 버킷 + 서명URL(보안 강화).
- audio/pdf/문서 미리보기.
- 썸네일 생성(영상).
