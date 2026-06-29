-- 반응/관심 기업 뷰 + 주문 고객 뷰를 위한 CRM 소유 테이블 3개.
-- ★buyer_links(0015)와 동일 원칙: DDL은 공유 클라우드 DB의 마이그레이션 채널(여기)로 만들되,
--   QF leads/threads/messages는 불변(읽기 전용). CRM은 service-role로 이 테이블들만 읽고 쓴다.
-- ★RLS는 켜되 공개 정책을 만들지 않는다 → service-role(RLS 우회)만 접근.
-- 데이터 출처: 기업명·국가·채널·유입경로(=채널/출처)·회신 내용은 전부 lead(QF)에서 끌어온다.
--   여기 테이블에는 사람이 다루는 "업무 오버레이"(담당자/액션/검토/스테이지/별점/메모/Drop)와
--   주문/계약(수동 입력)만 저장한다.

-- 1) 사용자 정의 파이프라인 스테이지 (관심 기업 칸반의 컬럼). 사용자가 직접 추가·재정렬.
create table if not exists public.crm_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position integer not null default 0,         -- 보드 내 정렬 순서
  board text not null default 'interest',      -- 어떤 보드의 스테이지인지(예: interest/response)
  created_at timestamptz not null default now()
);
create index if not exists crm_stage_workspace_idx on public.crm_stage(workspace_id);
alter table public.crm_stage enable row level security;

-- 2) 바이어별 CRM 업무 오버레이 (통합 바이어 1명 = 1행). lead(QF) 위에 얹는다.
--    canonical_lead_id = 통합 바이어의 대표 lead. 같은 바이어는 한 행만(unique).
create table if not exists public.crm_buyer (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  canonical_lead_id uuid not null references public.leads(id) on delete cascade,
  assignee text,                                       -- 담당자(지금은 이름 문자열, 추후 사용자 FK)
  action_needed boolean not null default false,        -- 액션 on/off 태그
  review_days integer,                                 -- 검토 시간(며칠) — 담당자가 검토 기간을 줬을 때
  stage_id uuid references public.crm_stage(id) on delete set null,  -- 커스텀 스테이지
  rating smallint check (rating between 0 and 5),      -- 별점(관심 기업 카드)
  note text,                                           -- 메모
  dropped boolean not null default false,              -- Drop 여부
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, canonical_lead_id)
);
create index if not exists crm_buyer_workspace_idx on public.crm_buyer(workspace_id);
create index if not exists crm_buyer_canonical_idx on public.crm_buyer(canonical_lead_id);
create index if not exists crm_buyer_stage_idx on public.crm_buyer(stage_id);
alter table public.crm_buyer enable row level security;

-- 3) 주문/계약 고객 (Inservice CRM). QF에 없는 데이터라 사람이 수동 입력한다.
--    linked_lead_id로 QF 바이어와 연결할 수 있으나(선택), 없어도 독립 존재 가능.
create table if not exists public.crm_order (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_name text not null,
  kr_id text,
  crm_id text,
  industry text,
  contract_value numeric,
  contract_start date,
  contract_end date,
  assignee text,
  status text,
  linked_lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_order_workspace_idx on public.crm_order(workspace_id);
create index if not exists crm_order_linked_lead_idx on public.crm_order(linked_lead_id);
alter table public.crm_order enable row level security;
