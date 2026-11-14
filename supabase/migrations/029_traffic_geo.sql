-- 029 (2026-11-14): coarse visitor location (country + state/region only) for first-party traffic.
-- The lookup runs INSIDE our database from a packed copy of DB-IP "IP to City Lite" (CC BY 4.0, attribution:
-- "IP geolocation by DB-IP", https://db-ip.com). No third-party service sees visitor IPs. City / coordinates are
-- dropped when the data is built (tools/geo/build_geo.py loads geo_regions / geo_v4 / geo_v6 and refreshes monthly).
-- track_view() looks up the request IP, stores only meta.cc (country: the cf-ipcountry edge header, else DB-IP) and
-- meta.rg (state/region name, only when DB-IP's country agrees with the edge country), then the IP is discarded with the function's local variables. Never city, never IP.
-- If the lookup fails or the data isn't loaded, the view is still recorded (location shows as Unknown).
-- traffic_rollup() gains 'locations' (top country + region with visits / visitors, Unknown included).
-- Rollback: 029_traffic_geo_down.sql (restores the 028 track_view / traffic_rollup; existing meta.rg values are harmless).
begin;

create table if not exists public.geo_meta (id int primary key check (id = 1), ver int not null, source text not null, built_at timestamptz not null default now());
create table if not exists public.geo_regions (ver int not null, id int not null, cc text not null, region text, primary key (ver, id));
create table if not exists public.geo_v4 (ver int not null, k int not null, data bytea not null, primary key (ver, k));
create table if not exists public.geo_v6 (ver int not null, k bigint not null, data bytea not null, primary key (ver, k));
alter table public.geo_meta enable row level security;  alter table public.geo_regions enable row level security;
alter table public.geo_v4 enable row level security;    alter table public.geo_v6 enable row level security;
revoke all on public.geo_meta, public.geo_regions, public.geo_v4, public.geo_v6 from anon, authenticated;  -- no policies: definer functions only
alter table public.geo_v4 alter column data set storage main;  alter table public.geo_v6 alter column data set storage main;

-- IP text -> (cc, region). Returns nulls on any problem. Internal only (not callable by clients).
create or replace function public.traffic_geo(p_ip text, out cc text, out region text)
language plpgsql stable security definer set search_path = public as $$
declare a inet; gv int; key bigint; off bigint; rk bigint; d bytea; w int; n int; lo int; hi int; mid int; o bigint; rid int;
        s text; l text[]; r text[]; g text[];
begin
  if coalesce(p_ip, '') = '' then return; end if;
  begin a := host(p_ip::inet)::inet; exception when others then return; end;
  select m.ver into gv from geo_meta m where m.id = 1; if gv is null then return; end if;
  if family(a) = 6 and host(a) ~* '^::ffff:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then a := substr(host(a), 8)::inet; end if;  -- IPv4-mapped
  if family(a) = 4 then
    o := a - '0.0.0.0'::inet; key := o >> 16; off := o & 65535; w := 4;
    select x.k, x.data into rk, d from geo_v4 x where x.ver = gv and x.k <= key order by x.k desc limit 1;
  else
    s := lower(host(a)); s := regexp_replace(s, '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$', '0:0');  -- embedded IPv4 tail: only the top 64 bits matter
    if position('::' in s) > 0 then
      l := string_to_array(nullif(split_part(s, '::', 1), ''), ':'); r := string_to_array(nullif(split_part(s, '::', 2), ''), ':');
      g := coalesce(l, '{}') || array_fill('0'::text, array[8 - coalesce(cardinality(l), 0) - coalesce(cardinality(r), 0)]) || coalesce(r, '{}');
    else g := string_to_array(s, ':'); end if;
    if cardinality(g) <> 8 then return; end if;
    key := ('x' || lpad(lpad(g[1], 4, '0') || lpad(g[2], 4, '0'), 16, '0'))::bit(64)::bigint;
    off := ('x' || lpad(lpad(g[3], 4, '0') || lpad(g[4], 4, '0'), 16, '0'))::bit(64)::bigint; w := 6;
    select x.k, x.data into rk, d from geo_v6 x where x.ver = gv and x.k <= key order by x.k desc limit 1;
  end if;
  if d is null then return; end if;
  n := length(d) / w; if n = 0 then return; end if;
  if rk < key then lo := n - 1;                         -- shard without its own row: carry the previous row's last range
  else lo := 0; hi := n - 1;                            -- largest entry with offset <= off (entry 0 is at offset 0)
    while lo < hi loop
      mid := (lo + hi + 1) / 2;
      o := case when w = 4 then (get_byte(d, mid * 4) << 8) | get_byte(d, mid * 4 + 1)
                else (get_byte(d, mid * 6)::bigint << 24) | (get_byte(d, mid * 6 + 1) << 16) | (get_byte(d, mid * 6 + 2) << 8) | get_byte(d, mid * 6 + 3) end;
      if o <= off then lo := mid; else hi := mid - 1; end if;
    end loop;
  end if;
  rid := (get_byte(d, lo * w + w - 2) << 8) | get_byte(d, lo * w + w - 1);
  if rid = 0 then return; end if;
  select gr.cc, gr.region into cc, region from geo_regions gr where gr.ver = gv and gr.id = rid;
exception when others then cc := null; region := null;   -- location must never break page-view logging
end $$;
revoke all on function public.traffic_geo(text) from public, anon, authenticated;

create or replace function public.track_view(p_path text, p_ref text default null, p_src text default null, p_med text default null,
  p_camp text default null, p_rec text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ua text := left(coalesce(h ->> 'user-agent', ''), 400);
  ip text := trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1));
  d date := chi_day(now()); s text; v text; dev text; cc text; rg text; gcc text; pth text; rf text; rec text;
begin
  if coalesce(h ->> 'dnt', '') = '1' or coalesce(h ->> 'sec-gpc', '') = '1' then return; end if;
  if ua = '' or ua ~* '(bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|go-http|monitor|uptime|scan)' then return; end if;
  if auth.uid() is not null and is_admin() then return; end if;   -- the owner's own browsing doesn't count
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
  -- coarse location from our own copy of DB-IP Lite: country + state/region only (never city, never the IP itself)
  begin select g.cc, g.region into gcc, rg from traffic_geo(ip) g; exception when others then gcc := null; rg := null; end;
  -- the edge's country (Cloudflare) wins when both exist: if DB-IP disagrees (VPNs, data centres, stale ranges) keep the
  -- edge country and leave the region Unknown rather than show a region from the wrong country
  if gcc !~ '^[A-Z]{2}$' or (cc is not null and gcc <> cc) then rg := null; elsif cc is null then cc := gcc; end if;
  rg := nullif(left(regexp_replace(coalesce(rg, ''), '[\x00-\x1f<>]', '', 'g'), 80), '');
  insert into traffic_salts (day, salt) values (d, encode(gen_random_bytes(32), 'hex')) on conflict (day) do nothing;
  delete from traffic_salts where day < d;
  select salt into s from traffic_salts where day = d;
  v := left(encode(digest(s || '|' || ip || '|' || ua, 'sha256'), 'hex'), 16);
  ip := null;
  if (select count(*) from analytics_events where kind = 'pageview' and meta ->> 'v' = v and created_at > now() - interval '1 day') >= 300 then return; end if;
  if (select count(*) from analytics_events where kind = 'pageview' and created_at > now() - interval '1 day') >= 50000 then return; end if;
  insert into analytics_events (kind, user_id, ref, meta) values ('pageview', null, pth, jsonb_strip_nulls(jsonb_build_object(
    'v', v, 'r', rf, 's', traffic_clean(p_src, 60), 'm', traffic_clean(p_med, 60), 'c', traffic_clean(p_camp, 80), 'd', dev, 'cc', cc, 'rg', rg, 'rec', rec)));
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
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('cc', cc, 'region', rg, 'visits', n, 'visitors', u) order by n desc, cc nulls last, rg nulls last), '[]') from
      (select meta ->> 'cc' cc, meta ->> 'rg' rg, count(*) n, count(distinct (dy, meta ->> 'v')) u from pv group by 1, 2 order by n desc, 1 nulls last, 2 nulls last limit p_top) x),
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
commit;
