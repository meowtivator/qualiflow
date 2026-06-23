-- PR2a (cloud-agent-split): 에이전트 페어링 — 서버측 데이터 모델 + 권한상승 함수.
--
-- 보안 설계(소유자 승인 완료):
--  - credential 2개: 페어링 코드(1회용·5분·사람 입력) / 에이전트 토큰(영구·키체인).
--  - 서버는 평문이 아니라 HMAC 해시만 저장(pepper는 웹 Node env에만, DB엔 해시만).
--  - /pair는 무인증이라 RLS 우회 권한이 필요한데, service-role 키를 웹에 두지 않으려고
--    딱 필요한 동작만 하는 SECURITY DEFINER 함수로만 권한을 준다(기존 create_workspace 패턴과 동일).
--
-- ⚠️ schema-contract 가드 회피: status/account_kind/auth_mode 등 가드가 보는 컬럼명+CHECK는 안 만든다.

-- 1) agents 토큰 컬럼(PR1에서 보안경계로 미뤄둔 것)
alter table public.agents
  add column if not exists token_hash text,        -- HMAC-SHA256(에이전트 토큰, pepper). 페어링 전엔 null
  add column if not exists paired_at timestamptz;  -- 페어링 완료 시각

create unique index if not exists agents_token_hash_idx
  on public.agents(token_hash) where token_hash is not null;

-- 2) 페어링 코드(단명·단일사용). 평문 코드는 저장하지 않는다 — code_hash만.
create table if not exists public.agent_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code_hash text not null,                          -- HMAC-SHA256(정규화한 코드, pepper)
  label text,                                       -- 페어링될 에이전트 이름
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,                          -- 단일사용 마커
  consumed_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists agent_pairing_codes_code_hash_idx
  on public.agent_pairing_codes(code_hash);
create index if not exists agent_pairing_codes_workspace_id_idx
  on public.agent_pairing_codes(workspace_id);

-- 3) /pair(무인증)의 IP 레이트리밋용 카운터(MVP: DB 카운터).
create table if not exists public.agent_pair_attempts (
  ip text primary key,
  attempt_count int not null default 0,
  window_started_at timestamptz not null default now()
);

-- RLS: 두 테이블 다 켜되 "정책 없음 = 일반 역할 접근 불가"(기본 deny). 접근은 아래 SECURITY DEFINER
-- 함수로만. 웹이 코드/시도 테이블을 직접 읽을 필요가 없다(발급 시 평문 1회 반환으로 충분).
alter table public.agent_pairing_codes enable row level security;
alter table public.agent_pair_attempts enable row level security;

-- 4) 발급 함수: 로그인 사용자가 호출(JWT). auth.uid()로 워크스페이스 확인 + 레이트리밋 + insert.
create or replace function public.issue_pairing_code(
  p_code_hash text,
  p_label text default null,
  p_ttl_seconds int default 300
)
returns table (pairing_id uuid, pairing_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  -- 호출자의 워크스페이스(멤버십). MVP는 1개.
  select wm.workspace_id into v_workspace_id
  from public.workspace_members wm
  where wm.user_id = auth.uid() and wm.revoked_at is null
  order by wm.created_at asc
  limit 1;

  if v_workspace_id is null then
    raise exception 'no workspace for user';
  end if;

  -- 레이트리밋: 최근 1시간 발급 5개 초과 금지.
  select count(*) into v_recent
  from public.agent_pairing_codes c
  where c.created_by = auth.uid()
    and c.created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'pairing code rate limit';
  end if;

  return query
  with inserted as (
    insert into public.agent_pairing_codes (workspace_id, code_hash, label, created_by, expires_at)
    values (
      v_workspace_id,
      p_code_hash,
      p_label,
      auth.uid(),
      now() + make_interval(secs => greatest(60, least(p_ttl_seconds, 900)))
    )
    returning id, expires_at
  )
  select inserted.id, inserted.expires_at from inserted;
end;
$$;

grant execute on function public.issue_pairing_code(text, text, int) to authenticated;

-- 5) 페어링 함수: 무인증(anon) 호출. IP 레이트리밋 + 코드 검증 + 에이전트 생성 + 코드 소비(원자적).
create or replace function public.pair_agent(
  p_code_hash text,
  p_token_hash text,
  p_label text default null,
  p_platform text default null,
  p_ip text default null
)
returns table (paired_agent_id uuid, paired_workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.agent_pairing_codes%rowtype;
  v_attempts int;
  v_agent_id uuid;
begin
  -- IP 레이트리밋: 10분 창에서 10회 초과 금지(성공/실패 모두 카운트).
  insert into public.agent_pair_attempts as a (ip, attempt_count, window_started_at)
  values (coalesce(nullif(p_ip, ''), 'unknown'), 1, now())
  on conflict (ip) do update
    set attempt_count = case
          when a.window_started_at < now() - interval '10 minutes' then 1
          else a.attempt_count + 1 end,
        window_started_at = case
          when a.window_started_at < now() - interval '10 minutes' then now()
          else a.window_started_at end
  returning a.attempt_count into v_attempts;

  if v_attempts > 10 then
    raise exception 'pairing rate limit';
  end if;

  -- 코드 조회(미만료·미사용). 행 잠금으로 동시 소비 방지.
  select * into v_code
  from public.agent_pairing_codes c
  where c.code_hash = p_code_hash
    and c.consumed_at is null
    and c.expires_at > now()
  for update;

  if not found then
    raise exception 'invalid or expired pairing code';
  end if;

  -- 에이전트 생성(코드의 workspace + 발급자에 귀속).
  insert into public.agents (workspace_id, owner_user_id, label, platform, token_hash, paired_at)
  values (
    v_code.workspace_id,
    v_code.created_by,
    coalesce(nullif(p_label, ''), v_code.label, 'agent'),
    p_platform,
    p_token_hash,
    now()
  )
  returning id into v_agent_id;

  -- 코드 소비(단일사용).
  update public.agent_pairing_codes
  set consumed_at = now(), consumed_by_agent_id = v_agent_id
  where id = v_code.id;

  return query select v_agent_id, v_code.workspace_id;
end;
$$;

grant execute on function public.pair_agent(text, text, text, text, text) to anon;
