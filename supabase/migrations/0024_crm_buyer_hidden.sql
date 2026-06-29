-- 0024: 바이어 '제외(hidden)' — 스팸/불필요 바이어를 CRM 뷰에서 완전히 숨긴다.
--   Drop(crm_buyer.dropped = 탈락/lost, 기록 유지)과는 별개의 의미:
--   hidden=true 면 반응/관심 뷰에서 기본 제외(보이지 않음), '숨긴 항목 보기'로만 복구.
--
-- ★왜 하드 삭제가 아니라 플래그인가:
--   ① bpd(CRM)는 QF leads/messages 를 '읽기 전용'으로만 본다(방화벽) — 진짜 삭제 권한 없음.
--   ② 설령 lead 를 지워도 다음 fetch 때 에이전트가 그 바이어를 다시 ingest 해 도로 생긴다.
--   따라서 durable 한 제외는 CRM 소유 오버레이(crm_buyer)에 플래그를 둬야 재fetch 에도 유지된다
--   (crm_buyer 는 canonical_lead_id 로 lead 에 1:1 매핑 — 같은 바이어가 다시 와도 계속 숨겨짐).

alter table public.crm_buyer
  add column if not exists hidden boolean not null default false;

-- 숨겨진 행은 소수라 partial index 로 '숨긴 항목 보기' 조회만 빠르게.
create index if not exists crm_buyer_hidden_idx on public.crm_buyer(hidden) where hidden;
