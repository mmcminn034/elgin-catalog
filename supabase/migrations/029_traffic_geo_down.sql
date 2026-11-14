-- Rollback for 029: restore the 028 track_view and traffic_rollup, drop the geo lookup. Page-view rows are kept
-- (any meta.rg values stay in place and are simply ignored).
begin;
create or replace function public.track_view(p_path text, p_ref text default null, p_src text default null, p_med text default null,
  p_camp text default null, p_rec text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ua text := left(coalesce(h ->> 'user-agent', ''), 400);
  ip text := trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1));
  d date := chi_day(now()); s text; v text; dev text; cc text; pth text; rf text; rec text;
begin
  if coalesce(h ->> 'dnt', '') = '1' or coalesce(h ->> 'sec-gpc', '') = '1' then return; end if;
  if ua = '' or ua ~* '(bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|go-http|monitor|uptime|scan)' then return; end if;
  if auth.uid() is not null and is_admin() then return; end if;   -- the owner's own browsing doesn't count
  -- path: keep only a safe, short path; drop any query string or fragment payload (never a magic-link token)
  pth := regexp_replace(coalesce(p_path, '/'), '[?&].*$', '');
  if pth ~* '(access_token|refresh_token|token=|type=magiclink|code=)' then pth := '/'; end if;
  pth := left(regexp_replace(pth, '[^A-Za-z0-9/#._:-]+', '', 'g'), 160); if pth = '' then pth := '/'; end if;
  rf := lower(regexp_replace(coalesce(p_ref, ''), '^[a-z]+://', '')); rf := split_part(split_part(rf, '/', 1), ':', 1);
  rf := regexp_replace(rf, '^www\.', ''); rf := nullif(left(regexp_replace(rf, '[^a-z0-9.-]+', '', 'g'), 100), '');
  if rf in ('unearthedfinds.com', 'localhost') then rf := null; end if;
  rec := nullif(left(regexp_replace(coalesce(p_rec, ''), '[^A-Za-z0-9._:-]+', '', 'g'), 120), '');
  dev := case when ua ~* '(ipad|tablet|kindle|silk|playbook)' or (ua ~* 'android' and ua !~* 'mobile') then 'tablet'
              when ua ~* '(mobi|iphone|ipod|android|blackberry|opera mini|iemobile)' then 'mobile' else 'desktop' end;
  cc := upper(coalesce(h ->> 'cf-ipcountry', h ->> 'x-country-code', h ->> 'x-vercel-ip-country', ''));
  if cc !~ '^[A-Z]{2}$' or cc in ('XX', 'T1') then cc := null; end if;
  -- daily salt: created on first view of the day; older salts deleted immediately
  insert into traffic_salts (day, salt) values (d, encode(gen_random_bytes(32), 'hex')) on conflict (day) do nothing;
  delete from traffic_salts where day < d;
  select salt into s from traffic_salts where day = d;
  v := left(encode(digest(s || '|' || ip || '|' || ua, 'sha256'), 'hex'), 16);
  -- abuse caps: 300 views per visitor per day, 50,000 per day overall
  if (select count(*) from analytics_events where kind = 'pageview' and meta ->> 'v' = v and created_at > now() - interval '1 day') >= 300 then return; end if;
  if (select count(*) from analytics_events where kind = 'pageview' and created_at > now() - interval '1 day') >= 50000 then return; end if;
  insert into analytics_events (kind, user_id, ref, meta) values ('pageview', null, pth, jsonb_strip_nulls(jsonb_build_object(
    'v', v, 'r', rf, 's', traffic_clean(p_src, 60), 'm', traffic_clean(p_med, 60), 'c', traffic_clean(p_camp, 80), 'd', dev, 'cc', cc, 'rec', rec)));
end $$;
revoke all on function public.track_view(text, text, text, text, text, text) from public;
grant execute on function public.track_view(text, text, text, text, text, text) to anon, authenticated;

-- shared roll-up (not callable by clients); unique visitors over a range = sum of daily uniques (the hash rotates daily)
create or replace function public.traffic_rollup(p_from date, p_to date, p_top int default 10) returns jsonb
language sql stable security definer set search_path = public as $$
  with pv as (select chi_day(created_at) dy, ref, meta from analytics_events where kind = 'pageview' and chi_day(created_at) between p_from and p_to),
  su as (select e.user_id, e.created_at from analytics_events e where e.kind = 'signup' and coalesce(e.meta ->> 'backfill', '') = '' and chi_day(e.created_at) between p_from and p_to)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'visits', (select count(*) from pv),
    'visitors', (select count(distinct (dy, meta ->> 'v')) from pv),
    'top_pages', (select coalesce(jsonb_agg(jsonb_build_object('path', ref, 'views', n, 'visitors', u) order by n desc, ref), '[]') from
      (select ref, count(*) n, count(distinct (dy, meta ->> 'v')) u from pv group by ref order by n desc, ref limit p_top) x),
    'top_referrers', (select coalesce(jsonb_agg(jsonb_build_object('domain', r, 'visits', n, 'visitors', u) order by n desc, r), '[]') from
      (select meta ->> 'r' r, count(*) n, count(distinct (dy, meta ->> 'v')) u from pv where meta ? 'r' group by 1 order by n desc, 1 limit p_top) x),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('source', s, 'medium', m, 'campaign', c, 'visits', n, 'visitors', u) order by n desc), '[]') from
      (select meta ->> 's' s, meta ->> 'm' m, meta ->> 'c' c, count(*) n, count(distinct (dy, meta ->> 'v')) u from pv where meta ?| array['s', 'm', 'c'] group by 1, 2, 3 order by n desc limit p_top) x),
    'top_records', (select coalesce(jsonb_agg(jsonb_build_object('id', x.rec, 'title', coalesce(rm.data -> 'catalog' ->> 'name', rm.title, x.rec), 'kind', rm.kind, 'views', x.n) order by x.n desc, x.rec), '[]') from
      (select meta ->> 'rec' rec, count(*) n from pv where meta ? 'rec' group by 1 order by n desc, 1 limit p_top) x left join reference_media rm on rm.id = x.rec),
    'devices', (select coalesce(jsonb_object_agg(d, n), '{}') from (select coalesce(meta ->> 'd', 'unknown') d, count(*) n from pv group by 1) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('cc', cc, 'visits', n) order by n desc), '[]') from
      (select meta ->> 'cc' cc, count(*) n from pv where meta ? 'cc' group by 1 order by n desc limit p_top) x),
    'funnel', jsonb_build_object(
      'visitors', (select count(distinct (dy, meta ->> 'v')) from pv),
      'try_visitors', (select count(distinct (dy, meta ->> 'v')) from pv where ref like '/#/try%'),
      'guest_finds', (select count(*) from analytics_events where kind = 'guest_find' and chi_day(created_at) between p_from and p_to),
      'signups', (select count(*) from su)),
    'signups_by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', src, 'signups', n) order by n desc, src), '[]') from
      (select coalesce(nullif(concat_ws(' / ', ss.meta ->> 's', ss.meta ->> 'c'), ''), ss.meta ->> 'r', 'direct / unknown') src, count(*) n
         from su left join analytics_events ss on ss.kind = 'signup_source' and ss.user_id = su.user_id group by 1) x)
  ) $$;
revoke all on function public.traffic_rollup(date, date, int) from public, anon, authenticated;
drop function if exists public.traffic_geo(text);
drop table if exists public.geo_v4, public.geo_v6, public.geo_regions, public.geo_meta;
commit;
