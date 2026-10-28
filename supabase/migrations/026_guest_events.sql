-- 026 (2026-10-28): anonymous guest-mode counters for the owner dashboard.
-- log_guest_event(kind): callable without an account; stores ONLY the kind and a timestamp (user_id null, ref null, meta {}). No IP, no cookie id, no device id.
-- Client sends at most one 'guest_start' per browser session. Daily cap of 5,000 rows per kind stops abuse.
-- admin_guest_stats(): admin-only roll-up for the dashboard. Rollback: 026_guest_events_down.sql
begin;
create or replace function public.log_guest_event(p_kind text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('guest_start', 'guest_find', 'guest_signup_click', 'guest_import') then return; end if;
  if (select count(*) from analytics_events where kind = p_kind and created_at > now() - interval '1 day') >= 5000 then return; end if;
  insert into analytics_events (kind, user_id, ref, meta) values (p_kind, null, null, '{}'::jsonb);
end $$;
revoke all on function public.log_guest_event(text) from public;
grant execute on function public.log_guest_event(text) to anon, authenticated;

create or replace function public.admin_guest_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := chi_day(now()); wk date := chi_day(now()) - 6; r jsonb;
begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'sessions_today', (select count(*) from analytics_events where kind = 'guest_start' and chi_day(created_at) = today),
    'sessions_week', (select count(*) from analytics_events where kind = 'guest_start' and chi_day(created_at) >= wk),
    'sessions_total', (select count(*) from analytics_events where kind = 'guest_start'),
    'finds_week', (select count(*) from analytics_events where kind = 'guest_find' and chi_day(created_at) >= wk),
    'signup_clicks_week', (select count(*) from analytics_events where kind = 'guest_signup_click' and chi_day(created_at) >= wk),
    'imports_week', (select count(*) from analytics_events where kind = 'guest_import' and chi_day(created_at) >= wk),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'sessions', n) order by d), '[]') from (select g::date d, (select count(*) from analytics_events where kind = 'guest_start' and chi_day(created_at) = g::date) n from generate_series(today - 13, today, interval '1 day') g) x)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_guest_stats() from public, anon;
grant execute on function public.admin_guest_stats() to authenticated;
commit;
