-- DeskRoute 6.1 RC RPC execution hardening.
-- Internal RPCs are not anonymous. Deliberately public functions
-- cxroute_public_help and cxroute_public_widget_config are unchanged.

revoke execute on function public.cxroute_approve_learning_suggestion(uuid) from public, anon;
grant execute on function public.cxroute_approve_learning_suggestion(uuid) to authenticated, service_role;

revoke execute on function public.cxroute_business_brain_readiness(uuid,uuid) from public, anon;
grant execute on function public.cxroute_business_brain_readiness(uuid,uuid) to authenticated, service_role;

revoke execute on function public.cxroute_capture_agent_reply_learning() from public, anon;
grant execute on function public.cxroute_capture_agent_reply_learning() to service_role;

revoke execute on function public.cxroute_fanout_staff_notification() from public, anon;
grant execute on function public.cxroute_fanout_staff_notification() to service_role;

revoke execute on function public.cxroute_normalize_question(text) from public, anon;
grant execute on function public.cxroute_normalize_question(text) to authenticated, service_role;

revoke execute on function public.cxroute_reconcile_gaps_on_fact_approval() from public, anon;
grant execute on function public.cxroute_reconcile_gaps_on_fact_approval() to service_role;

revoke execute on function public.cxroute_record_knowledge_gap(uuid,uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.cxroute_record_knowledge_gap(uuid,uuid,text,uuid,uuid,text) to authenticated, service_role;

revoke execute on function public.cxroute_search_approved_facts_brand(uuid,uuid,text,integer) from public, anon;
grant execute on function public.cxroute_search_approved_facts_brand(uuid,uuid,text,integer) to authenticated, service_role;

revoke execute on function public.cxroute_support_analytics(uuid,uuid,integer) from public, anon;
grant execute on function public.cxroute_support_analytics(uuid,uuid,integer) to authenticated, service_role;

revoke execute on function public.cxroute_sync_learning_fact_review() from public, anon;
grant execute on function public.cxroute_sync_learning_fact_review() to service_role;
