-- B4 진짜 계정 구분 — ingest가 "이 대화가 어느 계정(channel_connection)에서 왔는지"를 행에 기록한다.
--
-- 배경: 지금까지 ingest_conversations 는 토큰→워크스페이스→채널연결(v_conn_id)을 찾아
--       channel_connections 행만 갱신했고, 정작 그 대화로 만들어진 thread 에는
--       "어느 계정 연결에서 들어온 것인지"를 안 박았다. 같은 워크스페이스에 알리바바 계정이
--       둘 이상 연결되면(또는 여러 채널) thread 만 보고는 출처 계정을 알 수 없었다.
--
-- 결정(소유 경계 — 데이터 모델): 출처를 어디에 기록할지.
--   - 한 thread(대화)는 항상 정확히 하나의 채널 연결에서 온다 → 손실 없이 1:1.
--   - 반면 lead(연락처)는 여러 채널/계정에 걸칠 수 있어 단일 source 컬럼이면 정보가 뭉개진다.
--   따라서 "이 대화가 어느 계정에서 왔는지"는 thread 행에 기록한다(leads 아님).
--   (lead 단위 출처가 나중에 필요하면 별도 설계 — 지금은 요구 범위 밖이라 안 만든다.)
--
-- 이 마이그레이션이 하는 일:
--   (a) threads.source_connection_id uuid references channel_connections(id) 추가(없으면).
--       on delete set null — 연결이 삭제돼도 대화 자체는 남는다(출처만 비워짐).
--   (b) ingest_conversations 를 0018 본문 VERBATIM 복제 후, thread INSERT 1곳과
--       기존 thread 보정 UPDATE 1곳에 source_connection_id = v_conn_id 만 추가.
--       다른 동작(등급/주문/활동/lead_metadata 병합·last_message_at 등)은 일절 변경 없음.
--   (c) anon 재grant(CREATE OR REPLACE 는 grant 유지하지만 0018 패턴 그대로 명시 재부여).
--
-- ★적용은 부모/소유자가 한다(여기서는 SQL만 작성). 방어: 컬럼 없어도 안 깨지게 add column if not exists.

-- (a) 컬럼 추가 — 대화의 출처 계정 연결.
alter table public.threads
  add column if not exists source_connection_id uuid references public.channel_connections(id) on delete set null;

create index if not exists threads_source_connection_id_idx
  on public.threads(source_connection_id);

-- (b) 함수 재정의 — 0018 본문 VERBATIM + source_connection_id 2곳만 추가.
create or replace function public.ingest_conversations(
  p_token_hash text,
  p_channel text,
  p_account_label text,
  p_conversations jsonb
)
returns table (leads_created int, threads_created int, messages_created int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_workspace_id uuid;
  v_owner_user_id uuid;
  v_conn_id uuid;
  v_conv jsonb;
  v_msg jsonb;
  v_external_id text;
  v_lead_id uuid;
  v_thread_id uuid;
  v_thread_external text;
  v_leads int := 0;
  v_threads int := 0;
  v_messages int := 0;
begin
  -- 1) 토큰으로 에이전트/워크스페이스/소유자 도출(스푸핑 차단). 없으면 인증 실패.
  select a.id, a.workspace_id, a.owner_user_id
    into v_agent_id, v_workspace_id, v_owner_user_id
  from public.agents a
  where a.token_hash = p_token_hash and a.revoked_at is null;
  if v_workspace_id is null then
    raise exception 'invalid agent token';
  end if;

  -- 2) 채널 연결 find-or-update.
  select cc.id into v_conn_id
  from public.channel_connections cc
  where cc.workspace_id = v_workspace_id
    and cc.channel = p_channel
    and cc.account_label = p_account_label
    and cc.owner_user_id is not distinct from v_owner_user_id;

  if v_conn_id is null then
    insert into public.channel_connections
      (workspace_id, owner_user_id, agent_id, channel, account_label, status, last_synced_at)
    values (v_workspace_id, v_owner_user_id, v_agent_id, p_channel, p_account_label, 'active', now())
    returning id into v_conn_id;
  else
    update public.channel_connections
      set status = 'active', last_synced_at = now(), agent_id = coalesce(agent_id, v_agent_id), updated_at = now()
    where id = v_conn_id;
  end if;

  -- 3) 대화별 upsert.
  for v_conv in select * from jsonb_array_elements(coalesce(p_conversations, '[]'::jsonb))
  loop
    v_external_id := nullif(v_conv->'contact'->>'id', '');
    v_thread_external := nullif(v_conv->>'threadId', '');
    if v_external_id is null then
      continue;
    end if;

    -- 3a) channel_identity로 lead find-or-create. ★강화 필드(company/country/profileImage)를 함께 채운다.
    select ci.lead_id into v_lead_id
    from public.channel_identities ci
    where ci.workspace_id = v_workspace_id and ci.channel = p_channel and ci.external_id = v_external_id;

    if v_lead_id is null then
      insert into public.leads (workspace_id, display_name, company_name, country_code, profile_image_url, source_channel_ids, lead_metadata)
      values (
        v_workspace_id,
        coalesce(nullif(v_conv->'contact'->>'name', ''), '(이름 없음)'),
        nullif(v_conv->'contact'->>'companyName', ''),
        nullif(v_conv->'contact'->>'countryCode', ''),
        nullif(v_conv->'contact'->>'profileImageUrl', ''),
        array[p_channel],
        coalesce(v_conv->'contact'->'metadata', '{}'::jsonb)
      )
      returning id into v_lead_id;
      v_leads := v_leads + 1;

      insert into public.channel_identities
        (workspace_id, lead_id, channel, external_id, handle, display_name, profile_image_url)
      values (
        v_workspace_id, v_lead_id, p_channel, v_external_id,
        nullif(v_conv->'contact'->>'handle', ''),
        nullif(v_conv->'contact'->>'name', ''),
        nullif(v_conv->'contact'->>'profileImageUrl', '')
      )
      on conflict (workspace_id, channel, external_id) do nothing;
    end if;

    -- 3a') 기존 lead라도 강화 필드가 새로 들어오면 채운다(없으면 기존 유지).
    update public.leads set
      company_name = coalesce(nullif(v_conv->'contact'->>'companyName', ''), company_name),
      country_code = coalesce(nullif(v_conv->'contact'->>'countryCode', ''), country_code),
      profile_image_url = coalesce(nullif(v_conv->'contact'->>'profileImageUrl', ''), profile_image_url),
      lead_metadata = coalesce(public.leads.lead_metadata, '{}'::jsonb) || coalesce(v_conv->'contact'->'metadata', '{}'::jsonb),
      updated_at = now()
    where id = v_lead_id;

    -- 3b) thread find-or-create(자연키: workspace+channel+external_thread_id).
    v_thread_id := null;
    if v_thread_external is not null then
      select t.id into v_thread_id
      from public.threads t
      where t.workspace_id = v_workspace_id and t.channel_id = p_channel and t.external_thread_id = v_thread_external;
    end if;

    if v_thread_id is null then
      insert into public.threads (workspace_id, lead_id, channel_id, external_thread_id, title, source_connection_id)
      values (v_workspace_id, v_lead_id, p_channel, v_thread_external, nullif(v_conv->'contact'->>'name', ''), v_conn_id)
      returning id into v_thread_id;
      v_threads := v_threads + 1;
    else
      -- ★B4: 기존 thread 라도 출처 계정 연결이 비어 있으면 채운다(이미 있으면 그대로 둔다).
      update public.threads set source_connection_id = coalesce(source_connection_id, v_conn_id)
      where id = v_thread_id;
    end if;

    -- 3c) 메시지(멱등) — author + attachments(0011/0012와 동일).
    for v_msg in select * from jsonb_array_elements(coalesce(v_conv->'messages', '[]'::jsonb))
    loop
      if nullif(v_msg->>'id', '') is null then
        continue;
      end if;
      insert into public.messages (
        workspace_id, thread_id, lead_id, channel_id, external_message_id, direction, author, content, attachments, sent_at
      )
      values (
        v_workspace_id, v_thread_id, v_lead_id, p_channel,
        v_msg->>'id',
        case when v_msg->>'direction' = 'outbound' then 'outbound' else 'inbound' end,
        case
          when v_msg->>'direction' = 'outbound'
            then jsonb_build_object('role', 'operator')
          else jsonb_build_object(
                 'role', 'lead',
                 'displayName', coalesce(nullif(v_conv->'contact'->>'name', ''), '(이름 없음)')
               )
        end,
        jsonb_build_object('text', coalesce(v_msg->>'text', '')),
        case when jsonb_typeof(v_msg->'attachments') = 'array' then v_msg->'attachments' else '[]'::jsonb end,
        coalesce(public.safe_timestamptz(v_msg->>'sentAt'), now())
      )
      on conflict (workspace_id, channel_id, external_message_id) do nothing;
      if found then
        v_messages := v_messages + 1;
      end if;
    end loop;

    -- ★FIX: last_message_at 을 ingest 시각(now())이 아니라 그 스레드의 실제 마지막 메시지
    --        sent_at 으로 설정한다(메시지 없으면 now() 폴백).
    update public.threads set
      last_message_at = coalesce(
        (select max(m.sent_at) from public.messages m where m.thread_id = v_thread_id),
        now()
      ),
      updated_at = now()
    where id = v_thread_id;
  end loop;

  return query select v_leads, v_threads, v_messages;
end;
$$;

-- (c) anon 재grant(0018 패턴 그대로).
grant execute on function public.ingest_conversations(text, text, text, jsonb) to anon;
