-- Run inside a transaction and always ROLLBACK. Uses only synthetic fixtures.
insert into auth.users(id) values
 ('e6100000-0000-4000-8000-000000000001'),
 ('e6100000-0000-4000-8000-000000000002'),
 ('e6100000-0000-4000-8000-000000000003');
insert into public.cxroute_organisations(id,name,environment,external_actions_enabled) values
 ('e6100000-0000-4000-8000-000000000010','DeskRoute QA A','sandbox',false),
 ('e6100000-0000-4000-8000-000000000020','DeskRoute QA B','sandbox',false);
insert into public.cxroute_org_members(organisation_id,user_id,role,display_name) values
 ('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000001','owner','QA Owner'),
 ('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000002','agent','QA Agent'),
 ('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000003','viewer','QA Viewer');
insert into public.cxroute_conversations(id,organisation_id,channel,subject,status,priority) values
 ('e6100000-0000-4000-8000-000000000100','e6100000-0000-4000-8000-000000000010','website_chat','QA website question','open','normal'),
 ('e6100000-0000-4000-8000-000000000101','e6100000-0000-4000-8000-000000000010','email','QA email question','open','normal'),
 ('e6100000-0000-4000-8000-000000000200','e6100000-0000-4000-8000-000000000020','website_chat','Other tenant','open','normal');
insert into public.cxroute_help_centers(id,organisation_id,title,public_key,enabled) values
 ('e6100000-0000-4000-8000-000000000300','e6100000-0000-4000-8000-000000000010','QA Public Help','deskroute_qa_public_release_key',true),
 ('e6100000-0000-4000-8000-000000000301','e6100000-0000-4000-8000-000000000020','QA Private Help','deskroute_qa_private_release_key',false);
insert into public.cxroute_help_articles(organisation_id,help_center_id,title,slug,body,published) values
 ('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000300','Public answer','public-answer','Approved public text',true),
 ('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000300','Private draft','private-draft','DO NOT EXPOSE',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"e6100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r jsonb; r2 jsonb; n uuid; failed boolean;
begin
 r:=public.cxroute_send_website_reply('e6100000-0000-4000-8000-000000000100','QA website reply','e6100000-0000-4000-8000-000000000400');
 r2:=public.cxroute_send_website_reply('e6100000-0000-4000-8000-000000000100','QA website reply','e6100000-0000-4000-8000-000000000400');
 if r->>'messageId'<>r2->>'messageId' or r2->>'replayed'<>'true' then raise exception 'FAIL: reply idempotency';end if;
 if (select count(*) from public.cxroute_messages where conversation_id='e6100000-0000-4000-8000-000000000100' and direction='outbound')<>1 then raise exception 'FAIL: duplicate reply';end if;
 n:=public.cxroute_add_internal_note('e6100000-0000-4000-8000-000000000100','PRIVATE QA NOTE',array['e6100000-0000-4000-8000-000000000002'::uuid]);
 if not exists(select 1 from public.cxroute_messages where id=n and direction='internal') then raise exception 'FAIL: internal note';end if;
 if exists(select 1 from public.cxroute_messages where id=n and direction in ('inbound','outbound')) then raise exception 'FAIL: widget visibility';end if;
 if jsonb_array_length(public.cxroute_team_directory('e6100000-0000-4000-8000-000000000010')->'members')<>3 then raise exception 'FAIL: team directory';end if;
 failed:=false;begin perform public.cxroute_send_website_reply('e6100000-0000-4000-8000-000000000200','Cross tenant','e6100000-0000-4000-8000-000000000401');exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'FAIL: cross-tenant reply allowed';end if;
 failed:=false;begin perform public.cxroute_send_website_reply('e6100000-0000-4000-8000-000000000101','Email delivery','e6100000-0000-4000-8000-000000000402');exception when raise_exception then failed:=true;end;if not failed then raise exception 'FAIL: unsupported channel allowed';end if;
 failed:=false;begin perform public.cxroute_add_internal_note('e6100000-0000-4000-8000-000000000200','Cross tenant');exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'FAIL: cross-tenant note allowed';end if;
 failed:=false;begin insert into public.cxroute_messages(organisation_id,conversation_id,direction,body,author_type) values('e6100000-0000-4000-8000-000000000010','e6100000-0000-4000-8000-000000000200','outbound','Cross tenant FK test','agent');exception when foreign_key_violation then failed:=true;end;if not failed then raise exception 'FAIL: cross-tenant foreign key';end if;
 perform public.cxroute_support_analytics('e6100000-0000-4000-8000-000000000010',null,30);
 failed:=false;begin perform public.cxroute_support_analytics('e6100000-0000-4000-8000-000000000020',null,30);exception when raise_exception then failed:=true;end;if not failed then raise exception 'FAIL: cross-tenant analytics';end if;
end $$;
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"e6100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin if not exists(select 1 from public.cxroute_staff_notifications where conversation_id='e6100000-0000-4000-8000-000000000100' and title='Mentioned in an internal note') then raise exception 'FAIL: mention notification missing';end if;end $$;
select set_config('request.jwt.claim.sub','e6100000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"e6100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ declare denied boolean:=false;begin
 begin perform public.cxroute_send_website_reply('e6100000-0000-4000-8000-000000000100','Viewer reply','e6100000-0000-4000-8000-000000000403');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL: viewer sent a reply';end if;
 denied:=false;begin perform public.cxroute_add_internal_note('e6100000-0000-4000-8000-000000000100','Viewer note');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'FAIL: viewer added note';end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare r jsonb;begin
 if has_function_privilege('anon','public.cxroute_send_website_reply(uuid,text,uuid,uuid)','execute') then raise exception 'FAIL: anonymous reply access';end if;
 if has_function_privilege('anon','deskroute_private.add_internal_note(uuid,text,uuid[])','execute') then raise exception 'FAIL: anonymous private helper access';end if;
 r:=public.cxroute_public_help('deskroute_qa_public_release_key');
 if jsonb_array_length(r->'articles')<>1 or r::text like '%DO NOT EXPOSE%' then raise exception 'FAIL: public help draft disclosure';end if;
 if public.cxroute_public_help('deskroute_qa_private_release_key') is not null then raise exception 'FAIL: private help centre disclosure';end if;
 if public.cxroute_public_help('unknown_public_key_12345') is not null then raise exception 'FAIL: unknown help key';end if;
end $$;
reset role;
