-- 0025: ingest_conversations — 기존 lead의 display_name도 '업그레이드'한다.
--
-- 배경: 0021까지 ingest는 신규 lead INSERT 시에만 display_name을 채우고, 기존 lead는
--   company/country/profileImage만 갱신하고 display_name은 절대 안 건드렸다. 그래서 한 번
--   숫자(예: WhatsApp @lid 번호)로 들어간 바이어는 나중에 더 좋은 이름(전화번호/사람이름)이
--   들어와도 영원히 숫자로 남았다.
--
-- 변경: 기존 lead 갱신(3a') 블록에 display_name 한 줄을 추가한다. 단 ★'진짜 사람 이름'은
--   보존하고, 기존 값이 NULL·'(이름 없음)'·순수 숫자·채널 식별자였을 때만 교체한다(아래 case).
--   → 새 이름이 비어 있으면 건드리지 않으므로 다운그레이드 위험 없음. 포맷된 전화번호
--      (예: "+46 70 420 30 66 🇸🇪")는 순수 숫자가 아니라 한 번 박히면 안정적.
--
-- ⚠️ 비즈니스 규칙(소유자 확인 필요): "기존 이름 교체 조건"은 임의로 정한 판정이다.
--    CRM에서 사용자가 display_name을 손수 편집하는 기능이 생기면, 그 편집을 ingest가
--    덮지 않도록 '사용자 편집 잠금' 플래그를 추가하는 설계가 더 안전하다(후속 과제).
--
-- 멱등/안전: CREATE OR REPLACE로 함수 본문만 교체. 테이블/컬럼/RLS 변경 없음. 0021과
--    바이트 동일하며 3a' 블록의 display_name 한 절만 추가됨.

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
      -- ★display_name 업그레이드(0025): 기존 이름이 '진짜 사람 이름'이 아니었을 때만 새 이름으로 교체.
      --   교체 대상 = NULL / '(이름 없음)' 플레이스홀더 / 순수 숫자(옛 lid·번호) / 채널 식별자 그대로.
      --   사람 이름·CRM에서 사용자가 손수 고친 이름은 보존. 새 이름이 비면 그대로 둔다.
      display_name = case
        when coalesce(nullif(v_conv->'contact'->>'name', ''), '') = '' then public.leads.display_name
        when public.leads.display_name is null
          or public.leads.display_name = '(이름 없음)'
          or public.leads.display_name ~ '^[0-9]+$'
          or public.leads.display_name = v_external_id
        then nullif(v_conv->'contact'->>'name', '')
        else public.leads.display_name
      end,
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
