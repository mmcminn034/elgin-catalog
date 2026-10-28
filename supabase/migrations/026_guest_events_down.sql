-- Rollback for 026_guest_events.sql (existing guest_* event rows are removed)
begin;
drop function if exists public.admin_guest_stats();
drop function if exists public.log_guest_event(text);
delete from public.analytics_events where kind in ('guest_start', 'guest_find', 'guest_signup_click', 'guest_import');
commit;
