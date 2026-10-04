-- DeskRoute commercial plan catalog (sandbox-first).
-- Stripe live price/link columns remain null until live products are approved and created.

alter table public.cxroute_plans
  add column if not exists monthly_price_pence integer check (monthly_price_pence is null or monthly_price_pence >= 0),
  add column if not exists currency text not null default 'gbp',
  add column if not exists stripe_test_price_id text,
  add column if not exists stripe_test_payment_link text,
  add column if not exists stripe_live_price_id text,
  add column if not exists stripe_live_payment_link text;

insert into public.cxroute_plans
(code,name,active,seat_limit,brand_limit,monthly_conversation_limit,monthly_ai_draft_limit,monthly_ai_call_limit,features,monthly_price_pence,currency,stripe_test_price_id,stripe_test_payment_link,updated_at)
values
('starter','Starter',true,3,1,500,500,2000,
 '{"widget":true,"knowledge":true,"grounded_ai":true,"analytics":true,"automations":true,"teams":true,"attachments":true,"privacy_tools":true}'::jsonb,
 1900,'gbp','price_1UMr6VAa3lMEDRWLDpP0gXnt','https://buy.stripe.com/test_9B6eVcb7N0eG9oMfGY1wY00',now()),
('growth','Growth',true,10,3,2500,2500,10000,
 '{"widget":true,"knowledge":true,"grounded_ai":true,"analytics":true,"automations":true,"teams":true,"attachments":true,"privacy_tools":true,"email":true,"cms_integrations":true}'::jsonb,
 4900,'gbp','price_1UMr6dAa3lMEDRWLwD1hKNNs','https://buy.stripe.com/test_bJe28q1xdd1s9oM1Q81wY01',now()),
('pro','Pro',true,25,10,10000,10000,30000,
 '{"widget":true,"knowledge":true,"grounded_ai":true,"analytics":true,"automations":true,"teams":true,"attachments":true,"privacy_tools":true,"email":true,"cms_integrations":true,"priority_support":true,"advanced_controls":true}'::jsonb,
 9900,'gbp','price_1UMr6fAa3lMEDRWLOXgf7ajs','https://buy.stripe.com/test_5kQfZg4Jpd1s7gE52k1wY02',now())
on conflict (code) do update set
 name=excluded.name,active=excluded.active,seat_limit=excluded.seat_limit,brand_limit=excluded.brand_limit,
 monthly_conversation_limit=excluded.monthly_conversation_limit,monthly_ai_draft_limit=excluded.monthly_ai_draft_limit,
 monthly_ai_call_limit=excluded.monthly_ai_call_limit,features=excluded.features,monthly_price_pence=excluded.monthly_price_pence,
 currency=excluded.currency,stripe_test_price_id=excluded.stripe_test_price_id,
 stripe_test_payment_link=excluded.stripe_test_payment_link,updated_at=now();

create table if not exists public.cxroute_billing_events(
  event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  processed_at timestamptz not null default now(),
  safe_metadata jsonb not null default '{}'::jsonb
);
alter table public.cxroute_billing_events enable row level security;
revoke all on table public.cxroute_billing_events from anon,authenticated;
grant select,insert,update,delete on table public.cxroute_billing_events to service_role;

create or replace function public.cxroute_billing_get_secret(p_name text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare v text;
begin
  if p_name not in ('deskroute-stripe-test-webhook-secret','deskroute-stripe-live-webhook-secret') then
    raise exception 'Secret not allowed';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name=p_name limit 1;
  return v;
end;
$$;
revoke all on function public.cxroute_billing_get_secret(text) from public,anon,authenticated;
grant execute on function public.cxroute_billing_get_secret(text) to service_role;
