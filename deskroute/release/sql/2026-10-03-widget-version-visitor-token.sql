-- DeskRoute 6.1 RC: widget version pinning + visitor conversation token support.
-- Applied to production Supabase on 2026-10-03.

alter table public.cxroute_widget_configs
  add column if not exists widget_version text not null default '6.1.0-rc.1';

alter table public.cxroute_conversations
  add column if not exists visitor_token_hash text null;

update public.cxroute_widget_configs
set widget_version = '6.1.0-rc.1'
where widget_version is null or btrim(widget_version) = '';
