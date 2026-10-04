-- DeskRoute 6.1 RC.2 business-hours status for visitor handoff copy.
create or replace function public.cxroute_is_open(
  p_organisation_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_zone text := 'Europe/London';
  v_local timestamp;
  v_date date;
  v_time time;
  v_dow integer;
  v_holiday record;
  v_hours record;
begin
  if p_organisation_id is null then return null; end if;

  select coalesce(timezone,'Europe/London') into v_zone
  from public.cxroute_business_profiles
  where organisation_id=p_organisation_id limit 1;

  if not exists(select 1 from public.cxroute_business_hours where organisation_id=p_organisation_id) then
    return null;
  end if;

  begin
    v_local := p_at at time zone coalesce(v_zone,'Europe/London');
  exception when others then
    v_local := p_at at time zone 'UTC';
  end;

  v_date:=v_local::date; v_time:=v_local::time; v_dow:=extract(dow from v_local)::integer;

  select * into v_holiday from public.cxroute_sla_holidays
  where organisation_id=p_organisation_id and holiday_date=v_date limit 1;
  if found then
    if v_holiday.closed then return false; end if;
    return v_time>=v_holiday.open_time and v_time<v_holiday.close_time;
  end if;

  select * into v_hours from public.cxroute_business_hours
  where organisation_id=p_organisation_id and weekday=v_dow limit 1;
  if not found or v_hours.closed then return false; end if;
  return v_time>=v_hours.open_time and v_time<v_hours.close_time;
end;
$$;
revoke all on function public.cxroute_is_open(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.cxroute_is_open(uuid,timestamptz) to service_role;
