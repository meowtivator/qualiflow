-- CRM 데이터 모델: 1B(라이프사이클 stage+subStage) + 4B(Lead↔ChannelIdentity) + F4(follow_up)
-- ⚠️ CHECK의 값 목록은 packages/core 의 LEAD_STAGES / LEAD_SUB_STAGES / FOLLOW_UP_STATES 와
--    글자 단위로 같아야 한다. (scripts/check-schema-contract.ts 가 매번 일치를 검사)

-- 1B: leads 라이프사이클을 New/MQL/SAL/SQL 모델로 교체 (greenfield — 실 lead 없음)
alter table public.leads drop column if exists lifecycle_stage;
alter table public.leads
  add column if not exists stage text not null default 'new'
    check (stage in ('new', 'mql', 'sal', 'sql'));
-- sub_stage 값: MQL(qualification·need_analysis·get_contact) / SAL(direct_contact·proposal) / SQL(order·second_order)
alter table public.leads
  add column if not exists sub_stage text
    check (sub_stage in (
      'qualification', 'need_analysis', 'get_contact',
      'direct_contact', 'proposal',
      'order', 'second_order'
    ));

-- 4B: 한 사람(Lead) = 여러 채널. channel_identities 신설
create table if not exists public.channel_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null,
  external_id text not null,
  handle text,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel, external_id)
);

-- F4 + 4B 링크: threads에 채널 정체성 + 팔로업 추가
alter table public.threads
  add column if not exists channel_identity_id uuid references public.channel_identities(id) on delete set null;
alter table public.threads
  add column if not exists follow_up text not null default 'none'
    check (follow_up in ('none', 'needs_my_reply', 'waiting_on_customer'));

-- 인덱스
create index if not exists channel_identities_workspace_id_idx on public.channel_identities(workspace_id);
create index if not exists channel_identities_lead_id_idx on public.channel_identities(lead_id);
create index if not exists threads_channel_identity_id_idx on public.threads(channel_identity_id);

-- updated_at 자동 갱신 트리거 (기존 set_updated_at 함수 재사용)
drop trigger if exists set_channel_identities_updated_at on public.channel_identities;
create trigger set_channel_identities_updated_at
before update on public.channel_identities
for each row execute function public.set_updated_at();

-- RLS: 다른 테이블과 동일하게 "내 워크스페이스 것만" 읽기/쓰기
alter table public.channel_identities enable row level security;

drop policy if exists "workspace members can read channel_identities" on public.channel_identities;
create policy "workspace members can read channel_identities"
on public.channel_identities for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write channel_identities" on public.channel_identities;
create policy "workspace members can write channel_identities"
on public.channel_identities for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
