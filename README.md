# QualiFlow

B2B 인바운드 리드를 분류하고 후속 흐름을 관리하는 sales inbox 실험 프로젝트입니다.

## Repository Structure

```txt
apps/
  web/        # Next.js demo app
packages/
  core/       # Shared domain contracts for leads, threads, messages, and adapters
  adapter-mock/
              # Mock conversation adapter for local UI development
supabase/
  migrations/ # Local/hosted Supabase schema
  seed.sql    # Demo data for DB verification
```

## Current Scope

현재 단계는 메신저 도메인의 핵심 계약과 로컬 검증 가능한 앱 뼈대를 갖춘 상태입니다.

- Next.js App Router
- pnpm workspace
- Turborepo task orchestration
- 조용한 CRM 스타일의 좌측 사이드바와 메신저 작업 화면
- `@qualiflow/core` 타입 계약
- `@qualiflow/adapter-mock` 기반 mock inbox
- 답변 초안 mock 버튼
- Supabase Auth/DB 연결 준비
- RLS가 적용된 workspace 기반 DB 스키마
- gitignored `.data/*.json` 기반 실제 채널 데이터 preview

## Domain Terms

QualiFlow는 범용 채팅 도구가 아니라 B2B buyer CRM inbox를 목표로 합니다.

- `clients`: 제품과 문서에서 사용하는 고객사 개념입니다.
- `client_accounts`: Supabase DB에서 고객사를 저장하는 테이블입니다.
- `leads`: 고객사에 문의해온 바이어 또는 잠재 거래처입니다.
- `threads`: 특정 채널에서 이어지는 대화방입니다.
- `messages`: thread 안의 실제 inbound/outbound 메시지입니다.
- `qualifications`: lead를 A/B/C로 분류한 결과와 근거입니다.

## Commands

```bash
pnpm install
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm run build
```

## Real-data Preview

실제 채널 추출 결과를 빠르게 확인할 때는 gitignored `apps/web/.data/*.json` 파일을 사용합니다.

```txt
apps/web/.data/alibaba-conversations.json
apps/web/.data/telegram-conversations.json
apps/web/.data/instagram-conversations.json
apps/web/.data/whatsapp-conversations.json
```

파일이 있으면 상단 상태 배지가 `Real JSON preview`로 표시되고, 없으면 mock data로 폴백합니다. 공유 배포에서는 `QUALIFLOW_DEMO_PASSWORD`를 설정해 HTTP Basic Auth로 보호합니다.

자세한 배포 절차는 [docs/PREVIEW_DEPLOYMENT.md](docs/PREVIEW_DEPLOYMENT.md)를 봅니다.

## Supabase Local Check

Supabase 설정이 없으면 앱은 mock adapter만 사용합니다. Supabase 환경변수를 넣으면 `/`가 로그인으로 보호되고, 로그인 후 서버에서 DB 연결을 확인합니다.

1. Supabase CLI로 로컬 서비스를 켭니다.

```bash
supabase start
```

2. 출력된 local API URL과 publishable key를 Next 앱이 읽는 `apps/web/.env.local`에 넣습니다.

```bash
cp .env.example apps/web/.env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

3. 마이그레이션과 seed를 적용합니다.

```bash
supabase db reset
```

4. 앱을 실행합니다.

```bash
pnpm run dev
```

5. `http://localhost:3000`에 접속해 이메일 로그인을 진행합니다.

로그인 후 첫 접근에서 `public.create_workspace()` RPC가 실행되어 현재 사용자 소유의 워크스페이스가 생성됩니다. 상단 상태 배지가 `Supabase connected`로 바뀌면 Auth 세션, RLS, DB select/insert 흐름이 동작하는 상태입니다.

## Supabase Redirect URL

Hosted Supabase를 사용할 때는 Supabase Dashboard의 Auth URL 설정에 아래 redirect URL을 추가합니다.

```txt
http://localhost:3000/auth/callback
```

배포 도메인이 생기면 같은 형식으로 운영 URL도 추가합니다.
