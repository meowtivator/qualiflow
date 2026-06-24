insert into public.workspaces (id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'QualiFlow Demo', 'qualiflow-demo')
on conflict (id) do update
set name = excluded.name,
    slug = excluded.slug;

insert into public.client_accounts (id, workspace_id, name, country, industry, owner_name, notes)
values
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'AESTHEIN',
    'KR',
    'Beauty',
    'Demo Operator',
    'Demo client for local Supabase verification.'
  )
on conflict (id) do update
set name = excluded.name,
    country = excluded.country,
    industry = excluded.industry,
    owner_name = excluded.owner_name,
    notes = excluded.notes;

insert into public.leads (
  id,
  workspace_id,
  client_id,
  display_name,
  company_name,
  country_code,
  country_name,
  primary_email,
  source_channel_ids,
  stage,
  metadata
)
values
  (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    'Olivia Grant',
    'Harbor Beauty Imports',
    'US',
    'United States',
    'olivia@example.com',
    array['alibaba', 'instagram'],
    'sal',
    '{"alibabaPurchaseGrade":"L3","website":"https://example.com"}'
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    'Patrick Wong',
    'Mirae Beauty HK',
    'HK',
    'Hong Kong',
    'patrick@example.com',
    array['instagram'],
    'mql',
    '{"alibabaPurchaseGrade":"L2"}'
  )
on conflict (id) do update
set display_name = excluded.display_name,
    company_name = excluded.company_name,
    country_code = excluded.country_code,
    country_name = excluded.country_name,
    primary_email = excluded.primary_email,
    source_channel_ids = excluded.source_channel_ids,
    stage = excluded.stage,
    metadata = excluded.metadata;

insert into public.threads (
  id,
  workspace_id,
  client_id,
  lead_id,
  channel_id,
  external_thread_id,
  title,
  status,
  priority,
  last_message_at,
  metadata
)
values
  (
    '00000000-0000-4000-8000-000000002001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000001001',
    'alibaba',
    'demo-thread-1',
    'Clinic line sample inquiry',
    'open',
    'high',
    '2026-05-18T09:00:00Z',
    '{"source":"seed"}'
  ),
  (
    '00000000-0000-4000-8000-000000002002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000001002',
    'instagram',
    'demo-thread-2',
    'Mask pack sample request',
    'pending',
    'normal',
    '2026-05-16T07:00:00Z',
    '{"source":"seed"}'
  )
on conflict (id) do update
set channel_id = excluded.channel_id,
    title = excluded.title,
    status = excluded.status,
    priority = excluded.priority,
    last_message_at = excluded.last_message_at,
    metadata = excluded.metadata;

insert into public.messages (
  id,
  workspace_id,
  thread_id,
  lead_id,
  channel_id,
  external_message_id,
  direction,
  status,
  visibility,
  author,
  content,
  sent_at,
  received_at,
  metadata
)
values
  (
    '00000000-0000-4000-8000-000000003001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000002001',
    '00000000-0000-4000-8000-000000001001',
    'alibaba',
    'demo-message-1',
    'inbound',
    'read',
    'client_visible',
    '{"displayName":"Olivia Grant","role":"lead"}',
    '{"type":"text","text":"We are looking for clinic skincare samples for a US distributor test order."}',
    '2026-05-18T09:00:00Z',
    '2026-05-18T09:00:00Z',
    '{"source":"seed"}'
  ),
  (
    '00000000-0000-4000-8000-000000003002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000002001',
    '00000000-0000-4000-8000-000000001001',
    'alibaba',
    'demo-message-2',
    'outbound',
    'sent',
    'internal',
    '{"displayName":"Demo Operator","role":"operator"}',
    '{"type":"text","text":"Thank you for your inquiry. We can prepare sample options and MOQ details."}',
    '2026-05-18T10:00:00Z',
    null,
    '{"source":"seed"}'
  )
on conflict (id) do update
set status = excluded.status,
    visibility = excluded.visibility,
    author = excluded.author,
    content = excluded.content,
    sent_at = excluded.sent_at,
    received_at = excluded.received_at,
    metadata = excluded.metadata;

insert into public.qualifications (
  id,
  workspace_id,
  lead_id,
  grade,
  confidence,
  summary,
  reasons,
  missing_evidence,
  recommended_next_action,
  visibility,
  evaluated_by,
  evaluated_at,
  signals,
  metadata
)
values
  (
    '00000000-0000-4000-8000-000000004001',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000001001',
    'A',
    'high',
    'US beauty distributor asked for clinic skincare samples.',
    array['Beauty distributor context', 'Sample request exists', 'Alibaba L3 recorded as purchase grade only'],
    array['Final shipping address'],
    'Prepare sample proposal and confirm MOQ.',
    'client_shareable',
    'human',
    '2026-05-18T10:30:00Z',
    '[{"id":"00000000-0000-4000-8000-000000005001","leadId":"00000000-0000-4000-8000-000000001001","source":"alibaba","key":"sample_request","value":true,"observedAt":"2026-05-18T09:00:00Z"}]',
    '{"source":"seed"}'
  ),
  (
    '00000000-0000-4000-8000-000000004002',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000001002',
    'A',
    'medium',
    'Hong Kong beauty shop asked about mask pack samples.',
    array['Beauty shop context', 'Sample request exists'],
    array['Business website or store URL'],
    'Ask for store URL before sharing with client.',
    'internal',
    'human',
    '2026-05-16T08:00:00Z',
    '[]',
    '{"source":"seed"}'
  )
on conflict (lead_id) do update
set grade = excluded.grade,
    confidence = excluded.confidence,
    summary = excluded.summary,
    reasons = excluded.reasons,
    missing_evidence = excluded.missing_evidence,
    recommended_next_action = excluded.recommended_next_action,
    visibility = excluded.visibility,
    evaluated_by = excluded.evaluated_by,
    evaluated_at = excluded.evaluated_at,
    signals = excluded.signals,
    metadata = excluded.metadata;

-- Local verification helper:
-- Once an auth user exists, the app can create a private workspace through
-- public.create_workspace(). The seeded demo workspace is intentionally not
-- assigned to every user because RLS should stay conservative by default.
