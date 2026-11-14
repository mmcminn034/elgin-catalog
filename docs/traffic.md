# Traffic reporting (first-party, privacy-friendly)

Added in ro-v9.16.0. Everything lives in our own Supabase database; there are no third-party analytics, no cookies and no IP addresses stored.

## How it works
| Piece | Where |
|---|---|
| Logger | `assets/js/traffic.js`, loaded by `index.html` (every app route) and by every generated `reference/` SEO page (`tools/reference/build_seo_pages.py`) |
| Storage | the existing `analytics_events` table, `kind = 'pageview'` (no new event table) |
| Write path | `track_view()` RPC, migration `supabase/migrations/028_traffic.sql` (rollback `028_traffic_down.sql`) |
| Dashboard | Owner admin page (`#/admin`) → **Traffic** section, via the admin-only `admin_traffic_stats(days)` RPC |
| Daily report | `tools/admin/daily_report.sh` (copy at `/workspace/admin/daily_report.sh`) adds a "Site traffic" line: yesterday's visits, unique visitors, top referrer, top page, top 3 locations. Uses `report_traffic(day)` (service role) and falls back to reading `analytics_events` directly |

### What one page view stores
| Field | Stored as | Notes |
|---|---|---|
| Page | `ref` | Short path only: `/`, `/#/try`, `/#/try/new`, `/#/discover`, `/#/reference/record`, `/reference/`, `/reference/r/`… Deeper app segments (find ids, user pages), query strings and magic-link tokens are dropped in the browser **and** in SQL |
| Referrer | `meta.r` | Domain only (`reddit.com`), first page of a visit only; our own domain is ignored |
| Campaign | `meta.s` / `meta.m` / `meta.c` | `utm_source` / `utm_medium` / `utm_campaign`, lower-cased, first page of a visit only |
| Device | `meta.d` | `mobile` / `tablet` / `desktop`, from the user agent on the server |
| Country | `meta.cc` | 2-letter code from the edge's `cf-ipcountry` header (Cloudflare); if absent, from our own DB-IP Lite lookup (migration 029); otherwise empty (shown as Unknown) |
| State / region | `meta.rg` | State, province or region name (e.g. `Texas`) from the DB-IP lookup, kept only when DB-IP's country agrees with the edge country (VPN / data-centre mismatches show as region Unknown). **Never city, never coordinates, never the IP** |
| Visitor | `meta.v` | `sha256(daily salt | IP | user agent)`, 16 hex chars. The salt is random, kept for the current America/Chicago day only (`traffic_salts`) and deleted at the first view of the next day, so the hash can't be reversed or linked across days |
| Record | `meta.rec` | Reference Catalog record id on record views (app dialog or static page) |
| Time | `created_at` | |

**Not counted:** browsers sending Do Not Track or Global Privacy Control (checked in the browser and again on the server), obvious bots/crawlers/link previews, the owner (signed in as admin, or any browser where the owner has signed in: `localStorage uf-owner = 1`), localhost/dev hosts (unless `localStorage uf-track-dev = 1`), more than 300 views per visitor per day, more than 50,000 views per day overall.

**Unique visitors** over 7 or 30 days are the sum of each day's unique visitors (the hash rotates daily by design), so one person visiting on three days counts three times.

### Funnel (dashboard)
visitors → opened **Try it free** (`/#/try…` page views) → guest finds added (`guest_find` events, migration 026) → sign-ups (`signup` events). Each stage is an aggregate count for the period, not a per-person trail.

### Sign-ups by source
When a visit arrives with UTM tags or an outside referrer, the browser keeps `{source, medium, campaign, referrer domain}` in `localStorage uf-src` for 30 days (nothing identifying, never sent on its own). If that browser then signs in to an account created in the last 3 days, it sends the source once via `traffic_signup_source()`, stored as `kind = 'signup_source'`. Older accounts are ignored. Shown as "source / campaign", else the referrer domain, else "direct / unknown".

## UTM tags for campaign links
Put the tags **before** any `#/…` part of the link: `https://unearthedfinds.com/?utm_source=reddit&utm_medium=social&utm_campaign=launch#/reference` (tags inside the hash also work, but the plain form is safest). For the static catalog pages: `https://unearthedfinds.com/reference/?utm_source=reddit&utm_medium=social&utm_campaign=launch`.

Use lower case and these values so reports group cleanly:

| Where it's posted | utm_source | utm_medium | Example link |
|---|---|---|---|
| Reddit (r/FossilHunting etc.) | `reddit` | `social` | `https://unearthedfinds.com/reference/?utm_source=reddit&utm_medium=social&utm_campaign=launch` |
| X | `x` | `social` | `https://unearthedfinds.com/reference/?utm_source=x&utm_medium=social&utm_campaign=museum-piece` |
| Facebook groups | `facebook` | `social` | `…/reference/?utm_source=facebook&utm_medium=social&utm_campaign=launch` |
| Hacker News | `hackernews` | `forum` | `…/reference/?utm_source=hackernews&utm_medium=forum&utm_campaign=launch` |
| Rockhound / archaeology forums | `forum-name` (e.g. `rockhounds-forum`) | `forum` | `…/reference/?utm_source=rockhounds-forum&utm_medium=forum&utm_campaign=launch` |
| Texas clubs / newsletters | club short name (e.g. `tas`) | `club` or `email` | `…/reference/texas.html?utm_source=tas&utm_medium=club&utm_campaign=launch` |
| Free directory / listing sites | site name | `listing` | `…/?utm_source=producthunt&utm_medium=listing&utm_campaign=launch` |
| Try-it-free call to action | any of the above | as above | `https://unearthedfinds.com/?utm_source=reddit&utm_medium=social&utm_campaign=launch#/try` |

Campaign names: `launch` (first two weeks), `museum-piece` (weekly featured record posts), `new-additions` (weekly "new records" posts), `try-free` (posts that point at guest mode). Add new names freely; keep them short, lower case, hyphenated.

## Visitor location (migration 029, ro-v9.18.0)
- **What:** country + state/region only. Shown on the owner Traffic section as **Top locations** (US states by name, other places as "Region, Country", missing lookups as "Unknown") and in the daily report's Site traffic line ("top locations Texas 5, Oklahoma 2, Unknown 1").
- **How:** `track_view()` passes the request IP (`cf-connecting-ip`) to `traffic_geo(ip)`, which looks it up **inside our database**. Only `cc` and `rg` are written to `meta`; the IP lives only in the function's local variables and is never written anywhere. No third-party service sees visitor IPs and nothing is called over the network per visit.
- **Data source:** [DB-IP "IP to City Lite"](https://db-ip.com/db/download/ip-to-city-lite), free, **CC BY 4.0**. Attribution "IP geolocation by DB-IP" (link to https://db-ip.com) is shown in the privacy note on the home page and under Top locations. City names and coordinates are discarded at build time.
- **Storage:** `geo_regions` (≈3,900 country/region names), `geo_v4` (IPv4 by /16 shard, 4-byte entries) and `geo_v6` (IPv6 by /32 shard at /64 precision, 6-byte entries), versioned via `geo_meta`; ≈22 MB, ≈4 ms per lookup. RLS on, no policies, no client grants. `traffic_geo()` is not callable by clients.
- **Refresh:** `tools/geo/build_geo.py [YYYY-MM]` downloads the monthly CSV to `/workspace/geo/`, packs it, loads a new version through the management API (`/workspace/.sbp_token`), switches `geo_meta` and deletes the old version. `tools/reference/weekly_refresh.sh` runs it with `--if-stale`, so a new DB-IP month is picked up automatically (non-fatal if DB-IP hasn't published yet).
- **Failure behaviour:** if the data is missing, the IP is unparseable or the lookup errors, the page view is still recorded with the header country (or none) and shows as Unknown. Tracking never blocks a page load (the browser call is fire-and-forget).
- **Rollback:** `029_traffic_geo_down.sql` restores the 028 functions and drops the geo tables; page-view rows (including any `meta.rg`) are kept.
- **Status: applied 2026-11-14** (ro-v9.18.0; region-vs-edge-country rule added in ro-v9.18.1), data version 202611 loaded.

## Turning it on / rollback
1. **Status: applied 2026-11-13.** `supabase/migrations/028_traffic.sql` is live. The site logs page views, the admin Traffic section reads `admin_traffic_stats()`, and the daily report prints a Site traffic line via `report_traffic()`.
2. Rollback: `028_traffic_down.sql` (keeps the anonymous page-view rows unless you uncomment the delete). Without the functions, the logger makes one quiet attempt per browser session (404) and stops; the dashboard would say "switches on as soon as database update 028 is applied".

## Tests
- `PGLITE_DIR=/tmp/pgl node tests/traffic_sql_test.mjs` — runs 028 on an in-memory Postgres (PGlite + pgcrypto; `npm i @electric-sql/pglite` in `/tmp/pgl`): stored fields, path/token/referrer scrubbing, no IPs, DNT/GPC/bot/owner skips, salt rotation, caps, sign-up source, admin-only stats, grants, rollback, idempotency.
- `PGLITE_DIR=/tmp/pgl node tests/traffic_geo_sql_test.mjs` — runs 029 on PGlite with a packed DB-IP-format fixture: IPv4/IPv6/mapped lookups across shard boundaries, country-only and unknown ranges, header fallback, bad IPs, broken lookup tolerance, no IP/city stored, `locations` roll-up, no client grants, rollback, idempotency.
- `python3 tests/traffic_regress.py URL` — browser: static and app routes, UTM + referrer, record ids, DNT, owner exclusion, 404 back-off, no cookies, admin Traffic section, sign-up attribution.
