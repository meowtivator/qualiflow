-- 0020: B6 수기입력 — 자동 연동이 안 되는 채널(Line/KakaoTalk/WeChat 등)의 바이어를 사람이
--   손으로 추가하기 위한 CRM 소유 테이블. bpd의 0008_crm_manual_buyer.sql DDL을 crm_* 소유
--   채널(QF lab)로 이관해 공유 클라우드 DB에 적용한다(소유자 승인: U6). crm_client(0019) 의존.
-- ★방화벽: QF leads/threads/messages(읽기 전용)는 건드리지 않는다. CRM 소유 테이블만 만든다.
-- ★RLS는 켜되 공개 정책 없음 → service-role(RLS 우회)만 접근.
--
-- 왜 새 테이블인가: crm_buyer는 canonical_lead_id(실제 QF lead)에 FK라 lead 없는 수기 바이어를
--   담을 수 없고(QF leads 쓰기 금지), crm_order는 "주문" 의미라 부적합. 그래서 전용 테이블.

create table if not exists public.crm_manual_buyer (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text,                                           -- 담당자/연락처 이름(선택)
  company text not null,                               -- 회사명(필수)
  channel text not null,                               -- 채널 라벨(예: Line / KakaoTalk / WeChat)
  note text,                                           -- 메모(선택)
  client_id uuid references public.crm_client(id) on delete set null,  -- 고객사 연결(선택)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_manual_buyer_workspace_idx on public.crm_manual_buyer(workspace_id);
create index if not exists crm_manual_buyer_client_idx on public.crm_manual_buyer(client_id);
alter table public.crm_manual_buyer enable row level security;
