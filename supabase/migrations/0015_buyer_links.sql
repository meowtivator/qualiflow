-- ② 채널 통합용 '병합 매핑'. 같은 실제 바이어로 묶은 lead들을 기록한다.
-- ★CRM 소유 개념이지만 DDL은 공유 클라우드 DB의 마이그레이션 채널(여기)로 만든다. CRM은 service-role로 읽고 쓴다.
--   QF leads/threads/messages는 그대로 둔다(불변) — 여기엔 "어떤 lead가 어떤 canonical lead와 같은 바이어인지"만.
-- 모델: (canonical_lead_id, member_lead_id) = "member는 canonical과 같은 바이어". 통합 바이어 = canonical + 그 members.
--   한 lead는 하나의 canonical로만 묶인다(unique). 수동 병합/해제로 행을 넣고 뺀다.
create table if not exists public.buyer_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  canonical_lead_id uuid not null references public.leads(id) on delete cascade,
  member_lead_id uuid not null references public.leads(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, member_lead_id),
  check (canonical_lead_id <> member_lead_id)
);

create index if not exists buyer_links_canonical_idx on public.buyer_links(canonical_lead_id);
create index if not exists buyer_links_workspace_idx on public.buyer_links(workspace_id);

-- ★RLS 켜되 공개 정책 없음 → service-role(RLS 우회)만 접근. CRM이 service-role 클라이언트로 읽고 쓴다.
alter table public.buyer_links enable row level security;
