-- DeskRoute 6.1 RC: per-organisation hard ceiling for model calls.
-- Applied to production Supabase on 2026-10-03.

alter table public.cxroute_settings
  add column if not exists monthly_ai_call_hard_limit integer not null default 10000
  check (monthly_ai_call_hard_limit > 0);

alter table public.cxroute_usage_monthly
  add column if not exists ai_model_calls integer not null default 0
  check (ai_model_calls >= 0);

create or replace function public.cxroute_reserve_ai_call(
  p_organisation_id uuid,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_month date := date_trunc('month', now())::date;
begin
  if p_organisation_id is null or p_limit is null or p_limit <= 0 then
    return false;
  end if;

  insert into public.cxroute_usage_monthly (
    organisation_id, period_month, ai_model_calls, updated_at
  ) values (
    p_organisation_id, v_month, 1, now()
  )
  on conflict (organisation_id, period_month)
  do update
    set ai_model_calls = public.cxroute_usage_monthly.ai_model_calls + 1,
        updated_at = now()
    where public.cxroute_usage_monthly.ai_model_calls < p_limit
  returning ai_model_calls into v_count;

  return v_count is not null and v_count <= p_limit;
end;
$$;

revoke all on function public.cxroute_reserve_ai_call(uuid,integer) from public, anon, authenticated;
grant execute on function public.cxroute_reserve_ai_call(uuid,integer) to service_role;
