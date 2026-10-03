-- DeskRoute 6.1 additive release functions. No production data changes.
-- Definer helpers live in an unexposed schema, validate the current user, and
-- expose only scoped results. Public wrappers run with invoker privileges.
create schema if not exists deskroute_private;
revoke all on schema deskroute_private from public;
grant usage on schema deskroute_private to authenticated;

create unique index if not exists cxroute_conversations_id_org_unique on public.cxroute_conversations(id,organisation_id);
alter table public.cxroute_messages add constraint cxroute_messages_conversation_org_fk foreign key (conversation_id,organisation_id) references public.cxroute_conversations(id,organisation_id) on delete cascade;
create unique index if not exists cxroute_help_centers_id_org_unique on public.cxroute_help_centers(id,organisation_id);
alter table public.cxroute_help_articles add constraint cxroute_help_articles_center_org_fk foreign key (help_center_id,organisation_id) references public.cxroute_help_centers(id,organisation_id) on delete cascade;

create or replace function deskroute_private.send_website_reply(p_conversation_id uuid,p_body text,p_client_id uuid,p_draft_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_c public.cxroute_conversations%rowtype; v_role text;
 v_body text:=trim(coalesce(p_body,'')); v_message public.cxroute_messages%rowtype;
 v_draft public.cxroute_ai_drafts%rowtype;
begin
 if v_user is null then raise exception 'Unauthorised' using errcode='42501'; end if;
 if p_client_id is null or length(v_body) not between 1 and 4000 then raise exception 'A request ID and reply of 1–4000 characters are required'; end if;
 select c.* into v_c from public.cxroute_conversations c
 join public.cxroute_org_members m on m.organisation_id=c.organisation_id and m.user_id=v_user
 where c.id=p_conversation_id and (m.role in ('owner','admin','agent') or public.cxroute_has_permission(c.organisation_id,'inbox.reply')) for update of c;
 if not found then raise exception 'Conversation not found or not authorised' using errcode='42501'; end if;
 if v_c.channel<>'website_chat' then raise exception 'This release only delivers website chat replies'; end if;
 select * into v_message from public.cxroute_messages where organisation_id=v_c.organisation_id and conversation_id=v_c.id and safe_metadata->>'client_request_id'=p_client_id::text and safe_metadata->>'author_user_id'=v_user::text;
 if found then
   if v_message.body<>v_body then raise exception 'Request ID already used for another reply'; end if;
   return jsonb_build_object('ok',true,'messageId',v_message.id,'delivery','available_in_widget','replayed',true);
 end if;
 if p_draft_id is not null then
   select * into v_draft from public.cxroute_ai_drafts where id=p_draft_id and organisation_id=v_c.organisation_id and conversation_id=v_c.id for update;
   if not found or v_draft.status<>'pending' then raise exception 'Draft is no longer pending. Refresh the conversation.'; end if;
 end if;
 insert into public.cxroute_messages(organisation_id,conversation_id,direction,body,author_type,safe_metadata)
 values(v_c.organisation_id,v_c.id,'outbound',v_body,'agent',jsonb_build_object('author_user_id',v_user,'client_request_id',p_client_id)) returning * into v_message;
 if p_draft_id is not null then update public.cxroute_ai_drafts set status='sent',proposed_reply=v_body,reviewed_by=v_user,reviewed_at=now() where id=p_draft_id; end if;
 insert into public.cxroute_audit_log(organisation_id,actor_user_id,actor_type,action,entity_type,entity_id,safe_metadata)
 values(v_c.organisation_id,v_user,'user','website_reply_saved','conversation',v_c.id::text,jsonb_build_object('message_id',v_message.id,'draft_id',p_draft_id));
 return jsonb_build_object('ok',true,'messageId',v_message.id,'delivery','available_in_widget','replayed',false);
end $$;
revoke all on function deskroute_private.send_website_reply(uuid,text,uuid,uuid) from public,anon;
grant execute on function deskroute_private.send_website_reply(uuid,text,uuid,uuid) to authenticated;
create or replace function public.cxroute_send_website_reply(p_conversation_id uuid,p_body text,p_client_id uuid,p_draft_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select deskroute_private.send_website_reply(p_conversation_id,p_body,p_client_id,p_draft_id) $$;
revoke all on function public.cxroute_send_website_reply(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.cxroute_send_website_reply(uuid,text,uuid,uuid) to authenticated;

create or replace function deskroute_private.add_internal_note(p_conversation_id uuid,p_body text,p_mention_user_ids uuid[] default '{}'::uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_org uuid;v_note uuid;v_target uuid;v_mentions uuid[];v_body text:=trim(coalesce(p_body,''));
begin
 if v_user is null then raise exception 'Unauthorised' using errcode='42501'; end if;
 if length(v_body) not between 1 and 4000 then raise exception 'Internal note must be 1–4000 characters'; end if;
 select c.organisation_id into v_org from public.cxroute_conversations c join public.cxroute_org_members m on m.organisation_id=c.organisation_id and m.user_id=v_user
 where c.id=p_conversation_id and (m.role in ('owner','admin','agent') or public.cxroute_has_permission(c.organisation_id,'inbox.reply'));
 if v_org is null then raise exception 'Conversation not found or not authorised' using errcode='42501'; end if;
 select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_mentions from unnest(coalesce(p_mention_user_ids,'{}'::uuid[])) x where x is not null and x<>v_user;
 if cardinality(v_mentions)>20 then raise exception 'Too many mentions'; end if;
 if exists(select 1 from unnest(v_mentions) x where not exists(select 1 from public.cxroute_org_members m where m.organisation_id=v_org and m.user_id=x)) then raise exception 'A mentioned teammate is not in this workspace'; end if;
 insert into public.cxroute_messages(organisation_id,conversation_id,direction,body,author_type,safe_metadata) values(v_org,p_conversation_id,'internal',v_body,'agent',jsonb_build_object('internal_note',true,'author_user_id',v_user)) returning id into v_note;
 foreach v_target in array v_mentions loop
   insert into public.cxroute_message_mentions(message_id,organisation_id,conversation_id,user_id) values(v_note,v_org,p_conversation_id,v_target);
   insert into public.cxroute_staff_notifications(organisation_id,user_id,conversation_id,kind,title,body_preview) values(v_org,v_target,p_conversation_id,'system','Mentioned in an internal note',left(v_body,180));
 end loop;
 insert into public.cxroute_audit_log(organisation_id,actor_user_id,actor_type,action,entity_type,entity_id,safe_metadata) values(v_org,v_user,'user','internal_note_added','conversation',p_conversation_id::text,jsonb_build_object('message_id',v_note,'mention_count',cardinality(v_mentions)));
 return v_note;
end $$;
revoke all on function deskroute_private.add_internal_note(uuid,text,uuid[]) from public,anon;
grant execute on function deskroute_private.add_internal_note(uuid,text,uuid[]) to authenticated;
create or replace function public.cxroute_add_internal_note(p_conversation_id uuid,p_body text,p_mention_user_ids uuid[] default '{}'::uuid[])
returns uuid language sql security invoker set search_path='' as $$ select deskroute_private.add_internal_note(p_conversation_id,p_body,p_mention_user_ids) $$;
revoke all on function public.cxroute_add_internal_note(uuid,text,uuid[]) from public,anon;
grant execute on function public.cxroute_add_internal_note(uuid,text,uuid[]) to authenticated;

create or replace function deskroute_private.team_directory(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_members jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.cxroute_org_members m where m.organisation_id=p_organisation_id and m.user_id=auth.uid() and (m.role in ('owner','admin','agent','viewer') or public.cxroute_has_permission(p_organisation_id,'inbox.read') or public.cxroute_has_permission(p_organisation_id,'inbox.reply'))) then raise exception 'Not authorised' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',coalesce(m.display_name,m.member_email,'Team member'),'role',m.role,'assigned_count',(select count(*) from public.cxroute_conversations c where c.organisation_id=p_organisation_id and c.assigned_user_id=m.user_id and c.status in ('open','pending')),'last_seen_at',(select max(d.last_seen_at) from public.cxroute_staff_devices d where d.organisation_id=p_organisation_id and d.user_id=m.user_id and d.enabled)) order by m.created_at),'[]'::jsonb) into v_members from public.cxroute_org_members m where m.organisation_id=p_organisation_id;
 return jsonb_build_object('members',v_members);
end $$;
revoke all on function deskroute_private.team_directory(uuid) from public,anon;
grant execute on function deskroute_private.team_directory(uuid) to authenticated;
create or replace function public.cxroute_team_directory(p_organisation_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select deskroute_private.team_directory(p_organisation_id) $$;
revoke all on function public.cxroute_team_directory(uuid) from public,anon;
grant execute on function public.cxroute_team_directory(uuid) to authenticated;

-- Public help is intentionally anonymous; only explicitly published articles
-- from an enabled centre and its matching organisation are returned.
grant usage on schema deskroute_private to anon;
create or replace function deskroute_private.public_help(p_public_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_center public.cxroute_help_centers%rowtype; v_articles jsonb;
begin
 if length(coalesce(p_public_key,'')) not between 16 and 200 then return null; end if;
 select * into v_center from public.cxroute_help_centers where public_key=p_public_key and enabled=true;
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('title',a.title,'slug',a.slug,'body',a.body,'category',a.category,'updated_at',a.updated_at) order by a.sort_order,a.title),'[]'::jsonb) into v_articles from (select * from public.cxroute_help_articles where help_center_id=v_center.id and organisation_id=v_center.organisation_id and published=true order by sort_order,title limit 200) a;
 return jsonb_build_object('title',v_center.title,'subtitle',v_center.subtitle,'articles',v_articles);
end $$;
revoke all on function deskroute_private.public_help(text) from public;
grant execute on function deskroute_private.public_help(text) to anon,authenticated;
create or replace function public.cxroute_public_help(p_public_key text) returns jsonb language sql stable security invoker set search_path='' as $$ select deskroute_private.public_help(p_public_key) $$;
revoke all on function public.cxroute_public_help(text) from public;
grant execute on function public.cxroute_public_help(text) to anon,authenticated;
