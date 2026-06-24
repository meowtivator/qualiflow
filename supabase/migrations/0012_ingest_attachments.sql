-- ingest_conversations에 '미디어 첨부(attachments)' 저장을 추가한다.
-- ★0011_message_author 바로 위에 쌓는다(그 author 로직을 그대로 유지하면서 attachments만 더한다).
--   CREATE OR REPLACE는 함수 '전체'를 교체하므로, 0011의 author 처리를 여기 그대로 포함해야 둘 다 살아남는다.
-- ★변경점은 단 하나 — "3c) 메시지" insert에 attachments 컬럼을 추가한 것뿐:
--   각 메시지의 v_msg->'attachments'(jsonb 배열, core MessageAttachment[] 모양)를 messages.attachments에 저장.
--   배열이 아니면(누락/구버전 페이로드) '[]'로 둔다 → 텍스트-only 푸시는 동작이 안 바뀐다(하위호환).
-- ★데이터 모델: messages.attachments 컬럼은 0001에 이미 존재(기본 '[]'). 컬럼 변경 없음, 함수만 갱신.
-- 입력 p_conversations: [{ threadId, contact:{id,name,handle?}, messages:[{id,text,sentAt,direction, attachments?}] }]

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
        workspace_id, thread_id, lead_id, channel_id, external_message_id, direction, author, content, attachments, sent_at
      )
      values (
        v_workspace_id, v_thread_id, v_lead_id, p_channel,
        v_msg->>'id',
        case when v_msg->>'direction' = 'outbound' then 'outbound' else 'inbound' end,
        -- author(0011과 동일): inbound=상대(lead) 이름 / outbound=운영자(이름 없음→reader 폴백).
        case
          when v_msg->>'direction' = 'outbound'
            then jsonb_build_object('role', 'operator')
          else jsonb_build_object(
                 'role', 'lead',
                 'displayName', coalesce(nullif(v_conv->'contact'->>'name', ''), '(이름 없음)')
               )
        end,
        jsonb_build_object('text', coalesce(v_msg->>'text', '')),
        -- ★추가: 미디어 첨부. 배열이면 그대로, 아니면 '[]'(텍스트-only 하위호환).
        case when jsonb_typeof(v_msg->'attachments') = 'array' then v_msg->'attachments' else '[]'::jsonb end,
        coalesce(public.safe_timestamptz(v_msg->>'sentAt'), now())
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

-- CREATE OR REPLACE는 기존 권한을 보존하지만, 명시적으로 재부여(anon 호출 — 보안은 함수 내 토큰 검증).
grant execute on function public.ingest_conversations(text, text, text, jsonb) to anon;
