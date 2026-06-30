-- 0026: v_threads 읽기뷰에 source_connection_id 노출 (append-only, 저위험)
--
-- 배경: threads.source_connection_id 는 0021 에서 추가돼 "이 대화가 어느 계정(channel_connection)으로
--   들어왔는지"를 이미 담고 있다. 하지만 bpd 가 읽는 v_threads(0023)가 이 컬럼을 노출하지 않아
--   화면에서 계정을 구분할 수 없었다. 한 채널에 여러 계정을 붙였을 때 "회사/개인" 같은 계정 라벨을
--   메신저·리드 패널에 보여주려면 이 컬럼이 필요하다.
--
-- 변경: 0023 의 v_threads 정의를 VERBATIM 복제하고 select 목록 ★맨 뒤에만★ source_connection_id 를
--   append 한다(0023 의 "새 컬럼은 끝에만 추가" 규칙 준수 — 기존 컬럼 순서·이름 불변이라 bpd 가 안 깨짐).
--   데이터 모양·자연키·RLS 변경 없음. create or replace 라 멱등.
--
-- bpd 는 v_channel_connections(account_label)를 이미 읽으므로, source_connection_id → account_label
--   매핑은 클라이언트 측 조인으로 처리한다(뷰는 fk 컬럼만 노출 = 최소 변경).

create or replace view public.v_threads with (security_invoker = on) as
  select id, workspace_id, client_id, lead_id, channel_id, channel_identity_id, title,
         status, priority, follow_up, last_message_at,
         updated_at,
         source_connection_id
  from public.threads;
revoke all on public.v_threads from anon, authenticated;
grant select on public.v_threads to service_role;
