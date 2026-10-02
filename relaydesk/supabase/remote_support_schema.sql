-- RelayDesk control-plane proposal only. Review before applying.
-- Session content and encryption keys must never be stored here.

create extension if not exists pgcrypto;

create table if not exists public.relaydesk_devices (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  platform text not null default 'windows',
  signing_public_key text not null,
  unattended_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists relaydesk_devices_owner_idx
  on public.relaydesk_devices(owner_user_id, revoked_at);

create table if not exists public.relaydesk_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  device_id uuid not null references public.relaydesk_devices(id) on delete cascade,
  helper_user_id uuid,
  mode text not null default 'attended' check (mode in ('attended','unattended')),
  state text not null check (state in ('waiting','requested','accepted','active','ended','denied','expired','failed')),
  requested_permissions text[] not null default array['view']::text[],
  granted_permissions text[] not null default array[]::text[],
  invite_digest text,
  transport text check (transport is null or transport in ('direct','relay')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists relaydesk_sessions_owner_created_idx
  on public.relaydesk_sessions(owner_user_id, created_at desc);
create index if not exists relaydesk_sessions_device_state_idx
  on public.relaydesk_sessions(device_id, state);

create table if not exists public.relaydesk_audit (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null,
  device_id uuid references public.relaydesk_devices(id) on delete set null,
  session_id uuid references public.relaydesk_sessions(id) on delete set null,
  actor_user_id uuid,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists relaydesk_audit_owner_created_idx
  on public.relaydesk_audit(owner_user_id, created_at desc);

alter table public.relaydesk_devices enable row level security;
alter table public.relaydesk_sessions enable row level security;
alter table public.relaydesk_audit enable row level security;

-- Project Relay Edge Functions/service code should mediate access in the first release.
revoke all on public.relaydesk_devices from anon, authenticated;
revoke all on public.relaydesk_sessions from anon, authenticated;
revoke all on public.relaydesk_audit from anon, authenticated;
