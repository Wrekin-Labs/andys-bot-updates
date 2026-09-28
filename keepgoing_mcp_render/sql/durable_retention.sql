-- KeepGoing v1.2 durable-state retention helper.
-- Prototype only. Apply after durable_jobs.sql through the reviewed migration workflow.

create or replace function public.prune_keepgoing_durable_state(
  p_job_retention_days integer default 30,
  p_event_retention_days integer default 30
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_jobs_deleted bigint := 0;
  v_events_deleted bigint := 0;
begin
  if p_job_retention_days < 1 or p_job_retention_days > 3650 then
    raise exception 'job retention days out of range';
  end if;
  if p_event_retention_days < 1 or p_event_retention_days > 3650 then
    raise exception 'event retention days out of range';
  end if;

  delete from public.keepgoing_job_events
  where created_at < now() - make_interval(days => p_event_retention_days);
  get diagnostics v_events_deleted = row_count;

  delete from public.keepgoing_jobs
  where status in ('completed', 'failed', 'cancelled', 'budget_exhausted')
    and updated_at < now() - make_interval(days => p_job_retention_days);
  get diagnostics v_jobs_deleted = row_count;

  return jsonb_build_object(
    'jobs_deleted', v_jobs_deleted,
    'events_deleted', v_events_deleted
  );
end;
$$;

revoke all on function public.prune_keepgoing_durable_state(integer, integer)
  from public, anon, authenticated;

grant execute on function public.prune_keepgoing_durable_state(integer, integer)
  to service_role;

comment on function public.prune_keepgoing_durable_state(integer, integer) is
  'Prunes old terminal KeepGoing orchestration metadata and safe event records. Active/input-required jobs are retained.';
