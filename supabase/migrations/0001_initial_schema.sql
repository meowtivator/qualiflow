create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, user_id)
);

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  country text,
  industry text,
  owner_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.client_accounts(id) on delete set null,
  display_name text not null,
  company_name text,
  country_code text,
  country_name text,
  primary_email text,
  profile_image_url text,
  source_channel_ids text[] not null default '{}',
  lifecycle_stage text not null default 'new' check (
    lifecycle_stage in (
      'new',
      'contacted',
      'qualified',
      'sample_requested',
      'sample_sent',
      'negotiating',
      'won',
      'lost',
      'archived'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.client_accounts(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel_id text not null,
  external_thread_id text,
  title text,
  status text not null default 'open' check (status in ('open', 'pending', 'snoozed', 'resolved', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  last_message_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel_id text not null,
  external_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'sent' check (status in ('draft', 'queued', 'sent', 'delivered', 'read', 'failed')),
  visibility text not null default 'internal' check (visibility in ('internal', 'client_visible')),
  author jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.qualifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  grade text not null check (grade in ('A', 'B', 'C')),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  summary text not null,
  reasons text[] not null default '{}',
  missing_evidence text[] not null default '{}',
  recommended_next_action text,
  visibility text not null default 'internal' check (visibility in ('internal', 'client_shareable')),
  evaluated_by text not null default 'human' check (evaluated_by in ('human', 'model', 'rule')),
  evaluated_at timestamptz not null default now(),
  signals jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.draft_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider text not null default 'mock',
  model text,
  prompt_version text,
  draft_text text not null,
  status text not null default 'draft' check (status in ('draft', 'accepted', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members(workspace_id);
create index if not exists client_accounts_workspace_id_idx on public.client_accounts(workspace_id);
create index if not exists leads_workspace_id_idx on public.leads(workspace_id);
create index if not exists leads_client_id_idx on public.leads(client_id);
create index if not exists threads_workspace_id_idx on public.threads(workspace_id);
create index if not exists threads_lead_id_idx on public.threads(lead_id);
create index if not exists messages_thread_id_idx on public.messages(thread_id);
create index if not exists qualifications_lead_id_idx on public.qualifications(lead_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_client_accounts_updated_at on public.client_accounts;
create trigger set_client_accounts_updated_at
before update on public.client_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists set_threads_updated_at on public.threads;
create trigger set_threads_updated_at
before update on public.threads
for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.revoked_at is null
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin')
      and member.revoked_at is null
  );
$$;

create or replace function public.create_workspace(workspace_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text;
  generated_slug text;
  new_workspace public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  clean_name := nullif(trim(workspace_name), '');
  if clean_name is null then
    raise exception 'workspace name is required';
  end if;

  generated_slug := lower(regexp_replace(clean_name, '[^a-zA-Z0-9]+', '-', 'g'));
  generated_slug := trim(both '-' from generated_slug);
  generated_slug := coalesce(nullif(generated_slug, ''), 'workspace') || '-' || substr(gen_random_uuid()::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (clean_name, generated_slug)
  returning * into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace.id, auth.uid(), 'owner');

  return new_workspace;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.client_accounts enable row level security;
alter table public.leads enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.qualifications enable row level security;
alter table public.draft_suggestions enable row level security;

drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists "workspace members can read memberships" on public.workspace_members;
create policy "workspace members can read memberships"
on public.workspace_members for select
to authenticated
using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

drop policy if exists "workspace owners can manage memberships" on public.workspace_members;
create policy "workspace owners can manage memberships"
on public.workspace_members for all
to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace members can read client_accounts" on public.client_accounts;
create policy "workspace members can read client_accounts"
on public.client_accounts for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write client_accounts" on public.client_accounts;
create policy "workspace members can write client_accounts"
on public.client_accounts for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read leads" on public.leads;
create policy "workspace members can read leads"
on public.leads for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write leads" on public.leads;
create policy "workspace members can write leads"
on public.leads for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read threads" on public.threads;
create policy "workspace members can read threads"
on public.threads for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write threads" on public.threads;
create policy "workspace members can write threads"
on public.threads for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read messages" on public.messages;
create policy "workspace members can read messages"
on public.messages for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write messages" on public.messages;
create policy "workspace members can write messages"
on public.messages for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read qualifications" on public.qualifications;
create policy "workspace members can read qualifications"
on public.qualifications for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write qualifications" on public.qualifications;
create policy "workspace members can write qualifications"
on public.qualifications for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can read draft suggestions" on public.draft_suggestions;
create policy "workspace members can read draft suggestions"
on public.draft_suggestions for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members can write draft suggestions" on public.draft_suggestions;
create policy "workspace members can write draft suggestions"
on public.draft_suggestions for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
