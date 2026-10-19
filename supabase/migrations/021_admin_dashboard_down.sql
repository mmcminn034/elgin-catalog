begin;
drop trigger if exists zz_ae_signup on public.profiles; drop trigger if exists zz_ae_finds on public.finds; drop trigger if exists zz_ae_questions on public.expert_questions;
drop trigger if exists zz_ae_ai on public.ai_usage; drop trigger if exists zz_ae_grants on public.plan_grants;
drop function if exists public.ae_profiles(), public.ae_finds(), public.ae_questions(), public.ae_ai(), public.ae_grants(), public.log_client_error(text, text),
  public.admin_stats(), public.admin_daily_series(int), public.admin_mark_seen(), public.admin_set_prefs(boolean, boolean), public.report_daily(date), public.log_event(text, uuid, text, jsonb), public.chi_day(timestamptz);
drop table if exists public.admin_prefs; drop table if exists public.analytics_events;
commit;
