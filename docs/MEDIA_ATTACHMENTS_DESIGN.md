# 미디어(사진·동영상) 수집 설계 — 기존 텍스트 기능을 깨지 않고

> 상태: **설계(제안)**. 구현 전 소유자 결정 필요 항목을 ★로 표시. 바로 코드 안 들어감.

## 1. 지금 상태 (사실)
- 4채널 모두 **텍스트만** 가져온다. 미디어 처리:
  - alibaba: 비텍스트 → `[미지원 메시지 type: N]` 자리표시 문자열
  - telegram: 텍스트 없으면 **메시지 통째로 건너뜀**
  - instagram: `item_type==="text"`만, 나머지 **건너뜀**
  - whatsapp: 이미지/영상의 **캡션 텍스트만**(미디어 자체 X), 캡션 없으면 `.filter(m=>m.text)`로 탈락
- DB: `messages.attachments jsonb not null default '[]'` (0001 마이그레이션) — **자리는 이미 있음**.
- 계약(`packages/core` `MessageAttachment`): `{ id, fileName, mimeType, url }` — **url 필수**.

## 2. 핵심 긴장: "url 필수" 계약 vs 채널 현실
| 채널 | 미디어 접근 | 공개 URL? |
|---|---|---|
| instagram | DM API에 `image_versions/video_versions` CDN URL | **있음(단 만료)** |
| alibaba | 메시지 raw에 이미지 ref/CDN | 있을 가능성(만료/인증) |
| telegram(MTProto) | `message.media`(photo/document) | **없음 — 바이트 다운로드 필요** |
| whatsapp(Baileys) | 암호화 미디어(mediaKey) | **없음 — 복호화 다운로드 필요** |

→ 현재 `MessageAttachment.url`(필수)만으론 telegram/whatsapp을 못 담는다. **계약 확장이 필요**.

## 3. ★결정 1 — 저장 전략 (가장 중요한 갈림길)
- **(A) URL만 저장**: 싸고 빠름. 단 instagram/alibaba URL은 만료돼 나중에 깨진 이미지가 됨. telegram/whatsapp은 애초에 URL이 없어 불가.
- **(B) 바이트 다운로드 → 우리 스토리지(예: Supabase Storage 버킷 또는 VPS) → 안정 URL 저장**: 견고함. 단 스토리지 인프라 + 다운로드 단계 + 용량/비용. **에이전트가** 다운로드해야 함(채널 세션이 로컬에 있으므로) → 에이전트→서버 **미디어 업로드 경로 신설** 필요.
- **(C) 하이브리드**: 메타데이터+썸네일은 즉시, 원본은 지연 다운로드(첫 조회 시). 복잡.
- 권장: 데모 단계는 **(A)로 instagram/alibaba만**(URL 있는 채널), telegram/whatsapp은 4절의 "비파괴 자리표시"로 일단 안 버리기. 납품 후 **(B)**로 승격.

## 4. ★결정 2 — 계약(`MessageAttachment`) 확장안
현재:
```ts
export type MessageAttachment = { id; fileName; mimeType; url };
```
제안(하위호환: 기존 필드 유지, 추가는 옵셔널):
```ts
export type MessageAttachment = {
  id: EntityId;
  kind: "image" | "video" | "audio" | "file"; // ← 추가(렌더 분기용)
  fileName: string;
  mimeType: string;
  url?: UrlString;        // ← 필수에서 옵셔널로 (다운로드 전엔 없을 수 있음)
  source: "channel-url" | "stored" | "pending"; // ← 추가(만료URL/저장본/미다운로드)
  thumbnailUrl?: UrlString;
  caption?: string;
  sizeBytes?: number;
  width?: number; height?: number; durationMs?: number;
  externalRef?: string;   // ← 채널 원본 식별자(추후 (B) 다운로드용 키)
};
```
`url`을 옵셔널로 바꾸는 건 **계약 완화**라 `packages/core` 소유자 승인 필요(★). 기존 코드가 `url`을 무조건 쓰면 깨질 수 있어 사용처 점검 동반.

## 5. 비파괴 원칙 (기존 텍스트 기능 보존 — 반드시 지킬 것)
1. **텍스트 메시지는 일절 안 건드림**: 텍스트 정규화 경로 그대로. attachments는 텍스트엔 `[]` 유지.
2. **"텍스트 없으면 버림" → "미디어 있으면 보존"으로만 변경**: telegram의 `if(!text)continue`, whatsapp의 `.filter(m=>m.text)`를 "텍스트도 미디어도 없을 때만 스킵"으로 완화. content.text는 캡션 또는 빈 문자열, 미디어는 attachments로.
3. **마이그레이션 불필요**: attachments 컬럼·ingest 경로가 이미 있음(0001). DTO에 attachments 배열만 실으면 됨.
4. **단계적 + 플래그**: 채널별로 하나씩 켜고, 문제 생기면 그 채널만 텍스트-only로 되돌릴 수 있게.
5. **CRM 영향**: attachments가 채워지기 시작하면 CRM이 렌더해야 함 → CRM 세션과 "attachment 스키마" 합의 후 켠다(안 그러면 CRM이 빈 말풍선 표시).

## 6. 단계 계획
- **Phase 0 (계약 변경 없음, 즉시 안전)**: 미디어를 **버리지 않기**. 텔레그램/인스타가 미디어를 만나면 `content.text`에 `[사진]`/`[영상]` 같은 표시를 넣어 "대화에 뭔가 있었다"를 보존(알리바바는 이미 자리표시 함). → 대화 흐름이 빈 곳 없이 보임. UI 변경 불필요.
- **Phase 1 (계약 확장 + URL 캡처)**: 4절 확장 적용. instagram/alibaba의 CDN URL을 attachments에 담음(`source:"channel-url"`). telegram/whatsapp은 `source:"pending"` + externalRef만(다운로드는 Phase 2).
- **Phase 2 (다운로드→스토리지)**: 에이전트가 바이트 다운로드(텔레그램 `downloadMedia`, 왓츠앱 `downloadMediaMessage`) → 스토리지 업로드 → `source:"stored"` + 안정 url. 에이전트→서버 미디어 업로드 엔드포인트 신설(★보안 경계: 인증·크기 상한·MIME 화이트리스트).

## 7. 경계 스캔 (이 설계가 건드릴 곳)
- **공개 계약(`packages/core`)**: `MessageAttachment` 확장 — ★소유자 승인.
- **DB 모양**: attachments 컬럼 이미 존재 → 컬럼 변경 없음. (Phase 2의 스토리지 버킷은 새 인프라.)
- **시크릿/인증/외부입력 경로**: Phase 2의 에이전트→서버 미디어 업로드 경로 신설 — ★보안 검토(크기·MIME·레이트리밋).
- **비즈니스 판단**: 어떤 미디어 종류를 담을지, 만료 URL을 어떻게 다룰지, 용량 상한 — ★소유자 결정.

## 8. 권장 순서
Phase 0(지금 당장, 안전) → CRM과 attachment 스키마 합의 → Phase 1(URL 채널) → 납품 후 Phase 2(다운로드). 
**텍스트 파이프라인은 전 과정에서 불변.**
