# QualiFlow

B2B 인바운드 리드를 분류하고 후속 흐름을 관리하는 sales inbox 실험 프로젝트입니다.

## Repository Structure

```txt
apps/
  web/        # Next.js demo app
packages/
  core/       # Shared domain contracts for leads, threads, messages, and adapters
```

## 00 Scaffold

현재 단계는 기능이 없는 최소 화면입니다.

- Next.js App Router
- pnpm workspace
- Turborepo task orchestration
- 조용한 CRM 스타일의 좌측 사이드바
- `메신저` 탭 하나
- 빈 메신저 작업 화면
- `@qualiflow/core` 타입 계약

아직 없는 것:

- mock data
- lead/customer UI 연결
- API
- LLM
- Supabase
- 외부 채널 연동

## Commands

```bash
pnpm install
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm run build
```
