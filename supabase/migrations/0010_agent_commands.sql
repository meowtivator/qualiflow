-- agent_commands — 웹 → 에이전트 '명령 큐'(롱폴 채널). 발송 같은 동작을 웹이 적재하면 에이전트가 가져가 실행.
--
-- ★왜 DB 테이블 + 롱폴인가(평가 결론):
--   - 내구성: 에이전트가 오프라인이면 명령이 pending으로 대기하다 다음 폴에서 처리(메모리 큐는 유실).
--   - 보안모델 일관: 에이전트는 DB 직접 접근이 없고 토큰으로 VPS에만 붙는다 → SDF로만 claim/complete.
--     (Supabase Realtime은 에이전트가 DB에 직접 붙어야 해서 이 경계를 깬다 → 안 씀.)
--   - 평문 HTTPS 롱폴로 충분(WebSocket 서버 불필요). 규모(워크스페이스당 에이전트 소수, 명령 드묾)에 적합.
--   - 한계: 즉시 push가 아니라 폴 지연. 나중에 SSE로 바꿔도 클라만 손보면 됨(서버 계약 동일).

create table if not exists public.agent_commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,  -- 미래 멀티에이전트 타깃용(현재 nullable)
  type text not null check (type in ('send_message')),            -- 좁게 시작 → 나중에 'fetch_now' 등 확장
  payload jsonb not null default '{}'::jsonb,
  -- ★컬럼명 'state'(status 아님): schema-contract 검사기가 컬럼명 기반이라 channel_connections.status와
  --   충돌하지 않게 한다. 값은 동일 의미(pending/claimed/done/failed).
  state text not null default 'pending' check (state in ('pending', 'claimed', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
create index if not exists agent_commands_workspace_state_idx on public.agent_commands(workspace_id, state);

alter table public.agent_commands enable row level security;
-- 웹 사용자(JWT): 자기 워크스페이스 명령 적재/상태조회. 에이전트는 아래 SDF로만(JWT 없음).
create policy "workspace members can read agent_commands" on public.agent_commands
  for select using (public.is_workspace_member(workspace_id));
create policy "workspace members can write agent_commands" on public.agent_commands
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- 에이전트가 자기 워크스페이스의 pending 명령을 '원자적으로' claim한다.
-- ★FOR UPDATE SKIP LOCKED: 두 폴이 동시에 들어와도 같은 명령을 중복 claim/실행하지 않는다(발송 중복 방지).
create or replace function public.claim_agent_commands(p_token_hash text, p_limit int default 10)
returns setof public.agent_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select a.workspace_id into v_workspace_id
  from public.agents a
  where a.token_hash = p_token_hash and a.revoked_at is null;
  if v_workspace_id is null then
    raise exception 'invalid agent token';
  end if;

  return query
  update public.agent_commands c
     set state = 'claimed', claimed_at = now()
   where c.id in (
     select c2.id
     from public.agent_commands c2
     where c2.workspace_id = v_workspace_id and c2.state = 'pending'
     order by c2.created_at asc
     limit greatest(1, least(p_limit, 50))
     for update skip locked
   )
  returning c.*;
end;
$$;
grant execute on function public.claim_agent_commands(text, int) to anon;

-- 에이전트가 claim한 명령의 결과를 보고(done/failed). 토큰의 워크스페이스 + 'claimed' 상태인 것만.
-- ★stuck 'claimed'(에이전트가 claim 후 죽음)는 자동 재배정하지 않는다 — 발송 명령을 두 번 보내는 사고를
--   막기 위해 의도적으로. 막힌 건 사용자가 수동 재시도(claimed_at으로 관측 가능).
create or replace function public.complete_agent_command(
  p_token_hash text,
  p_command_id uuid,
  p_status text,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_updated int;
begin
  select a.workspace_id into v_workspace_id
  from public.agents a
  where a.token_hash = p_token_hash and a.revoked_at is null;
  if v_workspace_id is null then
    raise exception 'invalid agent token';
  end if;
  if p_status not in ('done', 'failed') then
    raise exception 'invalid status';
  end if;

  update public.agent_commands
     set state = p_status, result = p_result, completed_at = now()
   where id = p_command_id and workspace_id = v_workspace_id and state = 'claimed';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
grant execute on function public.complete_agent_command(text, uuid, text, jsonb) to anon;
