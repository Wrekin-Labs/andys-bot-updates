-- DeskRoute 6.1 RC: structured AI outcome observability.
-- Applied to production Supabase on 2026-10-03.

create table if not exists public.cxroute_ai_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id text not null,
  organisation_id uuid not null,
  brand_id uuid null,
  conversation_id uuid null,
  outcome text not null,
  failed_gate text null,
  retrieval_top_score numeric null,
  retrieval_margin numeric null,
  facts_returned integer not null default 0,
  used_fact_ids uuid[] not null default '{}',
  model text null,
  model_confidence numeric null,
  latency_retrieval_ms integer null,
  latency_llm_ms integer null,
  latency_total_ms integer null,
  tokens_in integer null,
  tokens_out integer null,
  cost_estimate_gbp numeric null,
  error_code text null
);

alter table public.cxroute_ai_events enable row level security;
revoke all on table public.cxroute_ai_events from public, anon;
grant select on table public.cxroute_ai_events to authenticated;
grant select, insert, update, delete on table public.cxroute_ai_events to service_role;

drop policy if exists cxroute_admins_read_ai_events on public.cxroute_ai_events;
create policy cxroute_admins_read_ai_events
on public.cxroute_ai_events
for select
to authenticated
using (
  exists (
    select 1
    from public.cxroute_org_members m
    where m.organisation_id = cxroute_ai_events.organisation_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  )
);

create index if not exists cxroute_ai_events_org_created_idx
  on public.cxroute_ai_events (organisation_id, created_at desc);
create index if not exists cxroute_ai_events_brand_created_idx
  on public.cxroute_ai_events (brand_id, created_at desc);
create index if not exists cxroute_ai_events_outcome_created_idx
  on public.cxroute_ai_events (outcome, created_at desc);
