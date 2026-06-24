-- 에이전트 인그est — 정규화된 대화를 DB에 저장한다(SYNC_ARCHITECTURE의 upsert 순서:
-- channel_connections → leads → channel_identities → threads → messages).
--
-- ★보안: 에이전트는 JWT가 없으므로 pair_agent/resolve_agent_by_token과 같은 SECURITY DEFINER 패턴.
--   workspace_id는 '클라이언트가 주는 값'이 아니라 토큰 해시로 함수가 직접 도출한다 → 남의 워크스페이스에
--   못 쓴다. 평문 토큰은 받지 않고 token_hash만 받는다.
-- ★멱등: messages는 (workspace_id, channel_id, external_message_id) 유니크로 ON CONFLICT DO NOTHING.
--   lead/identity/thread는 자연키(channel_identities 유니크, threads의 (ws,channel,external_thread_id))로 find-or-create.
-- 입력 p_conversations(jsonb 배열): [{ threadId, contact:{id,name,handle?}, messages:[{id,text,sentAt,direction}] }]

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

  -- 2) 채널 연결 find-or-update. ★channel_connections는 소유자(owner_user_id)별 '부분' 유니크(0005)라
  --    단순 ON CONFLICT가 안 맞는다 → (workspace, channel, label, owner) 기준 수동 처리. agent_id도 연결.
  select cc.id into v_conn_id
  from public.channel_connections cc
  where cc.workspace_id = v_workspace_id
    and cc.channel = p_channel
    and cc.account_label = p_account_label
    and cc.owner_user_id is not distinct from v_owner_user_id;

  if v_conn_id is null then
    insert into public.channel_connections
      (workspace_id, owner_user_id, agent_id, channel, account_label, status, last_synced_at)
    values (v_workspace_id, v_owner_user_id, v_agent_id, p_channel, p_account_label, 'active', now());
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
      continue; -- 연락처 식별자 없으면 건너뜀(데이터 보호)
    end if;

    -- 3a) channel_identity로 lead find-or-create.
    select ci.lead_id into v_lead_id
    from public.channel_identities ci
    where ci.workspace_id = v_workspace_id and ci.channel = p_channel and ci.external_id = v_external_id;

    if v_lead_id is null then
      insert into public.leads (workspace_id, display_name, source_channel_ids)
      values (v_workspace_id, coalesce(nullif(v_conv->'contact'->>'name', ''), '(이름 없음)'), array[p_channel])
      returning id into v_lead_id;
      v_leads := v_leads + 1;

      insert into public.channel_identities (workspace_id, lead_id, channel, external_id, handle, display_name)
      values (
        v_workspace_id, v_lead_id, p_channel, v_external_id,
        nullif(v_conv->'contact'->>'handle', ''),
        nullif(v_conv->'contact'->>'name', '')
      )
      on conflict (workspace_id, channel, external_id) do nothing;
    end if;

    -- 3b) thread find-or-create(자연키: workspace+channel+external_thread_id).
    v_thread_id := null;
    if v_thread_external is not null then
      select t.id into v_thread_id
      from public.threads t
      where t.workspace_id = v_workspace_id and t.channel_id = p_channel and t.external_thread_id = v_thread_external;
    end if;

    if v_thread_id is null then
      insert into public.threads (workspace_id, lead_id, channel_id, external_thread_id, title)
      values (v_workspace_id, v_lead_id, p_channel, v_thread_external, nullif(v_conv->'contact'->>'name', ''))
      returning id into v_thread_id;
      v_threads := v_threads + 1;
    end if;

    -- 3c) 메시지(멱등). external_message_id 있는 것만(없으면 중복 구분 불가라 건너뜀).
    for v_msg in select * from jsonb_array_elements(coalesce(v_conv->'messages', '[]'::jsonb))
    loop
      if nullif(v_msg->>'id', '') is null then
        continue;
      end if;
      insert into public.messages (
        workspace_id, thread_id, lead_id, channel_id, external_message_id, direction, content, sent_at
      )
      values (
        v_workspace_id, v_thread_id, v_lead_id, p_channel,
        v_msg->>'id',
        case when v_msg->>'direction' = 'outbound' then 'outbound' else 'inbound' end,
        jsonb_build_object('text', coalesce(v_msg->>'text', '')),
        coalesce((v_msg->>'sentAt')::timestamptz, now())
      )
      on conflict (workspace_id, channel_id, external_message_id) do nothing;
      if found then
        v_messages := v_messages + 1;
      end if;
    end loop;

    update public.threads set last_message_at = now(), updated_at = now() where id = v_thread_id;
  end loop;

  return query select v_leads, v_threads, v_messages;
end;
$$;

-- 에이전트 요청은 로그인 세션 없음 → anon(publishable) 키로 호출(pair_agent와 동일). 보안은 함수 내 토큰 검증.
grant execute on function public.ingest_conversations(text, text, text, jsonb) to anon;
