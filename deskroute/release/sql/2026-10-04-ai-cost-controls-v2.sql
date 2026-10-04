-- DeskRoute 6.1 RC: layered AI call cost controls.
-- Applied to production Supabase on 2026-10-04.

alter table public.cxroute_plans
  add column if not exists monthly_ai_call_limit integer
  check (monthly_ai_call_limit is null or monthly_ai_call_limit > 0);

update public.cxroute_plans
set monthly_ai_call_limit = 10000
where code = 'beta'
  and monthly_ai_call_limit is null;

alter table public.cxroute_conversations
  add column if not exists ai_model_calls integer not null default 0
  check (ai_model_calls >= 0);

create table if not exists public.cxroute_usage_daily (
  organisation_id uuid not null
    references public.cxroute_organisations(id) on delete cascade,
  day date not null,
  ai_model_calls integer not null default 0
    check (ai_model_calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, day)
);

alter table public.cxroute_usage_daily enable row level security;
revoke all on table public.cxroute_usage_daily from public, anon, authenticated;
grant select, insert, update, delete on table public.cxroute_usage_daily to service_role;

create or replace function public.cxroute_reserve_ai_call_v2(
  p_organisation_id uuid,
  p_conversation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan_limit integer;
  v_setting_limit integer;
  v_monthly_limit integer;
  v_daily_limit integer;
  v_conversation_limit integer := 12;
  v_timezone text := 'UTC';
  v_day date;
  v_month date := date_trunc('month', now())::date;
  v_count integer;
  v_month_count integer;
  v_warn_count integer;
begin
  if p_organisation_id is null or p_conversation_id is null then
    return 'invalid';
  end if;

  select p.monthly_ai_call_limit
    into v_plan_limit
  from public.cxroute_subscriptions s
  join public.cxroute_plans p on p.code = s.plan_code
  where s.organisation_id = p_organisation_id
    and p.active = true
  order by s.updated_at desc
  limit 1;

  select s.monthly_ai_call_hard_limit
    into v_setting_limit
  from public.cxroute_settings s
  where s.organisation_id = p_organisation_id
  limit 1;

  v_monthly_limit := greatest(1, coalesce(v_plan_limit, v_setting_limit, 10000));
  v_daily_limit := greatest(1, ceil(v_monthly_limit / 10.0)::integer);

  select coalesce(bp.timezone, 'UTC')
    into v_timezone
  from public.cxroute_business_profiles bp
  where bp.organisation_id = p_organisation_id
  limit 1;

  begin
    v_day := (now() at time zone coalesce(v_timezone, 'UTC'))::date;
  exception when others then
    v_day := (now() at time zone 'UTC')::date;
  end;

  update public.cxroute_conversations
     set ai_model_calls = ai_model_calls + 1
   where id = p_conversation_id
     and organisation_id = p_organisation_id
     and ai_model_calls < v_conversation_limit
  returning ai_model_calls into v_count;

  if v_count is null then
    return 'conversation';
  end if;

  insert into public.cxroute_usage_daily (
    organisation_id, day, ai_model_calls, updated_at
  )
  values (p_organisation_id, v_day, 1, now())
  on conflict (organisation_id, day)
  do update
     set ai_model_calls = public.cxroute_usage_daily.ai_model_calls + 1,
         updated_at = now()
   where public.cxroute_usage_daily.ai_model_calls < v_daily_limit
  returning ai_model_calls into v_count;

  if v_count is null then
    update public.cxroute_conversations
       set ai_model_calls = greatest(0, ai_model_calls - 1)
     where id = p_conversation_id
       and organisation_id = p_organisation_id;
    return 'daily';
  end if;

  insert into public.cxroute_usage_monthly (
    organisation_id, period_month, ai_model_calls, updated_at
  )
  values (p_organisation_id, v_month, 1, now())
  on conflict (organisation_id, period_month)
  do update
     set ai_model_calls = public.cxroute_usage_monthly.ai_model_calls + 1,
         updated_at = now()
   where public.cxroute_usage_monthly.ai_model_calls < v_monthly_limit
  returning ai_model_calls into v_month_count;

  if v_month_count is null then
    update public.cxroute_conversations
       set ai_model_calls = greatest(0, ai_model_calls - 1)
     where id = p_conversation_id
       and organisation_id = p_organisation_id;

    update public.cxroute_usage_daily
       set ai_model_calls = greatest(0, ai_model_calls - 1),
           updated_at = now()
     where organisation_id = p_organisation_id
       and day = v_day;

    return 'monthly';
  end if;

  v_warn_count := greatest(1, ceil(v_monthly_limit * 0.8)::integer);

  if v_month_count = v_monthly_limit then
    insert into public.cxroute_staff_notifications (
      organisation_id, user_id, kind, title, body_preview
    )
    select p_organisation_id, m.user_id, 'system',
           'DeskRoute monthly AI limit reached',
           format('%s of %s monthly AI calls used. Chat will use approved facts or a person until the allowance resets.',
                  v_month_count, v_monthly_limit)
    from public.cxroute_org_members m
    where m.organisation_id = p_organisation_id
      and m.role in ('owner','admin');
  elsif v_month_count = v_warn_count then
    insert into public.cxroute_staff_notifications (
      organisation_id, user_id, kind, title, body_preview
    )
    select p_organisation_id, m.user_id, 'system',
           'DeskRoute AI usage is at 80%',
           format('%s of %s monthly AI calls used.', v_month_count, v_monthly_limit)
    from public.cxroute_org_members m
    where m.organisation_id = p_organisation_id
      and m.role in ('owner','admin');
  end if;

  return 'ok';
end;
$$;

revoke all on function public.cxroute_reserve_ai_call_v2(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.cxroute_reserve_ai_call_v2(uuid,uuid)
  to service_role;
