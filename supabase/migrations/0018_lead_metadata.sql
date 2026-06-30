-- 알리바바 enrichment(등급/SNS 등)를 leads.lead_metadata jsonb 한 칸에 모은다(소유자 결정).
--   (1) leads에 lead_metadata jsonb 컬럼 추가(없으면). 기본값 '{}'.
--   (2) ingest_conversations(0017 본문 그대로) 에서 lead INSERT/UPDATE 두 곳만 손봐
--       contact.metadata 를 lead_metadata 로 흘려보낸다(기존 키는 유지하고 새 키만 병합).
-- ★0017 함수 전체를 VERBATIM 복제하되, lead_metadata 관련 2줄만 추가한다(CREATE OR REPLACE).
--   (last_message_at = max(sent_at) 수정은 0017 그대로 유지. 백필은 0018에 불필요 — 함수+ALTER만.)

alter table public.leads add column if not exists lead_metadata jsonb not null default '{}'::jsonb;

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
      insert into public.threads (workspace_id, lead_id, channel_id, external_thread_id, title)
      values (v_workspace_id, v_lead_id, p_channel, v_thread_external, nullif(v_conv->'contact'->>'name', ''))
      returning id into v_thread_id;
      v_threads := v_threads + 1;
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

grant execute on function public.ingest_conversations(text, text, text, jsonb) to anon;
