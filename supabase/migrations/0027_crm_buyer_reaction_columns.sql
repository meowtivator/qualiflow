-- 0027: crm_buyer 반응 바이어 뷰 컬럼 확장 (팀 피드백 — 컬럼 재설계)
--
-- 새 컬럼 순서(뷰): 긴급 · 바이어(이름/회사) · 고객사 · 채널 · 회신내용 · 처리 · 제외사유
--   - 긴급        = 기존 action_needed(boolean) 재사용(라벨만 '긴급'으로). ★새 컬럼 없음★
--   - 바이어 수기  = buyer_name_override / company_override (자동값 없거나 틀릴 때 사람이 덮어씀)
--   - 처리        = process_status ('in_progress' 진행중 | 'closed' 종료)
--   - 제외사유     = exclusion_reason ('deal_failed' 거래실패 | 'spam' 스팸) — 기존 Drop/제외를 하나로 통합
--
-- 모두 crm_buyer(=CRM 소유 오버레이 테이블)에만 추가. QF leads/threads/messages 는 손대지 않음.
-- append-only(add column if not exists) + check 제약, create or replace 없음 → 저위험/멱등.
-- 기존 dropped/hidden 값은 새 exclusion_reason 으로 1회 이관(아래)해 연속성 유지.

alter table public.crm_buyer
  add column if not exists buyer_name_override text,       -- 바이어명 수기. null = 자동(QF display_name)
  add column if not exists company_override text,          -- 회사명 수기. null = 자동(QF company_name)
  add column if not exists process_status text
    check (process_status is null or process_status in ('in_progress', 'closed')),
  add column if not exists exclusion_reason text
    check (exclusion_reason is null or exclusion_reason in ('deal_failed', 'spam'));

-- 기존 Drop(거래실패 성격) / 제외(hidden = 스팸 성격) 값을 새 단일 제외사유로 이관(멱등: 이미 값 있으면 유지).
update public.crm_buyer set exclusion_reason = 'deal_failed'
  where dropped is true and exclusion_reason is null;
update public.crm_buyer set exclusion_reason = 'spam'
  where hidden is true and exclusion_reason is null;

create index if not exists crm_buyer_exclusion_idx
  on public.crm_buyer(exclusion_reason) where exclusion_reason is not null;
create index if not exists crm_buyer_process_status_idx
  on public.crm_buyer(process_status) where process_status is not null;
