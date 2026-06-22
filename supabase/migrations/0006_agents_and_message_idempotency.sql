-- PR1 (분산 전환 스택의 토대) — "추가만" 하는 마이그레이션. 기존 테이블/컬럼/정책을 바꾸지 않는다.
-- 목적 두 가지:
--   (1) agents: 사용자 PC에서 도는 "로컬 에이전트"(분산 컴포넌트) 1행 = 에이전트 1대.
--       지금은 아무 코드도 이 테이블을 읽지 않는다(토대만 깔아 둠). PR2~가 채워 나간다.
--       1:N로 열어 둔다 — 한 워크스페이스/한 사용자가 여러 대의 에이전트를 페어링할 수 있다.
--   (2) messages 멱등성: (workspace_id, channel_id, external_message_id) 유니크 인덱스.
--       PR4에서 에이전트가 같은 메시지를 다시 push해도 upsert로 1건만 남게 하는 ON CONFLICT 대상.
--
-- ⚠️ 데이터 모델 경계: 토큰/페어링 컬럼(예: token_hash)은 의도적으로 여기 두지 않는다.
--    그 형태는 보안 소유 경계라서 PR2(페어링 설계 승인) 이후에 alter로 덧붙인다.
-- ⚠️ schema-contract 가드 회피: agents에는 status enum CHECK를 두지 않는다(workspace_members처럼
--    revoked_at로 수명을 표현). status/account_kind/auth_mode 같은 컬럼명+CHECK는 가드가 다른
--    테이블 것과 헷갈려 오탐하므로, 이름이 겹치는 CHECK 컬럼을 일부러 만들지 않는다.

-- (1) agents — 로컬 에이전트(디바이스) 레지스트리
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,  -- 누가 페어링했나(1:N: 한 사용자 → 여러 에이전트)
  label text not null,                 -- 사람이 읽는 이름: "재우 맥북"
  platform text,                       -- 진단용 OS 문자열(darwin/win32 등). 없을 수 있음
  last_seen_at timestamptz,            -- 마지막 heartbeat 시각. PR8(keepalive)에서 갱신. 없을 수 있음
  revoked_at timestamptz,              -- 소프트 해제(workspace_members 패턴과 동일). null = 유효
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agents_workspace_id_idx on public.agents(workspace_id);
create index if not exists agents_owner_user_id_idx on public.agents(owner_user_id);

-- updated_at 자동 갱신 — 0001에서 정의한 set_updated_at 함수를 재사용한다.
drop trigger if exists set_agents_updated_at on public.agents;
create trigger set_agents_updated_at
before update on public.agents
for each row execute function public.set_updated_at();

-- RLS: 다른 테이블과 동일하게 "내 워크스페이스 것만" 읽기/쓰기.
-- (에이전트 자신은 인증된 Supabase 유저가 아니라 WSS 토큰으로 붙으므로, 에이전트의 DB 쓰기는
--  PR2~에서 서버가 대신 수행한다. 이 정책은 "웹 유저가 자기 워크스페이스 에이전트 목록을 본다"용.)
alter table public.agents enable row level security;

drop policy if exists "workspace members can read agents" on public.agents;
create policy "workspace members can read agents"
on public.agents for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write agents" on public.agents;
create policy "workspace members can write agents"
on public.agents for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- (2) channel_connections.agent_id — 이 채널 연결을 어느 에이전트가 도는지.
--     nullable이라 기존 행/기존 코드는 그대로 동작한다(아무도 아직 이 컬럼을 안 읽음).
alter table public.channel_connections
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

create index if not exists channel_connections_agent_id_idx on public.channel_connections(agent_id);

-- (3) messages 멱등성 유니크 인덱스.
--     external_message_id가 NULL인 행(예: 아직 외부 id가 없는 outbound 초안)은 Postgres에서
--     서로 distinct로 취급돼 여러 개 허용된다. 외부 id가 있는 inbound는 중복 저장이 차단된다.
--     PR4의 INSERT ... ON CONFLICT (workspace_id, channel_id, external_message_id) 대상이 된다.
create unique index if not exists messages_workspace_channel_external_message_idx
  on public.messages (workspace_id, channel_id, external_message_id);
