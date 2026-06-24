# C+ 전 리팩토링 리스트 (에이전트 ↔ 서버 정합)

> 목적: 로컬 에이전트(`apps/agent`)가 완성된 지금, **에이전트↔서버(`apps/web` + Supabase) 전송 계층("C+")**을
> 붙이기 전에 정리해야 할 불일치/잔재를 한 곳에 모은다.

## 0. 기준 — 이건 "새 설계"가 아니다

이 작업은 이미 있는 두 문서의 단계를 **실행**하는 것이다(새 아키텍처를 정하는 게 아님):

- [`SYNC_ARCHITECTURE.md`](./SYNC_ARCHITECTURE.md) — 저장 upsert 순서, 커서 전략, **Verification Order 1~5**.
- [`ACCOUNT_CONNECTOR_STRATEGY.md`](./ACCOUNT_CONNECTOR_STRATEGY.md) — 런타임/어댑터/웹 역할 분담, 연결상태 계약.

**현재 위치 (SYNC_ARCHITECTURE의 Verification Order 기준):**

1. 어댑터 정규화 ✅
2. `.data/*.json` 프리뷰를 웹 인박스에 렌더 ✅
3. 계정-세션 커넥터 런타임(= 로컬 에이전트) ✅
4. **정규화 레코드를 Supabase에 영속화** ⬅ C+의 본체
5. **파일 기반 `.data` 로딩 → DB-backed adapter로 교체** ⬅ "프론트 반영"

즉 사용자가 말한 "서버 프론트에만 반영" = **4번 + 5번 전체**다(프론트 한 군데가 아니라 전송+저장+읽기 파이프라인).

## 1. 핵심 변수 — 에이전트가 "원격"이 됐다

`.data` 프로토타입은 웹서버와 커넥터가 **같은 머신**이라 웹이 `.data`를 직접 읽을 수 있었다. 피벗 후:

- 에이전트 = **사용자 PC**, 웹 = **VPS 컨테이너(qualiflow-web)**.
- → **웹은 에이전트의 `.data`를 못 읽는다.** 컨테이너의 `.data`는 비어있거나 무관.

그래서 `.data`를 매개로 하던 웹 코드는 전부
**`에이전트가 서버로 push → 서버가 DB 저장 → 웹이 DB를 읽음`** 으로 바뀌어야 한다(= 4·5단계).

## 2. 리팩토링 항목

### A. `.data` 의존 웹 코드 → DB 기반 (높음 · 문서 4·5단계)

| 위치 | 지금 | 바꿀 방향 |
| --- | --- | --- |
| `apps/web/src/app/api/connectors/status/route.ts` | `.data/{channel}-connection.json` 읽기/삭제 | `channel_connections` 테이블 query/transaction. (상태 진실원본은 DB — 단 이제 런타임이 원격 에이전트라 `.data`는 못 읽음) |
| `apps/web/src/app/api/connectors/launch/route.ts` | 웹이 `CHROME_PATH`로 크롬 spawn | **삭제.** 로그인/브라우저는 이제 에이전트가 함 |
| `apps/web/src/app/page.tsx` (`loadConversationSource`) | `.data/*.json` 또는 mock | DB-backed `ConversationAdapter`(step 5) |

> 주의: 이건 "옛 실수 제거"가 아니라 `ACCOUNT_CONNECTOR_STRATEGY.md`의 *"file-backed prototype → DB"* 전환을
> 실행하는 것 + 에이전트 원격화 반영.

### B. 인그est 매핑 (높음 · 문서의 upsert 순서 그대로)

에이전트가 정규화 데이터를 POST → 서버가 **문서에 적힌 순서로 upsert**:
`channel_connections → leads → channel_identities → threads → messages (→ qualifications/draft_suggestions)`.

- **`workspace_id`는 core 타입에 넣지 않는다 (경계 #1).** 어댑터/에이전트는 채널-네이티브로 정규화하고,
  `workspace_id`는 **서버가 에이전트 토큰 검증에서 얻어 storage 단계에 주입**한다. (에이전트가 남의 워크스페이스로
  쓰는 걸 원천 차단 = 더 안전. `SYNC_ARCHITECTURE` "adapter returns normalized data; storage adds workspace"와 일치.)
  → Explore가 제안한 "core에 `workspaceId` 추가"는 **채택하지 않음**(packages/core는 동결 계약, 서버 주입이 정답).
- 멱등: `messages` unique`(workspace_id, channel_id, external_message_id)` → `INSERT ... ON CONFLICT`.

### C. 계정 진실원본 (중간 · 문서가 이미 답함)

- `channel_connections`(DB) = **상태/커서/소유권**의 진실원본. 에이전트 로컬 `agent-accounts.json` = **세션**의 진실원본.
  → 충돌이 아니라 역할분담(`SYNC_ARCHITECTURE` "Data Boundary").
- 에이전트가 `add`한 계정은 ingest(또는 별도 보고 API)로 서버에 알림 → 서버가 `channel_connections` upsert
  (`owner_user_id` = 페어링한 사용자, `workspace_id` = 토큰에서). `accounts.ts` 주석의 "나중에 channel_connections로 승격"이 이 단계.

### D. 설정 / 인증 (중간)

- `apps/agent/src/config.ts`의 `QUALIFLOW_CLOUD_URL` 기본값 = `localhost:3000`. 배포 에이전트는
  **`https://qualiflow.meowti.kr`** 로 설정해야 함 → `.env.example`에 명시.
- `/api/agents/*` 인증: `pair`만 무인증 공개(이미). `ingest`/`command`/`heartbeat`는 **Bearer 토큰을 라우트가 직접 검증**
  (세션 미들웨어는 통과시키되 토큰 검증은 라우트에서). **데모 게이트**(`QUALIFLOW_DISABLE_AUTH`/`QUALIFLOW_DEMO_PASSWORD`)와
  토큰 인증을 **섞지 말 것** — 데모 우회가 에이전트 인증을 무력화하면 안 됨.
- 라이브 동작엔 **데모 아닌 실배포** 필요: `QUALIFLOW_PAIRING_PEPPER` + Supabase(`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(빌드타임), `SUPABASE_SECRET_KEY`) + **마이그레이션을 클라우드 DB에 적용**.

### E. 커서 / 재동기 (낮음 · 문서대로)

- `channel_connections.sync_cursor` 사용. Alibaba = 마지막 `conversationCode` + msgId/time.

## 3. C+ 붙이기 전 TOP 3

1. **인그est 계약 + 매핑 확정** — 문서의 upsert 순서를 SECURITY DEFINER 함수로 구현. `workspace_id`는 서버 주입,
   core 불변. → C+ PR③의 핵심.
2. **`.data` → DB 전환** — `connectors/status`·`connectors/launch`·`page.tsx`. 에이전트 원격화로 웹의 `.data` 읽기가
   이미 깨졌으므로 필수.
3. **계정 보고 경로** — 에이전트 `add` → 서버 `channel_connections` upsert.

## 4. 경계 플래그 (소유자 결정/보고 필요)

- **`packages/core` (#1)**: 변경 **권장 안 함**(workspace_id 서버 주입). 정말 바꿔야 하면 코드 전에 멈추고 보고.
- **마이그레이션 (#2)**: ingest용 + token-verify용 SECURITY DEFINER 함수 신규. 작성 전 모양 보고.
- **인증/시크릿 (#3)**: `/api/agents/*` 토큰검증 레이어, 데모게이트 분리, 실배포 시크릿(pepper/Supabase).

---
*이 문서는 C+ 작업의 기준표다. 항목을 처리하면 체크하고, 결정이 바뀌면 여기와 위 두 기준 문서를 함께 갱신한다.*
