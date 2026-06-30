-- 0022: ⓒ-하이브리드 read-view — bpd(CRM 제품)가 qf 테이블을 '날 컬럼'으로 직접 읽던 것을
--   안정적인 뷰(v_*) 뒤로 숨긴다. 목적: qf가 컬럼을 rename/추가해도 bpd가 안 깨지게(결합면 격리).
--   bpd 는 이 뷰만 읽고, qf 가 컬럼을 바꾸면 '뷰 정의'만 여기서 따라가면 된다(bpd 무변경).
--
-- ★소유 경계(데이터 모델): 새 테이블/컬럼이 아니라 '읽기 전용 뷰'만 만든다. 원본 테이블·RLS 불변.
-- ★보안(줄 단위): 각 뷰는
--   (a) security_invoker = on  → 뷰가 '호출자 권한'으로 원본을 읽는다. 즉 service_role 은
--       RLS 우회(원래 그렇게 동작)지만, anon/authenticated 로는 RLS가 그대로 적용돼 아무것도 못 본다.
--       (security_invoker 가 off면 뷰 소유자=postgres 권한으로 RLS를 우회해 '구멍'이 될 수 있어 반드시 on.)
--   (b) revoke all from anon, authenticated → 공개 롤은 뷰 자체에 접근 불가(심층 방어).
--   (c) grant select to service_role → bpd 서버(서비스롤)만 읽는다.
-- 노출 컬럼은 'bpd 가 실제로 select 하던 컬럼'과 1:1 (queries.ts 의 *_COLUMNS). 그 외 컬럼은 숨긴다.

-- 1) leads → v_leads (bpd LEAD_COLUMNS)
create or replace view public.v_leads with (security_invoker = on) as
  select id, workspace_id, client_id, display_name, company_name, country_code, country_name,
         primary_email, profile_image_url, stage, sub_stage, source_channel_ids, lead_metadata
  from public.leads;
revoke all on public.v_leads from anon, authenticated;
grant select on public.v_leads to service_role;

-- 2) threads → v_threads (bpd THREAD_COLUMNS)
create or replace view public.v_threads with (security_invoker = on) as
  select id, workspace_id, client_id, lead_id, channel_id, channel_identity_id, title,
         status, priority, follow_up, last_message_at
  from public.threads;
revoke all on public.v_threads from anon, authenticated;
grant select on public.v_threads to service_role;

-- 3) messages → v_messages (bpd MESSAGE_COLUMNS)
create or replace view public.v_messages with (security_invoker = on) as
  select id, thread_id, lead_id, channel_id, direction, status, visibility, author,
         content, attachments, sent_at, received_at
  from public.messages;
revoke all on public.v_messages from anon, authenticated;
grant select on public.v_messages to service_role;

-- 4) qualifications → v_qualifications (bpd QUALIFICATION_COLUMNS)
create or replace view public.v_qualifications with (security_invoker = on) as
  select lead_id, grade, confidence, summary, recommended_next_action
  from public.qualifications;
revoke all on public.v_qualifications from anon, authenticated;
grant select on public.v_qualifications to service_role;

-- 5) channel_connections → v_channel_connections (bpd CHANNEL_CONNECTION_COLUMNS)
create or replace view public.v_channel_connections with (security_invoker = on) as
  select id, channel, account_label, owner_label, external_account_id, status, last_synced_at
  from public.channel_connections;
revoke all on public.v_channel_connections from anon, authenticated;
grant select on public.v_channel_connections to service_role;

-- 6) client_accounts → v_client_accounts (bpd CLIENT_ACCOUNT_COLUMNS)
create or replace view public.v_client_accounts with (security_invoker = on) as
  select id, name, country, industry, owner_name
  from public.client_accounts;
revoke all on public.v_client_accounts from anon, authenticated;
grant select on public.v_client_accounts to service_role;
