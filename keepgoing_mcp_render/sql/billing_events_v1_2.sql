-- KeepGoing billing webhook replay and ordering protection.
-- Source migration only: apply through the reviewed production Supabase migration workflow.

create table if not exists public.keepgoing_billing_events (
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  event_created_at timestamptz,
  object_id text,
  payload_sha256 text,
  status text not null default 'received'
    check (status in ('received','processing','processed','ignored_stale','failed')),
  processed_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

alter table public.keepgoing_billing_events enable row level security;
revoke all on table public.keepgoing_billing_events from public, anon, authenticated;
grant select, insert, update, delete on table public.keepgoing_billing_events to service_role;

alter table public.keepgoing_subscriptions
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists last_provider_event_id text;

create index if not exists keepgoing_billing_events_created_idx
  on public.keepgoing_billing_events (created_at);

create index if not exists keepgoing_subscriptions_provider_event_idx
  on public.keepgoing_subscriptions (payment_provider, provider_subscription_id, last_provider_event_at);

comment on table public.keepgoing_billing_events is
  'Private idempotency/audit ledger for verified KeepGoing payment webhooks. Raw payment payloads are not retained.';

create or replace function public.claim_keepgoing_billing_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_object_id text,
  p_payload_sha256 text,
  p_detail jsonb default '{}'::jsonb
)
returns table (
  claimed boolean,
  event_status text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if nullif(trim(p_provider), '') is null
     or nullif(trim(p_provider_event_id), '') is null
     or nullif(trim(p_event_type), '') is null then
    raise exception 'provider, provider_event_id and event_type are required';
  end if;

  insert into public.keepgoing_billing_events (
    provider, provider_event_id, event_type, event_created_at,
    object_id, payload_sha256, status, detail
  )
  values (
    lower(trim(p_provider)), trim(p_provider_event_id), trim(p_event_type),
    p_event_created_at, nullif(trim(p_object_id), ''),
    nullif(trim(p_payload_sha256), ''), 'received', coalesce(p_detail, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing;

  update public.keepgoing_billing_events
  set status = 'processing'
  where provider = lower(trim(p_provider))
    and provider_event_id = trim(p_provider_event_id)
    and status in ('received','failed')
  returning status into v_status;

  if found then
    return query select true, 'processing'::text;
    return;
  end if;

  select status into v_status
  from public.keepgoing_billing_events
  where provider = lower(trim(p_provider))
    and provider_event_id = trim(p_provider_event_id);

  return query select false, coalesce(v_status, 'unknown');
end;
$$;

revoke all on function public.claim_keepgoing_billing_event(
  text, text, text, timestamptz, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.claim_keepgoing_billing_event(
  text, text, text, timestamptz, text, text, jsonb
) to service_role;

create or replace function public.finish_keepgoing_billing_event(
  p_provider text,
  p_provider_event_id text,
  p_status text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('processed','ignored_stale','failed') then
    raise exception 'invalid terminal billing event status';
  end if;

  update public.keepgoing_billing_events
  set status = p_status,
      processed_at = case when p_status in ('processed','ignored_stale') then now() else null end,
      detail = coalesce(p_detail, '{}'::jsonb)
  where provider = lower(trim(p_provider))
    and provider_event_id = trim(p_provider_event_id);
end;
$$;

revoke all on function public.finish_keepgoing_billing_event(
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_keepgoing_billing_event(
  text, text, text, jsonb
) to service_role;
