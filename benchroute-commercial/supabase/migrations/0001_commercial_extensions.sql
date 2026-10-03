-- BenchRoute commercial extensions.
-- DRAFT ONLY: do not apply to the live ERUK project.
-- Intended for a dedicated BenchRoute beta Supabase project after the required
-- ERA core tables/functions have been ported and tenant-isolation tests exist.

create table if not exists public.br_plans (
  id text primary key,
  name text not null,
  monthly_price_gbp numeric(10,2),
  staff_limit integer,
  location_limit integer,
  ai_allowance integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.br_shop_settings (
  shop_id uuid primary key references public.era_shops(id) on delete cascade,
  legal_name text,
  trading_name text,
  logo_url text,
  accent_colour text,
  currency text not null default 'GBP',
  tax_mode text not null default 'not_vat_registered'
    check (tax_mode in ('not_vat_registered','vat_registered')),
  vat_number text,
  default_diagnostic_fee numeric(10,2) not null default 0,
  default_labour_rate numeric(10,2) not null default 0,
  quote_valid_days integer not null default 14,
  job_prefix text not null default 'BR',
  contact_email text,
  contact_phone text,
  address jsonb not null default '{}'::jsonb,
  opening_hours jsonb not null default '{}'::jsonb,
  public_form_config jsonb not null default '{}'::jsonb,
  email_templates jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.br_subscriptions (
  shop_id uuid primary key references public.era_shops(id) on delete cascade,
  plan_id text references public.br_plans(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','paused','canceled','incomplete')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.br_shop_invites (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.era_shops(id) on delete cascade,
  email text not null,
  role text not null default 'technician',
  token_hash text not null unique,
  invited_by uuid,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.br_usage_monthly (
  shop_id uuid not null references public.era_shops(id) on delete cascade,
  month date not null,
  emails_sent integer not null default 0,
  sms_sent integer not null default 0,
  ai_actions integer not null default 0,
  storage_bytes bigint not null default 0,
  primary key (shop_id, month)
);

alter table public.br_shop_settings enable row level security;
alter table public.br_subscriptions enable row level security;
alter table public.br_shop_invites enable row level security;
alter table public.br_usage_monthly enable row level security;

create policy br_shop_settings_owner_all
on public.br_shop_settings
for all
using (public.era_has_full_access(shop_id))
with check (public.era_has_full_access(shop_id));

create policy br_subscriptions_owner_read
on public.br_subscriptions
for select
using (public.era_has_full_access(shop_id));

create policy br_shop_invites_owner_all
on public.br_shop_invites
for all
using (public.era_has_full_access(shop_id))
with check (public.era_has_full_access(shop_id));

create policy br_usage_owner_read
on public.br_usage_monthly
for select
using (public.era_has_full_access(shop_id));

-- IMPORTANT hardening for the ported measurement table.
-- Replace the existing policies with versions whose repair relationship is
-- explicitly constrained to the same tenant.
drop policy if exists era_measurements_select on public.era_measurements;
create policy era_measurements_select
on public.era_measurements
for select
using (
  public.era_is_shop_member(shop_id)
  and exists (
    select 1 from public.era_repairs r
    where r.id = era_measurements.repair_id
      and r.shop_id = era_measurements.shop_id
  )
);

drop policy if exists era_measurements_insert on public.era_measurements;
create policy era_measurements_insert
on public.era_measurements
for insert
with check (
  recorded_by = auth.uid()
  and public.era_can_add_bench_data(shop_id)
  and exists (
    select 1 from public.era_repairs r
    where r.id = era_measurements.repair_id
      and r.shop_id = era_measurements.shop_id
  )
);

drop policy if exists era_measurements_update on public.era_measurements;
create policy era_measurements_update
on public.era_measurements
for update
using (
  public.era_can_add_bench_data(shop_id)
  and exists (
    select 1 from public.era_repairs r
    where r.id = era_measurements.repair_id
      and r.shop_id = era_measurements.shop_id
  )
)
with check (
  public.era_can_add_bench_data(shop_id)
  and exists (
    select 1 from public.era_repairs r
    where r.id = era_measurements.repair_id
      and r.shop_id = era_measurements.shop_id
  )
);

insert into public.br_plans (id,name,monthly_price_gbp,staff_limit,location_limit,ai_allowance,features)
values
  ('solo','Solo',29,1,1,50,'{"repairs":true,"quotes":true,"invoices":true,"portal":true,"measurements":true}'::jsonb),
  ('workshop','Workshop',59,5,1,500,'{"repairs":true,"quotes":true,"invoices":true,"portal":true,"measurements":true,"purchase_orders":true,"analytics":true}'::jsonb),
  ('multi','Multi-site',99,10,2,1500,'{"repairs":true,"quotes":true,"invoices":true,"portal":true,"measurements":true,"purchase_orders":true,"analytics":true,"multi_location":true}'::jsonb)
on conflict (id) do update set
  name=excluded.name,
  monthly_price_gbp=excluded.monthly_price_gbp,
  staff_limit=excluded.staff_limit,
  location_limit=excluded.location_limit,
  ai_allowance=excluded.ai_allowance,
  features=excluded.features;
