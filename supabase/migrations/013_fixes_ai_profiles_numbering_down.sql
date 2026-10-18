-- Rollback for 013 (restores the 012 state).
begin;
drop trigger if exists finds_aa_catalog_id on public.finds;
drop function if exists public.assign_catalog_id();
drop function if exists public.my_catalog_prefix();
drop function if exists public.allocate_catalog_id();
drop function if exists public.allocate_catalog_id_for(uuid);
drop function if exists public.ensure_catalog_prefix(uuid);
drop table if exists public.catalog_id_prefixes;

drop view if exists public.public_profiles;
drop policy if exists "profiles read own or admin" on public.profiles;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (is_public or id = auth.uid());
grant all on public.profiles to anon;
grant select, insert, references, trigger, truncate, delete on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, bio, is_public) on public.profiles to authenticated;

drop function if exists public.ai_quota_refund();
create or replace function public.ai_quota_take() returns jsonb
language plpgsql security definer set search_path = public as $$
declare cap int := public.cfg_int('ai_daily_cap', 50); c int;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 0) on conflict do nothing;
  update ai_usage set count = count + 1 where user_id = auth.uid() and day = current_date and count < cap returning count into c;
  return jsonb_build_object('allowed', c is not null, 'used', coalesce(c, cap), 'cap', cap);
end $$;
commit;
