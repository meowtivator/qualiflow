-- 채널 연결 ownership 확장.
-- 한 workspace 안에서 여러 사용자가 같은 채널에 각자 여러 계정을 연결할 수 있게 한다.
-- 세션 본문은 DB에 저장하지 않고, session_ref에는 runtime/secret-store 포인터만 둔다.

alter table public.channel_connections
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists owner_label text,
  add column if not exists account_kind text not null default 'user_account'
    check (account_kind in ('user_account', 'business_account', 'bot', 'manual')),
  add column if not exists auth_mode text not null default 'browser_session'
    check (auth_mode in ('browser_session', 'phone_code', 'qr_pairing', 'oauth', 'api_token', 'manual')),
  add column if not exists capabilities text[] not null default '{}'::text[],
  add column if not exists session_ref text;

alter table public.channel_connections
  drop constraint if exists channel_connections_workspace_id_channel_account_label_key;

create index if not exists channel_connections_owner_user_id_idx
on public.channel_connections(owner_user_id);

create index if not exists channel_connections_workspace_channel_idx
on public.channel_connections(workspace_id, channel);

create unique index if not exists channel_connections_workspace_channel_owner_label_idx
on public.channel_connections(workspace_id, channel, owner_user_id, account_label)
where owner_user_id is not null;

create unique index if not exists channel_connections_workspace_channel_label_null_owner_idx
on public.channel_connections(workspace_id, channel, account_label)
where owner_user_id is null;
