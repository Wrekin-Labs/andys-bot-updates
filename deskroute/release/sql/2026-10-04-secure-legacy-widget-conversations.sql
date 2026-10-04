-- DeskRoute 6.1 RC security hardening.
-- Invalidates pre-token website-chat sessions without deleting conversation history.
-- Safe to re-run: only null visitor token hashes are changed.

update public.cxroute_conversations
set visitor_token_hash =
  replace(gen_random_uuid()::text,'-','') ||
  replace(gen_random_uuid()::text,'-','')
where channel='website_chat'
  and visitor_token_hash is null;
