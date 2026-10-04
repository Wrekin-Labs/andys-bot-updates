-- DeskRoute 6.1 RC.2 Web Push foundation.
alter table public.cxroute_staff_devices
  add column if not exists push_failure_count integer not null default 0 check (push_failure_count >= 0),
  add column if not exists push_last_success_at timestamptz,
  add column if not exists push_disabled_reason text;

alter table public.cxroute_notification_preferences
  add column if not exists email_fallback boolean not null default true;

alter table public.cxroute_notification_receipts
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists response_code integer;

alter table public.cxroute_notification_receipts
  drop constraint if exists cxroute_notification_receipts_delivery_status_check;
alter table public.cxroute_notification_receipts
  add constraint cxroute_notification_receipts_delivery_status_check
  check (delivery_status in ('pending','sending','delivered','failed','opened'));

create unique index if not exists cxroute_staff_devices_push_endpoint_uq
  on public.cxroute_staff_devices ((push_subscription->>'endpoint'))
  where coalesce(push_subscription->>'endpoint','') <> '';

create index if not exists cxroute_notification_receipts_push_due_idx
  on public.cxroute_notification_receipts (delivery_status,next_attempt_at,updated_at)
  where delivery_status='pending';

create or replace function public.cxroute_worker_get_secret(p_name text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare v_secret text;
begin
  if p_name not in ('deskroute-vapid-public','deskroute-vapid-private','deskroute-worker-secret') then
    raise exception 'Secret not allowed';
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name=p_name
  limit 1;
  return v_secret;
end;
$$;
revoke all on function public.cxroute_worker_get_secret(text) from public,anon,authenticated;
grant execute on function public.cxroute_worker_get_secret(text) to service_role;

create or replace function public.cxroute_worker_store_secret(p_name text,p_value text,p_description text default null)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_name not in ('deskroute-vapid-public','deskroute-vapid-private','deskroute-worker-secret') then
    raise exception 'Secret not allowed';
  end if;
  if p_value is null or length(p_value)<16 then raise exception 'Invalid secret'; end if;
  if exists(select 1 from vault.secrets where name=p_name) then return false; end if;
  perform vault.create_secret(p_value,p_name,coalesce(p_description,'DeskRoute worker secret'),null);
  return true;
end;
$$;
revoke all on function public.cxroute_worker_store_secret(text,text,text) from public,anon,authenticated;
grant execute on function public.cxroute_worker_store_secret(text,text,text) to service_role;

create or replace function public.cxroute_claim_push_receipts(p_limit integer default 50)
returns table(
  notification_id uuid, device_id uuid, organisation_id uuid, user_id uuid,
  conversation_id uuid, kind text, title text, body_preview text,
  push_subscription jsonb, attempts integer
)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query
  with picked as (
    select r.notification_id,r.device_id
    from public.cxroute_notification_receipts r
    join public.cxroute_staff_devices d on d.id=r.device_id
    join public.cxroute_staff_notifications n on n.id=r.notification_id
    where r.delivery_status='pending'
      and coalesce(r.next_attempt_at,now())<=now()
      and r.attempts<3
      and d.enabled=true
      and d.notification_mode='webpush'
      and coalesce(d.push_subscription->>'endpoint','')<>''
      and n.created_at>now()-interval '24 hours'
    order by n.created_at,r.updated_at
    limit greatest(1,least(coalesce(p_limit,50),100))
    for update of r skip locked
  ), claimed as (
    update public.cxroute_notification_receipts r
       set delivery_status='sending',attempts=r.attempts+1,updated_at=now()
      from picked p
     where r.notification_id=p.notification_id and r.device_id=p.device_id
    returning r.notification_id,r.device_id,r.attempts
  )
  select n.id,d.id,n.organisation_id,n.user_id,n.conversation_id,n.kind,
         n.title,n.body_preview,d.push_subscription,c.attempts
  from claimed c
  join public.cxroute_staff_notifications n on n.id=c.notification_id
  join public.cxroute_staff_devices d on d.id=c.device_id;
end;
$$;
revoke all on function public.cxroute_claim_push_receipts(integer) from public,anon,authenticated;
grant execute on function public.cxroute_claim_push_receipts(integer) to service_role;

create or replace function public.cxroute_kick_push_worker()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_token text; v_request bigint;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name='deskroute-worker-secret'
  limit 1;
  if coalesce(v_token,'')='' then return null; end if;

  select net.http_post(
    url:='https://dbhwjzznwhukoogjewfl.supabase.co/functions/v1/cxroute-email-ingest',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cxroute-ingest-token',v_token
    ),
    body:='{"action":"cxroute_internal_push_dispatch_v1"}'::jsonb
  ) into v_request;
  return v_request;
end;
$$;
revoke all on function public.cxroute_kick_push_worker() from public,anon,authenticated;
grant execute on function public.cxroute_kick_push_worker() to service_role;

create or replace function public.cxroute_push_dispatch_after_notification()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.cxroute_kick_push_worker();
  return new;
end;
$$;
revoke all on function public.cxroute_push_dispatch_after_notification() from public,anon,authenticated;
grant execute on function public.cxroute_push_dispatch_after_notification() to service_role;

drop trigger if exists cxroute_push_dispatch_trigger on public.cxroute_staff_notifications;
create trigger cxroute_push_dispatch_trigger
after insert on public.cxroute_staff_notifications
for each row execute function public.cxroute_push_dispatch_after_notification();

-- Retry pending push receipts once per minute. Safe when the worker secret has not been bootstrapped yet.
do $outer$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='cxroute-push-sweep' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule(
    'cxroute-push-sweep',
    '* * * * *',
    $job$select public.cxroute_kick_push_worker();$job$
  );
end
$outer$;
