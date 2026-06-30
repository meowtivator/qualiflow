-- 0023: 0022 read-view 교정 — bpd 가 select 외에 filter(.eq)·order(.order)에 쓰는 컬럼까지
--   뷰가 노출해야 안 깨진다(예: listLeads 는 order("updated_at"), 여러 reader 가 조건부
--   eq("workspace_id")). 0022 는 select 컬럼만 노출해 그대로 전환하면 PostgREST 가 "뷰에 없는
--   컬럼으로 filter/order" 라 실패한다. 실재 확인된 컬럼(updated_at, workspace_id)만 끝에 append.
-- ★CREATE OR REPLACE VIEW 규칙: 기존 컬럼 순서 유지 + 새 컬럼은 '맨 뒤에만' 추가 가능.
-- ★보안: 0022 와 동일(security_invoker=on + revoke anon/authenticated + grant service_role).
--   grant 는 REPLACE 로 보존되지만 명시적으로 재선언한다.

-- v_leads: + updated_at (order 용)
create or replace view public.v_leads with (security_invoker = on) as
  select id, workspace_id, client_id, display_name, company_name, country_code, country_name,
         primary_email, profile_image_url, stage, sub_stage, source_channel_ids, lead_metadata,
         updated_at
  from public.leads;
revoke all on public.v_leads from anon, authenticated;
grant select on public.v_leads to service_role;

-- v_threads: + updated_at (향후 order 대비; workspace_id 는 이미 노출됨)
create or replace view public.v_threads with (security_invoker = on) as
  select id, workspace_id, client_id, lead_id, channel_id, channel_identity_id, title,
         status, priority, follow_up, last_message_at,
         updated_at
  from public.threads;
revoke all on public.v_threads from anon, authenticated;
grant select on public.v_threads to service_role;

-- v_messages: + workspace_id (조건부 eq 용)
create or replace view public.v_messages with (security_invoker = on) as
  select id, thread_id, lead_id, channel_id, direction, status, visibility, author,
         content, attachments, sent_at, received_at,
         workspace_id
  from public.messages;
revoke all on public.v_messages from anon, authenticated;
grant select on public.v_messages to service_role;

-- v_qualifications: + workspace_id (조건부 eq 용)
create or replace view public.v_qualifications with (security_invoker = on) as
  select lead_id, grade, confidence, summary, recommended_next_action,
         workspace_id
  from public.qualifications;
revoke all on public.v_qualifications from anon, authenticated;
grant select on public.v_qualifications to service_role;

-- v_channel_connections: + workspace_id (조건부 eq 용)
create or replace view public.v_channel_connections with (security_invoker = on) as
  select id, channel, account_label, owner_label, external_account_id, status, last_synced_at,
         workspace_id
  from public.channel_connections;
revoke all on public.v_channel_connections from anon, authenticated;
grant select on public.v_channel_connections to service_role;

-- v_client_accounts: + workspace_id (조건부 eq 용)
create or replace view public.v_client_accounts with (security_invoker = on) as
  select id, name, country, industry, owner_name,
         workspace_id
  from public.client_accounts;
revoke all on public.v_client_accounts from anon, authenticated;
grant select on public.v_client_accounts to service_role;
