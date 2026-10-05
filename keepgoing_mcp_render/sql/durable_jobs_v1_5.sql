-- KeepGoing 1.5.0 durable-state hardening. Apply AFTER sql/durable_jobs.sql.
-- Safe to re-run: every statement is idempotent (create or replace / if not exists /
-- drop trigger if exists). Existing data is preserved. New progress-tracking columns
-- have defaults so old jobs remain readable while 1.5 adds stall recovery.
--
-- 1. A BEFORE UPDATE trigger that rejects:
--      * changing job_id or owner_subject_hash after reservation;
--      * leaving completed / cancelled / budget_exhausted (no resurrection);
--      * leaving failed, except a start that failed before any provider session
--        was attached (attempt 0, no session) being retried to queued/working;
--      * updates that do not advance the optimistic-concurrency version.
--    The application already filters its compare-and-set PATCH the same way, so
--    in normal operation this trigger never fires; it is defence in depth against
--    application bugs or manual edits.
-- 2. Provider-turn progress fields used to distinguish polling from real progress
--    and recover turns that remain stuck without advancing.
-- 3. A partial index matching the watchdog's recovery scan.

alter table public.keepgoing_jobs add column if not exists current_run_id text;
alter table public.keepgoing_jobs add column if not exists current_turn_tokens bigint not null default 0;
alter table public.keepgoing_jobs add column if not exists current_turn_tool_calls integer not null default 0;
alter table public.keepgoing_jobs add column if not exists stall_recovery_count integer not null default 0;

create or replace function public.keepgoing_jobs_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.job_id is distinct from old.job_id then
    raise exception 'keepgoing: job_id is immutable' using errcode = 'check_violation';
  end if;

  if new.owner_subject_hash is distinct from old.owner_subject_hash then
    raise exception 'keepgoing: owner_subject_hash is immutable' using errcode = 'check_violation';
  end if;

  if new.version <= old.version then
    raise exception 'keepgoing: version must increase on every update' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('completed', 'cancelled', 'budget_exhausted') then
      raise exception 'keepgoing: illegal transition from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if old.status = 'failed' and not (
      old.provider_session_id is null
      and old.attempt = 0
      and new.status in ('queued', 'working')
    ) then
      raise exception 'keepgoing: illegal transition from failed to %', new.status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.keepgoing_jobs_guard_update() from public, anon, authenticated;

drop trigger if exists keepgoing_jobs_guard_update on public.keepgoing_jobs;
create trigger keepgoing_jobs_guard_update
  before update on public.keepgoing_jobs
  for each row
  execute function public.keepgoing_jobs_guard_update();

create index if not exists keepgoing_jobs_recoverable_idx
  on public.keepgoing_jobs (updated_at)
  where status in ('queued', 'working', 'continuing');

comment on function public.keepgoing_jobs_guard_update() is
  'KeepGoing 1.5: rejects job resurrection, owner changes and non-advancing versions on keepgoing_jobs.';
