-- 0019: B3 고객사 분류 — 바이어를 고객사(AESTHEIN / FROM THE SKIN / MAKEHEAL 등)별로 나눈다.
--   bpd 레포에 "파일만" 두었던 0007_crm_client_classification.sql 의 DDL을, crm_* 소유 채널인
--   QF lab(0016_crm_views.sql 옆)으로 이관해 공유 클라우드 DB에 적용한다(소유자 승인: U6).
-- ★방화벽: QF leads/threads/messages(읽기 전용)는 건드리지 않는다. CRM 소유 테이블만 만든다/바꾼다.
-- ★RLS는 켜되 공개 정책을 만들지 않는다 → service-role(RLS 우회)만 접근. (0016과 동일 원칙)

-- 1) 고객사(광고주) 마스터. 사람이 추가·관리. 시드 3개는 아래 insert로 넣는다.
create table if not exists public.crm_client (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,                         -- 고객사 표시명(예: AESTHEIN)
  created_at timestamptz not null default now(),
  unique (workspace_id, name)                 -- 워크스페이스 안에서 고객사명은 유일
);
create index if not exists crm_client_workspace_idx on public.crm_client(workspace_id);
alter table public.crm_client enable row level security;

-- 2) crm_buyer에 고객사 연결(선택). 없으면 NULL = 미분류. 고객사 삭제 시 SET NULL(바이어는 보존).
alter table public.crm_buyer
  add column if not exists client_id uuid references public.crm_client(id) on delete set null;
create index if not exists crm_buyer_client_idx on public.crm_buyer(client_id);

-- 3) 시드 고객사 3개(AESTHEIN / FROM THE SKIN / MAKEHEAL).
--    ★단일 워크스페이스 데모 가정: 리드가 한 개라도 있는(가장 오래된) 워크스페이스에 시드를 넣는다.
--    이미 같은 이름이 있으면 건너뛴다(do nothing). 워크스페이스가 없으면 아무것도 안 넣음.
insert into public.crm_client (workspace_id, name)
select w.id, c.name
from (select id from public.workspaces order by created_at asc limit 1) w
cross join (values ('AESTHEIN'), ('FROM THE SKIN'), ('MAKEHEAL')) as c(name)
on conflict (workspace_id, name) do nothing;
