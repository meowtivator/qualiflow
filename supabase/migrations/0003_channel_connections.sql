-- 채널 연결: 내가 연결한 채널 계정들(상태 추적용). 단일 사용자 + 내 여러 계정 가정.
-- ⚠️ 비번급 "세션"은 여기 저장하지 않는다 — 워커가 로컬 파일로 보관하고, DB엔 상태만.
-- ⚠️ status 값 목록은 packages/core 의 CHANNEL_CONNECTION_STATUSES 와 글자단위로 같아야 한다
--    (scripts/check-schema-contract.ts 가 매번 일치를 검사).

create table if not exists public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null,                  -- 'alibaba','instagram','telegram'...
  account_label text not null,            -- 내 계정 구분: "기본 계정", "회사 계정"
  external_account_id text,               -- 채널 계정 id(aliId 등), 알면
  status text not null default 'disconnected'
    check (status in ('disconnected', 'active', 'needs_relogin', 'error')),
  last_synced_at timestamptz,
  sync_cursor text,                       -- 마지막 동기화 지점
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel, account_label)
);

create index if not exists channel_connections_workspace_id_idx on public.channel_connections(workspace_id);

-- updated_at 자동 갱신 (기존 set_updated_at 함수 재사용)
drop trigger if exists set_channel_connections_updated_at on public.channel_connections;
create trigger set_channel_connections_updated_at
before update on public.channel_connections
for each row execute function public.set_updated_at();

-- RLS: 다른 테이블과 동일하게 "내 워크스페이스 것만"
alter table public.channel_connections enable row level security;

drop policy if exists "workspace members can read channel_connections" on public.channel_connections;
create policy "workspace members can read channel_connections"
on public.channel_connections for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write channel_connections" on public.channel_connections;
create policy "workspace members can write channel_connections"
on public.channel_connections for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
