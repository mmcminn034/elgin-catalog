-- 024 (2026-10-18): automated test accounts (@unearthedfinds.test) don't count in owner analytics. Rollback: 024_analytics_skip_test_accounts_down.sql
begin;
create or replace function public.is_test_account(u uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select email ilike '%@unearthedfinds.test' from auth.users where id = u), false) $$;
revoke all on function public.is_test_account(uuid) from public, anon, authenticated;
create or replace function public.log_event(p_kind text, p_user uuid, p_ref text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as
$$ begin if p_user is not null and is_test_account(p_user) then return; end if;
  insert into analytics_events (kind, user_id, ref, meta) values (p_kind, p_user, p_ref, coalesce(p_meta, '{}')); end $$;
revoke all on function public.log_event(text, uuid, text, jsonb) from public, anon, authenticated;
delete from analytics_events e where e.user_id is not null and coalesce(e.meta->>'backfill', '') = '' and not exists (select 1 from auth.users u where u.id = e.user_id);
commit;
