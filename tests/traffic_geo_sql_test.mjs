// Migration 029 (coarse visitor location) checked against a local in-memory Postgres (PGlite + pgcrypto), never production.
// Packs a small DB-IP-format fixture with tools/geo/build_geo.py --json, loads it, and checks lookups, storage and the roll-up.
// Usage: PGLITE_DIR=/tmp/pgl node tests/traffic_geo_sql_test.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import zlib from "node:zlib"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const dir = process.env.PGLITE_DIR || "/tmp/pgl", base = path.join(dir, "node_modules/@electric-sql/pglite/dist");
const { PGlite } = await import(path.join(base, "index.js")); const { pgcrypto } = await import(path.join(base, "contrib/pgcrypto.js"));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), mig = f => fs.readFileSync(path.join(root, "supabase/migrations", f), "utf8");
const db = new PGlite({ extensions: { pgcrypto } }); let fails = 0;
const chk = (n, ok, i = "") => { console.log((ok ? "PASS " : "FAIL ") + n, ok ? "" : JSON.stringify(i)); if (!ok) fails++; };
const ADMIN = "a4779d71-ff10-4c11-864d-c79f83214b00";
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.chi_day(t timestamptz) returns date language sql immutable as $$ select (t at time zone 'America/Chicago')::date $$;
  create function public.is_admin() returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid $$;
  create table public.analytics_events (id bigserial primary key, kind text not null, user_id uuid, ref text, meta jsonb not null default '{}', created_at timestamptz not null default now());
  create table public.profiles (id uuid primary key, created_at timestamptz not null default now());
  create table public.reference_media (id text primary key, kind text, title text, data jsonb);
  create function public.log_event(p_kind text, p_user uuid, p_ref text, p_meta jsonb default '{}') returns void language sql as $$ insert into analytics_events (kind, user_id, ref, meta) values (p_kind, p_user, p_ref, coalesce(p_meta, '{}')) $$;`);
await db.exec(mig("028_traffic.sql"));
// a view recorded BEFORE the geo data is loaded must still work (Unknown location)
await db.exec(mig("029_traffic_geo.sql")); chk("029 applies cleanly on top of 028", true);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const view = async (ip, extra = {}, pathName = "/") => { await db.query("select set_config('request.headers', $1, false), set_config('request.jwt.claim.sub', '', false)", [JSON.stringify({ "user-agent": UA, "cf-connecting-ip": ip, ...extra })]);
  await db.query("select public.track_view($1)", [pathName]); return (await db.query("select meta from analytics_events where kind = 'pageview' order by id desc limit 1")).rows[0].meta; };
let m = await view("8.8.8.8", { "cf-ipcountry": "US" }, "/before"); chk("no geo data yet: view still recorded with edge-header country, no region", m.cc === "US" && !m.rg, m);
// fixture in DB-IP City Lite CSV format: start,end,continent,country,region,city,lat,lon (city/lat/lon must be dropped)
const csv = [
  "0.0.0.0,0.255.255.255,ZZ,ZZ,,,0,0",
  "1.0.0.0,8.8.7.255,NA,US,Virginia,Ashburn,39,-77",
  "8.8.8.0,8.8.8.255,NA,US,California,\"Mountain View\",37.4,-122",
  "8.8.9.0,23.255.255.255,NA,US,Texas,Elgin,30.3,-97.3",          // spans many /16 shards
  "24.0.0.0,24.0.0.127,NA,CA,Ontario,Toronto,43,-79",
  "24.0.0.128,24.0.0.255,EU,DE,,,51,9",                              // country without a region
  "24.0.1.0,255.255.255.255,ZZ,ZZ,,,0,0",
  "::,2600:ffff:ffff:ffff:ffff:ffff:ffff:ffff,ZZ,ZZ,,,0,0",
  "2601::,2601:0:ffff:ffff:ffff:ffff:ffff:ffff,NA,US,Oklahoma,Tulsa,36,-96",
  "2601:1::,2601:1:0:0:ffff:ffff:ffff:ffff,NA,US,Texas,Austin,30,-97",
  "2601:1:0:1::,2a0f:ffff:ffff:ffff:ffff:ffff:ffff:ffff,EU,GB,England,London,51,0",
  "2a10::,ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff,ZZ,ZZ,,,0,0"].map(l => l.replace(/\s+\/\/.*$/, "")).join("\n") + "\n";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geo-")), fx = path.join(tmp, "fx.csv.gz"); fs.writeFileSync(fx, zlib.gzipSync(csv));
const pk = JSON.parse(execFileSync("python3", [path.join(root, "tools/geo/build_geo.py"), "--json", fx]).toString());
chk("builder keeps no city names", !JSON.stringify(pk).match(/Ashburn|Mountain View|Elgin|Toronto|Tulsa|Austin|London/));
await db.exec("insert into geo_meta values (1, 7, 'fixture', now())");
for (const [i, cc, rg] of pk.regions) await db.query("insert into geo_regions values (7, $1, $2, $3)", [i, cc, rg || null]);
for (const [k, h] of pk.v4) await db.query("insert into geo_v4 values (7, $1, decode($2, 'hex'))", [k, h]);
for (const [k, h] of pk.v6) await db.query("insert into geo_v6 values (7, $1, decode($2, 'hex'))", [k, h]);
const geo = async ip => (await db.query("select cc, region from public.traffic_geo($1)", [ip])).rows[0];
const cases = [["8.8.8.8", "US", "California"], ["8.8.7.255", "US", "Virginia"], ["1.0.0.0", "US", "Virginia"], ["8.8.9.0", "US", "Texas"],
  ["20.1.2.3", "US", "Texas"], ["23.255.255.255", "US", "Texas"], ["24.0.0.5", "CA", "Ontario"], ["24.0.0.200", "DE", null], ["24.0.1.0", null, null],
  ["0.1.2.3", null, null], ["200.1.1.1", null, null], ["2601::1", "US", "Oklahoma"], ["2601:0:ffff::1", "US", "Oklahoma"], ["2601:1::5", "US", "Texas"],
  ["2601:1:0:1::9", "GB", "England"], ["2a00:1450:4001::1", "GB", "England"], ["2a10::1", null, null], ["2001:db8::1", null, null],
  ["::ffff:8.8.8.8", "US", "California"], ["not-an-ip", null, null], ["", null, null], [null, null, null]];
for (const [ip, cc, rg] of cases) { const g = await geo(ip); chk(`lookup ${ip} → ${cc || "Unknown"}${rg ? " / " + rg : ""}`, (g?.cc ?? null) === cc && (g?.region ?? null) === rg, g); }
// track_view stores only country + region; edge header is the fallback; no IP or city anywhere
m = await view("8.8.8.8", { "cf-ipcountry": "US" }); chk("pageview stores cc + rg", m.cc === "US" && m.rg === "California", m);
m = await view("2601:1::77"); chk("IPv6 pageview stores cc + rg", m.cc === "US" && m.rg === "Texas", m);
m = await view("24.0.0.200", { "cf-ipcountry": "DE" }); chk("country without region", m.cc === "DE" && !m.rg, m);
m = await view("200.1.1.1", { "cf-ipcountry": "BR" }); chk("lookup miss falls back to edge-header country, no region", m.cc === "BR" && !m.rg, m);
m = await view("8.8.8.8", { "cf-ipcountry": "GA" }); chk("edge country disagrees with DB-IP: edge country kept, region Unknown", m.cc === "GA" && !m.rg, m);
m = await view("garbage", {}); chk("bad IP: still recorded, location unknown", !m.cc && !m.rg && m.v, m);
await view("20.9.9.9", {}, "/x"); await view("20.9.9.9", {}, "/y");
const all = JSON.stringify((await db.query("select * from analytics_events")).rows);
chk("no IP or city stored", !all.match(/8\.8\.8|2601|24\.0\.0|200\.1\.1|20\.9\.9|Mountain View|Elgin|Austin/), all);
// a broken geo table must not break logging
await db.exec("alter table geo_regions rename to geo_regions_x"); m = await view("8.8.8.8", { "cf-ipcountry": "US" }, "/broken");
chk("broken lookup: view still recorded with header country", m.cc === "US" && !m.rg, m); await db.exec("alter table geo_regions_x rename to geo_regions");
// roll-up 'locations' (Unknown included), admin-only access unchanged
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN]);
const st = (await db.query("select public.admin_traffic_stats(30) s")).rows[0].s, L = st.month.locations;
chk("locations roll-up: Texas first with 3 visits, 2 visitors", L[0].cc === "US" && L[0].region === "Texas" && L[0].visits === 3 && L[0].visitors === 2, L);
chk("locations include California and Unknown rows", L.some(x => x.region === "California" && x.visits === 1) && L.some(x => !x.cc && !x.region), L);
chk("report_traffic carries locations", Array.isArray((await db.query("select public.report_traffic(current_date) r")).rows[0].r.locations));
const g = (await db.query(`select has_function_privilege('anon', 'public.traffic_geo(text)', 'execute') a, has_function_privilege('authenticated', 'public.traffic_geo(text)', 'execute') b,
  has_table_privilege('anon', 'public.geo_v4', 'select') c, has_table_privilege('authenticated', 'public.geo_regions', 'select') d`)).rows[0];
chk("geo tables + lookup are not client-accessible", !g.a && !g.b && !g.c && !g.d, g);
// rollback + re-apply
await db.exec(mig("029_traffic_geo_down.sql"));
const left = (await db.query("select (select count(*)::int from pg_proc where proname = 'traffic_geo') f, (select count(*)::int from pg_class where relname like 'geo\\_%') t")).rows[0];
m = await view("8.8.8.8", { "cf-ipcountry": "US" }, "/after-down");
chk("down script drops geo objects, 028 behaviour restored, rows kept", left.f === 0 && left.t === 0 && m.cc === "US" && !m.rg && (await db.query("select count(*)::int n from analytics_events where meta ? 'rg'")).rows[0].n >= 3, [left, m]);
await db.exec(mig("029_traffic_geo.sql")); await db.exec(mig("029_traffic_geo.sql")); chk("029 re-applies (idempotent)", true);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
