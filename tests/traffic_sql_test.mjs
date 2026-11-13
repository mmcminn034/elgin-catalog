// Migration 028 (traffic) checked against a local in-memory Postgres (PGlite + pgcrypto), never production.
// Usage: PGLITE_DIR=/tmp/pgl node tests/traffic_sql_test.mjs   (npm i @electric-sql/pglite in PGLITE_DIR once)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const dir = process.env.PGLITE_DIR || "/tmp/pgl", base = path.join(dir, "node_modules/@electric-sql/pglite/dist");
const { PGlite } = await import(path.join(base, "index.js")); const { pgcrypto } = await import(path.join(base, "contrib/pgcrypto.js"));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), mig = f => fs.readFileSync(path.join(root, "supabase/migrations", f), "utf8");
const db = new PGlite({ extensions: { pgcrypto } }); let fails = 0;
const chk = (n, ok, i = "") => { console.log((ok ? "PASS " : "FAIL ") + n, ok ? "" : JSON.stringify(i)); if (!ok) fails++; };
const ADMIN = "a4779d71-ff10-4c11-864d-c79f83214b00", NEWU = "11111111-1111-1111-1111-111111111111", OLDU = "22222222-2222-2222-2222-222222222222";
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.chi_day(t timestamptz) returns date language sql immutable as $$ select (t at time zone 'America/Chicago')::date $$;
  create function public.is_admin() returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid $$;
  create table public.analytics_events (id bigserial primary key, kind text not null, user_id uuid, ref text, meta jsonb not null default '{}', created_at timestamptz not null default now());
  create table public.profiles (id uuid primary key, created_at timestamptz not null default now());
  create table public.reference_media (id text primary key, kind text, title text, data jsonb);
  create function public.is_test_account(u uuid) returns boolean language sql stable as $$ select coalesce((select email ilike '%@unearthedfinds.test' from auth.users where id = u), false) $$;
  create function public.log_event(p_kind text, p_user uuid, p_ref text, p_meta jsonb default '{}') returns void language plpgsql security definer set search_path = public as
  $$ begin if p_user is not null and is_test_account(p_user) then return; end if; insert into analytics_events (kind, user_id, ref, meta) values (p_kind, p_user, p_ref, coalesce(p_meta, '{}')); end $$;
  insert into auth.users values ('${ADMIN}', 'owner@example.com'), ('${NEWU}', 'new@example.com'), ('${OLDU}', 'old@example.com');
  insert into public.profiles values ('${ADMIN}', now() - interval '60 days'), ('${NEWU}', now()), ('${OLDU}', now() - interval '30 days');
  insert into public.reference_media values ('ypm-ant-231217', 'artifact', 'Projectile points', '{"catalog":{"name":"11 projectile points"}}');`);
await db.exec(mig("028_traffic.sql"));
chk("028 applies cleanly", true);
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  UA_DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
async function as(user, headers, sql, params = []) {
  await db.query("select set_config('request.headers', $1, false), set_config('request.jwt.claim.sub', $2, false)", [JSON.stringify(headers), user || ""]);
  return (await db.query(sql, params)).rows; }
const view = (h, u, ...a) => as(u, h, "select public.track_view($1, $2, $3, $4, $5, $6)", [...a, null, null, null, null, null, null].slice(0, 6));
const H1 = { "user-agent": UA_IPHONE, "x-forwarded-for": "203.0.113.5, 10.0.0.1", "cf-ipcountry": "US" }, H2 = { "user-agent": UA_DESK, "x-forwarded-for": "198.51.100.7" };
await view(H1, null, "/?utm_source=x#/", "https://www.reddit.com/r/FossilHunting/comments/abc", "Reddit", "social", "Launch Week!");
await view(H1, null, "/#/try"); await view(H1, null, "/#/reference/record", null, null, null, null, "ypm-ant-231217");
await view(H2, null, "/reference/r/", "https://news.ycombinator.com/item?id=1", "hn", null, "launch", "ypm-ant-231217");
await view(H2, null, "/#access_token=SECRET&type=magiclink");
let rows = (await db.query("select ref, meta from analytics_events where kind = 'pageview' order by id")).rows;
chk("5 page views stored", rows.length === 5, rows);
chk("query string stripped from path", rows[0].ref === "/", rows[0].ref);
chk("referrer reduced to domain", rows[0].meta.r === "reddit.com" && rows[3].meta.r === "news.ycombinator.com", rows.map(r => r.meta.r));
chk("utm cleaned + lowercased", rows[0].meta.s === "reddit" && rows[0].meta.m === "social" && rows[0].meta.c === "launch-week", rows[0].meta);
chk("device from user agent", rows[0].meta.d === "mobile" && rows[3].meta.d === "desktop");
chk("country from edge header", rows[0].meta.cc === "US" && !rows[3].meta.cc);
chk("same browser same day = same hash", rows[0].meta.v === rows[1].meta.v && rows[0].meta.v !== rows[3].meta.v && /^[0-9a-f]{16}$/.test(rows[0].meta.v));
chk("magic-link token never stored", !JSON.stringify(rows).includes("SECRET") && rows[4].ref === "/", rows[4]);
chk("no IP stored anywhere", !JSON.stringify((await db.query("select * from analytics_events")).rows).match(/203\.0\.113|198\.51\.100/));
// skips
const before = rows.length;
await view({ ...H1, dnt: "1" }, null, "/#/dnt"); await view({ ...H1, "sec-gpc": "1" }, null, "/#/gpc");
await view({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }, null, "/#/bot"); await view({}, null, "/#/noua");
await view(H2, ADMIN, "/#/admin");
rows = (await db.query("select ref from analytics_events where kind = 'pageview'")).rows;
chk("DNT, GPC, bots, empty UA and the owner are not counted", rows.length === before, rows);
// salt rotation
let salts = (await db.query("select day from traffic_salts")).rows; chk("one salt (today only)", salts.length === 1);
await db.exec("insert into traffic_salts values (current_date - 3, 'old')"); await view(H2, null, "/#/discover");
salts = (await db.query("select day from traffic_salts")).rows; chk("old salts deleted on next view", salts.length === 1, salts);
// per-visitor cap
for (let i = 0; i < 310; i++) await view({ "user-agent": UA_DESK, "x-forwarded-for": "192.0.2.99" }, null, "/#/spam");
const spam = (await db.query("select count(*)::int n from analytics_events where ref = '/#/spam'")).rows[0].n; chk("per-visitor daily cap = 300", spam === 300, spam);
await db.exec("delete from analytics_events where ref = '/#/spam'");
// funnel + signup source
await db.exec(`insert into analytics_events (kind) values ('guest_find'); insert into analytics_events (kind, user_id) values ('signup', '${NEWU}'), ('signup', '${OLDU}');
  insert into analytics_events (kind, user_id, meta, created_at) values ('signup', '${ADMIN}', '{"backfill":true}', now())`);
await as(NEWU, H1, "select public.traffic_signup_source('reddit', 'social', 'launch', 'https://www.reddit.com/r/x')");
await as(NEWU, H1, "select public.traffic_signup_source('other', null, null, null)");
await as(OLDU, H2, "select public.traffic_signup_source('hn', null, 'launch', null)");
const ss = (await db.query("select user_id, meta from analytics_events where kind = 'signup_source'")).rows;
chk("signup source recorded once, only for a new account", ss.length === 1 && ss[0].meta.s === "reddit" && ss[0].meta.r === "reddit.com", ss);
// admin stats
let err = ""; try { await as(NEWU, H1, "select public.admin_traffic_stats(30)"); } catch (e) { err = e.message; } chk("admin_traffic_stats refuses non-admins", /admin only/.test(err), err);
const st = (await as(ADMIN, H2, "select public.admin_traffic_stats(30) s"))[0].s;
chk("today visits/visitors", st.today.visits === 6 && st.today.visitors === 2, st.today);
chk("series has 30 days, today's bar = 6", st.series.length === 30 && st.series[29].visits === 6, st.series.slice(-2));
chk("top page", st.month.top_pages[0].path && st.month.top_pages.length >= 3, st.month.top_pages);
chk("top referrers", st.month.top_referrers.map(x => x.domain).sort().join() === "news.ycombinator.com,reddit.com", st.month.top_referrers);
chk("campaigns", st.month.campaigns.some(c => c.source === "reddit" && c.campaign === "launch-week") && st.month.campaigns.some(c => c.source === "hn"), st.month.campaigns);
chk("top reference record with title", st.month.top_records[0].id === "ypm-ant-231217" && st.month.top_records[0].views === 2 && st.month.top_records[0].title === "11 projectile points", st.month.top_records);
chk("funnel visit → try → guest find → signup (backfill excluded)", ["visitors", "try_visitors", "guest_finds", "signups"].map(k => st.month.funnel[k]).join() === "2,1,1,2", st.month.funnel);
chk("signups by source", JSON.stringify(st.month.signups_by_source.map(x => [x.source, x.signups]).sort()) === JSON.stringify([["direct / unknown", 1], ["reddit / launch", 1]]), st.month.signups_by_source);
chk("devices + countries", st.month.devices.mobile === 3 && st.month.countries[0].cc === "US", [st.month.devices, st.month.countries]);
const rt = (await db.query("select public.report_traffic(current_date) r")).rows[0].r; chk("report_traffic(day) works", typeof rt.visits === "number", rt);
// grants
const g = (await db.query(`select has_function_privilege('anon', 'public.track_view(text,text,text,text,text,text)', 'execute') a, has_function_privilege('anon', 'public.admin_traffic_stats(int)', 'execute') b,
  has_function_privilege('anon', 'public.report_traffic(date)', 'execute') c, has_function_privilege('authenticated', 'public.traffic_rollup(date,date,int)', 'execute') d,
  has_function_privilege('anon', 'public.traffic_signup_source(text,text,text,text)', 'execute') e, has_table_privilege('anon', 'public.traffic_salts', 'select') f`)).rows[0];
chk("grants: anon may only call track_view", g.a && !g.b && !g.c && !g.d && !g.e && !g.f, g);
// rollback + re-apply
await db.exec(mig("028_traffic_down.sql")); const left = (await db.query("select count(*)::int n from pg_proc where proname in ('track_view','admin_traffic_stats','traffic_rollup','report_traffic','traffic_signup_source')")).rows[0].n;
chk("down script removes everything, keeps other events", left === 0 && (await db.query("select count(*)::int n from analytics_events where kind = 'signup'")).rows[0].n === 3);
await db.exec(mig("028_traffic.sql")); await db.exec(mig("028_traffic.sql")); chk("028 re-applies (idempotent)", true);
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
