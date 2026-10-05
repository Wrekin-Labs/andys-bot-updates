-- KeepGoing v2 development-agent engine tag migration.
-- Apply before enabling KEEPGOING_DEV_AGENT_ENABLED in any environment that
-- uses public.keepgoing_jobs. This changes only the engine check constraint.

begin;

alter table public.keepgoing_jobs
  drop constraint if exists keepgoing_jobs_engine_check;

alter table public.keepgoing_jobs
  add constraint keepgoing_jobs_engine_check
  check (
    engine in ('agents', 'responses')
    or engine ~ '^agents-dev:c([1-9]|1[0-9]|20):v([0-9]|1[0-2]):a[0-9a-f]{16}:q(auto|[0-9a-f]{16}):p[01](:n[01])?(:r[01])?$'
  );

commit;
