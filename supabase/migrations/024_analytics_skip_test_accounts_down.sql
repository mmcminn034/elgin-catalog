begin;
create or replace function public.log_event(p_kind text, p_user uuid, p_ref text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as
$$ insert into analytics_events (kind, user_id, ref, meta) values (p_kind, p_user, p_ref, coalesce(p_meta, '{}')) $$;
revoke all on function public.log_event(text, uuid, text, jsonb) from public, anon, authenticated;
drop function if exists public.is_test_account(uuid);
commit;
