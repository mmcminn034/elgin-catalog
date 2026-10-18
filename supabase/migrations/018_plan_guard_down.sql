begin;
drop trigger if exists profiles_aa_guard_plan on public.profiles;
drop function if exists public.profiles_guard_plan();
commit;
