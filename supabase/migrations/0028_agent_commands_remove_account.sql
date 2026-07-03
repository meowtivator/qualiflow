-- 0028: agent_commands.type 화이트리스트에 'remove_account' 추가 (데이터모델 소유 경계 — 소유자 검토 필요)
--
-- 배경: 0010 에서 agent_commands.type 은 CHECK (type in ('send_message')) 로 좁게 열려 있다.
--   웹(bpd)의 '연결 계정 삭제' 기능은 이 큐에 {type:'remove_account', payload:{channel, accountLabel}} 를
--   적재하고, 로컬 에이전트(qf serve)가 가져가 removeAccount(channel,label)로 세션·데이터를 지운다.
--   지금 CHECK 는 'remove_account' 를 거부하므로 INSERT 가 막힌다 → 이 마이그레이션 없이는 삭제 큐잉 불가.
--
-- 변경: CHECK 제약을 재정의해 'remove_account' 를 허용값에 추가한다. 값 목록만 넓히는 append 변경이라
--   기존 'send_message' 행/동작은 그대로다. 데이터 모양(컬럼)·RLS·SDF 는 건드리지 않는다.
--   (claim_agent_commands / complete_agent_command 는 type 을 필터하지 않으므로 코드 변경 불필요.)
--
-- ⚠️ 소유 경계(AGENTS.md '데이터 모델'): 이 파일은 제안이다. supabase db push 는 소유자가 검토 후 직접.
--   에이전트는 이 파일을 적용하지 않았다.

alter table public.agent_commands drop constraint if exists agent_commands_type_check;
alter table public.agent_commands
  add constraint agent_commands_type_check check (type in ('send_message', 'remove_account'));
