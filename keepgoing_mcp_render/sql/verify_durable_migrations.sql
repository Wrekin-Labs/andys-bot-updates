-- Executable verification for the durable-job migrations against a scratch
-- PostgreSQL database (NOT production). Run with:
--   psql "$KEEPGOING_TEST_PG_URL" -v ON_ERROR_STOP=1 -f sql/verify_durable_migrations.sql
-- It creates Supabase-like roles if missing, applies durable_jobs.sql and
-- durable_jobs_v1_5.sql (twice, to prove re-runnability), then asserts the
-- reservation, idempotency, CAS and no-resurrection behaviour. Any failed
-- assertion aborts with a non-zero exit code.

\set ON_ERROR_STOP 1

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

drop table if exists public.keepgoing_job_events cascade;
drop table if exists public.keepgoing_jobs cascade;

\ir durable_jobs.sql
\ir durable_jobs_v1_5.sql
\ir durable_jobs_v1_5.sql

do $$
declare
  v_row public.keepgoing_jobs;
  v_count int;
  v_failed boolean;
begin
  -- Reservation + idempotent duplicate start.
  select * into v_row from public.reserve_keepgoing_job(
    'kgj_' || repeat('a', 32), repeat('o', 64), 'req-hash-1', 'agents', null, null,
    6, 20000, 3, now() + interval '1 hour', now() + interval '1 minute');
  assert v_row.job_id = 'kgj_' || repeat('a', 32), 'first reservation creates the job';

  select * into v_row from public.reserve_keepgoing_job(
    'kgj_' || repeat('b', 32), repeat('o', 64), 'req-hash-1', 'agents', null, null,
    6, 20000, 3, now() + interval '1 hour', now() + interval '1 minute');
  assert v_row.job_id = 'kgj_' || repeat('a', 32), 'duplicate client request returns the original job';
  select count(*) into v_count from public.keepgoing_jobs;
  assert v_count = 1, 'duplicate reservation must not insert a second row';

  -- Same request hash for a different owner is a different job.
  select * into v_row from public.reserve_keepgoing_job(
    'kgj_' || repeat('c', 32), repeat('p', 64), 'req-hash-1', 'agents', null, null,
    6, 20000, 3, now() + interval '1 hour', now() + interval '1 minute');
  assert v_row.job_id = 'kgj_' || repeat('c', 32), 'request hashes are scoped per owner';

  -- Legal progression with version bumps.
  update public.keepgoing_jobs set status = 'working', provider_session_id = 'sess_x', version = 2
    where job_id = 'kgj_' || repeat('a', 32) and version = 1;
  get diagnostics v_count = row_count;
  assert v_count = 1, 'CAS update succeeds at the expected version';

  update public.keepgoing_jobs set status = 'continuing', version = 3
    where job_id = 'kgj_' || repeat('a', 32) and version = 1;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'stale-version CAS matches no row';

  update public.keepgoing_jobs set status = 'cancelled', version = 3
    where job_id = 'kgj_' || repeat('a', 32) and version = 2;

  -- The application CAS filter (status not in absorbing) matches nothing...
  update public.keepgoing_jobs set status = 'working', version = 4
    where job_id = 'kgj_' || repeat('a', 32) and version = 3
      and status not in ('completed', 'cancelled', 'budget_exhausted');
  get diagnostics v_count = row_count;
  assert v_count = 0, 'application CAS filter refuses to resurrect a cancelled job';

  -- ...and the trigger rejects an unfiltered write too.
  v_failed := false;
  begin
    update public.keepgoing_jobs set status = 'working', version = 4
      where job_id = 'kgj_' || repeat('a', 32);
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'trigger rejects cancelled -> working';

  -- Owner is immutable.
  v_failed := false;
  begin
    update public.keepgoing_jobs set owner_subject_hash = repeat('z', 64), version = 2
      where job_id = 'kgj_' || repeat('c', 32);
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'trigger rejects owner change';

  -- Version must advance.
  v_failed := false;
  begin
    update public.keepgoing_jobs set safe_error_code = 'x' where job_id = 'kgj_' || repeat('c', 32);
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'trigger rejects a non-advancing version';

  -- A start failure with no provider session may be retried; one with a session may not.
  update public.keepgoing_jobs set status = 'failed', safe_error_code = 'start_not_recovered', version = 2
    where job_id = 'kgj_' || repeat('c', 32);
  update public.keepgoing_jobs set status = 'queued', version = 3
    where job_id = 'kgj_' || repeat('c', 32);
  get diagnostics v_count = row_count;
  assert v_count = 1, 'failed start without session can be retried';

  update public.keepgoing_jobs set status = 'working', provider_session_id = 'sess_y', version = 4
    where job_id = 'kgj_' || repeat('c', 32);
  update public.keepgoing_jobs set status = 'failed', attempt = 1, version = 5
    where job_id = 'kgj_' || repeat('c', 32);
  v_failed := false;
  begin
    update public.keepgoing_jobs set status = 'working', version = 6 where job_id = 'kgj_' || repeat('c', 32);
  exception when check_violation then v_failed := true;
  end;
  assert v_failed, 'failed job with a provider session cannot be revived';

  -- Retention never removes active jobs.
  perform public.reserve_keepgoing_job(
    'kgj_' || repeat('d', 32), repeat('o', 64), null, 'agents', null, null,
    6, 20000, 3, now() + interval '1 hour', now() + interval '1 minute');
  update public.keepgoing_jobs set updated_at = now() - interval '400 days', version = version + 1 where true;
  perform public.cleanup_keepgoing_durable_state(30, 14);
  select count(*) into v_count from public.keepgoing_jobs where job_id = 'kgj_' || repeat('d', 32);
  assert v_count = 1, 'cleanup keeps active (queued) jobs';
  select count(*) into v_count from public.keepgoing_jobs where status in ('cancelled', 'failed');
  assert v_count = 0, 'cleanup removes old terminal jobs';

  raise notice 'keepgoing durable migration verification passed';
end $$;
