-- Rollback for 028_traffic.sql. Removes the traffic functions, the salt table and the pageview index.
-- Page-view rows themselves are kept unless you uncomment the delete (they're anonymous; the hash can't be reversed).
begin;
drop function if exists public.report_traffic(date);
drop function if exists public.admin_traffic_stats(int);
drop function if exists public.traffic_rollup(date, date, int);
drop function if exists public.traffic_signup_source(text, text, text, text);
drop function if exists public.track_view(text, text, text, text, text, text);
drop function if exists public.traffic_clean(text, int);
drop index if exists public.analytics_events_pv_v;
drop table if exists public.traffic_salts;
-- delete from public.analytics_events where kind in ('pageview', 'signup_source');
commit;
