-- 021 (2026-10-18): owner-only admin dashboard. Server-side analytics events (our DB only, no third-party analytics),
-- owner prefs (notification + last visit), admin_stats / admin_daily_series RPCs, client error log, daily report fn.
-- Rollback: 021_admin_dashboard_down.sql
begin;
create table if not exists public.analytics_events (
  id bigserial primary key, kind text not null, user_id uuid, ref text, meta jsonb not null default '{}', created_at timestamptz not null default now());
create index if not exists analytics_events_kind_time on public.analytics_events (kind, created_at desc);
alter table public.analytics_events enable row level security;  -- no policies: only SECURITY DEFINER functions read/write
revoke all on public.analytics_events from anon, authenticated;

create table if not exists public.admin_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_daily_report boolean not null default true, notify_new_signups boolean not null default true,
  last_seen_at timestamptz, prev_seen_at timestamptz, updated_at timestamptz not null default now());
alter table public.admin_prefs enable row level security;
revoke all on public.admin_prefs from anon, authenticated;

create or replace function public.log_event(p_kind text, p_user uuid, p_ref text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as
$$ insert into analytics_events (kind, user_id, ref, meta) values (p_kind, p_user, p_ref, coalesce(p_meta, '{}')) $$;
revoke all on function public.log_event(text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.ae_profiles() returns trigger language plpgsql security definer set search_path = public as
$$ begin perform log_event('signup', new.id, null, '{}'); return new; end $$;
create or replace function public.ae_finds() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'INSERT' then perform log_event('find_added', new.owner, new.catalog_id, jsonb_build_object('visibility', new.visibility));
  elsif new.visibility is distinct from old.visibility then perform log_event('visibility_change', new.owner, new.catalog_id, jsonb_build_object('from', old.visibility, 'to', new.visibility)); end if;
  return new; end $$;
create or replace function public.ae_questions() returns trigger language plpgsql security definer set search_path = public as
$$ begin perform log_event('expert_question', new.asker, new.id::text, '{}'); return new; end $$;
create or replace function public.ae_ai() returns trigger language plpgsql security definer set search_path = public as
$$ declare d int := new.count - case when tg_op = 'UPDATE' then coalesce(old.count, 0) else 0 end;
begin if d > 0 then perform log_event('ai_id', new.user_id, null, jsonb_build_object('n', d)); end if; return new; end $$;
create or replace function public.ae_grants() returns trigger language plpgsql security definer set search_path = public as
$$ begin perform log_event('plan_grant', new.user_id, new.plan, jsonb_build_object('by', new.granted_by)); return new; end $$;
drop trigger if exists zz_ae_signup on public.profiles; create trigger zz_ae_signup after insert on public.profiles for each row execute function public.ae_profiles();
drop trigger if exists zz_ae_finds on public.finds; create trigger zz_ae_finds after insert or update of visibility on public.finds for each row execute function public.ae_finds();
drop trigger if exists zz_ae_questions on public.expert_questions; create trigger zz_ae_questions after insert on public.expert_questions for each row execute function public.ae_questions();
drop trigger if exists zz_ae_ai on public.ai_usage; create trigger zz_ae_ai after insert or update on public.ai_usage for each row execute function public.ae_ai();
drop trigger if exists zz_ae_grants on public.plan_grants; create trigger zz_ae_grants after insert on public.plan_grants for each row execute function public.ae_grants();

-- client errors: signed-in or anonymous; message trimmed, capped per user/day and globally per day
create or replace function public.log_client_error(p_msg text, p_where text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if (select count(*) from analytics_events where kind = 'client_error' and created_at > now() - interval '1 day' and user_id is not distinct from auth.uid()) >= 30 then return; end if;
  if (select count(*) from analytics_events where kind = 'client_error' and created_at > now() - interval '1 day') >= 500 then return; end if;
  insert into analytics_events (kind, user_id, ref, meta) values ('client_error', auth.uid(), left(coalesce(p_where, ''), 120), jsonb_build_object('msg', left(coalesce(p_msg, ''), 300)));
end $$;
revoke all on function public.log_client_error(text, text) from public; grant execute on function public.log_client_error(text, text) to anon, authenticated;

-- backfill history once so charts aren't empty (marked backfill)
insert into analytics_events (kind, user_id, meta, created_at) select 'signup', id, '{"backfill":true}', created_at from profiles
  where not exists (select 1 from analytics_events where kind = 'signup');
insert into analytics_events (kind, user_id, ref, meta, created_at) select 'find_added', owner, catalog_id, jsonb_build_object('visibility', visibility, 'backfill', true), created_at from finds
  where not exists (select 1 from analytics_events where kind = 'find_added');

create or replace function public.chi_day(t timestamptz) returns date language sql immutable as $$ select (t at time zone 'America/Chicago')::date $$;

create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path = public as
$$ declare today date := chi_day(now()); wk date := chi_day(now()) - 6; seen timestamptz; r jsonb;
begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select prev_seen_at into seen from admin_prefs where user_id = auth.uid();
  select jsonb_build_object(
    'generated_at', now(), 'last_visit', seen,
    'users', (select count(*) from profiles),
    'signups_today', (select count(*) from profiles where chi_day(created_at) = today),
    'signups_week', (select count(*) from profiles where chi_day(created_at) >= wk),
    'recent_signups', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (select u.email::text email, p.created_at, p.membership plan from profiles p join auth.users u on u.id = p.id order by p.created_at desc limit 15) x),
    'finds_total', (select count(*) from finds),
    'finds_today', (select count(*) from finds where chi_day(created_at) = today),
    'finds_week', (select count(*) from finds where chi_day(created_at) >= wk),
    'public', (select count(*) from finds where visibility = 'public'), 'private', (select count(*) from finds where visibility <> 'public'),
    'vis_changes_week', (select count(*) from analytics_events where kind = 'visibility_change' and chi_day(created_at) >= wk),
    'plans', (select coalesce(jsonb_object_agg(m, n), '{}') from (select coalesce(membership, 'free') m, count(*) n from profiles group by 1) x),
    'recent_grants', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (select u.email::text email, g.plan, g.expires, g.note, g.created_at from plan_grants g left join auth.users u on u.id = g.user_id order by g.created_at desc limit 10) x),
    'ai_today', (select coalesce(sum(count), 0) from ai_usage where day = today), 'ai_week', (select coalesce(sum(count), 0) from ai_usage where day >= wk), 'ai_total', (select coalesce(sum(count), 0) from ai_usage),
    'questions_total', (select count(*) from expert_questions), 'questions_open', (select count(*) from expert_questions where status is distinct from 'answered'),
    'questions_week', (select count(*) from expert_questions where chi_day(created_at) >= wk),
    'errors_week', (select count(*) from analytics_events where kind = 'client_error' and chi_day(created_at) >= wk),
    'recent_errors', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (select created_at, ref "where", meta->>'msg' msg from analytics_events where kind = 'client_error' order by created_at desc limit 8) x),
    'since_last_visit', jsonb_build_object(
      'signups', (select count(*) from profiles where seen is not null and created_at > seen),
      'finds', (select count(*) from finds where seen is not null and created_at > seen),
      'questions', (select count(*) from expert_questions where seen is not null and created_at > seen),
      'errors', (select count(*) from analytics_events where kind = 'client_error' and seen is not null and created_at > seen)),
    'prefs', (select to_jsonb(p) - 'user_id' from admin_prefs p where user_id = auth.uid())) into r;
  return r;
end $$;

create or replace function public.admin_daily_series(p_days int default 30) returns table (day date, signups int, finds int, ai int, questions int, vis_changes int, errors int)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select d::date,
    (select count(*)::int from profiles where chi_day(created_at) = d::date),
    (select count(*)::int from finds where chi_day(created_at) = d::date),
    (select coalesce(sum(count), 0)::int from ai_usage a where a.day = d::date),
    (select count(*)::int from expert_questions where chi_day(created_at) = d::date),
    (select count(*)::int from analytics_events where kind = 'visibility_change' and chi_day(created_at) = d::date),
    (select count(*)::int from analytics_events where kind = 'client_error' and chi_day(created_at) = d::date)
  from generate_series(chi_day(now()) - (least(greatest(p_days, 1), 365) - 1), chi_day(now()), interval '1 day') d order by 1;
end $$;

-- marks a dashboard visit: prev_seen_at = previous visit (drives "new since last visit")
create or replace function public.admin_mark_seen() returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into admin_prefs (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set prev_seen_at = admin_prefs.last_seen_at, last_seen_at = now(), updated_at = now();
end $$;
create or replace function public.admin_set_prefs(p_daily boolean, p_signups boolean) returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into admin_prefs (user_id, notify_daily_report, notify_new_signups) values (auth.uid(), p_daily, p_signups)
  on conflict (user_id) do update set notify_daily_report = p_daily, notify_new_signups = p_signups, updated_at = now();
end $$;

-- daily owner report data (service role only: used by /workspace/admin/daily_report.sh)
create or replace function public.report_daily(p_day date default null) returns jsonb language plpgsql stable security definer set search_path = public as
$$ declare d date := coalesce(p_day, chi_day(now()) - 1);
begin return jsonb_build_object('day', d,
  'signups', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'at', p.created_at, 'plan', p.membership) order by p.created_at), '[]') from profiles p join auth.users u on u.id = p.id where chi_day(p.created_at) = d),
  'users_total', (select count(*) from profiles),
  'finds', (select count(*) from finds where chi_day(created_at) = d),
  'finds_public', (select count(*) from finds where chi_day(created_at) = d and visibility = 'public'),
  'finds_total', (select count(*) from finds), 'public_total', (select count(*) from finds where visibility = 'public'), 'private_total', (select count(*) from finds where visibility <> 'public'),
  'vis_changes', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'from', meta->>'from', 'to', meta->>'to')), '[]') from analytics_events where kind = 'visibility_change' and chi_day(created_at) = d),
  'ai', (select coalesce(sum(count), 0) from ai_usage where day = d), 'ai_users', (select count(distinct user_id) from ai_usage where day = d and count > 0),
  'ai_max_user', (select coalesce(max(count), 0) from ai_usage where day = d),
  'questions', (select count(*) from expert_questions where chi_day(created_at) = d),
  'grants', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'plan', g.plan, 'note', g.note)), '[]') from plan_grants g left join auth.users u on u.id = g.user_id where chi_day(g.created_at) = d),
  'errors', (select count(*) from analytics_events where kind = 'client_error' and chi_day(created_at) = d),
  'error_samples', (select coalesce(jsonb_agg(m), '[]') from (select distinct meta->>'msg' m from analytics_events where kind = 'client_error' and chi_day(created_at) = d limit 5) x),
  'deletions', (select count(*) from account_deletions where chi_day(deleted_at) = d),
  'prefs', (select coalesce(jsonb_agg(to_jsonb(p) - 'user_id'), '[]') from admin_prefs p));
end $$;
revoke all on function public.report_daily(date) from public, anon, authenticated;
grant execute on function public.report_daily(date) to service_role;
revoke all on function public.admin_stats() from public, anon; grant execute on function public.admin_stats() to authenticated;
revoke all on function public.admin_daily_series(int) from public, anon; grant execute on function public.admin_daily_series(int) to authenticated;
revoke all on function public.admin_mark_seen() from public, anon; grant execute on function public.admin_mark_seen() to authenticated;
revoke all on function public.admin_set_prefs(boolean, boolean) from public, anon; grant execute on function public.admin_set_prefs(boolean, boolean) to authenticated;
revoke all on function public.ae_profiles() from public, anon, authenticated; revoke all on function public.ae_finds() from public, anon, authenticated;
revoke all on function public.ae_questions() from public, anon, authenticated; revoke all on function public.ae_ai() from public, anon, authenticated; revoke all on function public.ae_grants() from public, anon, authenticated;
commit;
