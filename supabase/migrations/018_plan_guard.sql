-- 018 (2026-10-18, urgent): a plan can never be set by a client.
-- Profiles: membership, membership_expires, stripe_customer_id, is_admin and lapse_notice_at can only be set by the service role
-- (Stripe webhook / cron), the database owner (SQL), or an admin through admin_grant_plan(). Every new profile starts on Free,
-- whatever the signup metadata (raw_user_meta_data plan/tier/membership) says. Clients already have no column grant on these
-- columns; this trigger is the second, independent guard. Rollback: 018_plan_guard_down.sql
begin;
create or replace function public.profiles_guard_plan() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
        priv boolean := r = 'service_role' or (r = '' and session_user in ('postgres', 'supabase_admin'))
                        or (r = 'authenticated' and auth.uid() is not null and exists (select 1 from profiles a where a.id = auth.uid() and a.is_admin));
begin
  if tg_op = 'INSERT' then
    if not priv then new.membership := 'free'; new.membership_expires := null; new.stripe_customer_id := null; new.is_admin := false; new.lapse_notice_at := null; end if;
  elsif not priv then
    new.membership := old.membership; new.membership_expires := old.membership_expires; new.stripe_customer_id := old.stripe_customer_id;
    new.is_admin := old.is_admin; new.lapse_notice_at := old.lapse_notice_at;
  elsif r = 'authenticated' then
    new.is_admin := old.is_admin; -- even an admin can't hand out admin from the app
  end if;
  return new;
end $$;
revoke all on function public.profiles_guard_plan() from public, anon, authenticated;
drop trigger if exists profiles_aa_guard_plan on public.profiles;
create trigger profiles_aa_guard_plan before insert or update on public.profiles for each row execute function public.profiles_guard_plan();
-- belt and braces: clients can't call the plan setters directly
revoke all on function public.set_membership(uuid, text, timestamptz, text) from public, anon, authenticated;
commit;
