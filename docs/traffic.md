# Traffic reporting (first-party, privacy-friendly)

Added in ro-v9.16.0. Everything lives in our own Supabase database; there are no third-party analytics, no cookies and no IP addresses stored.

## How it works
| Piece | Where |
|---|---|
| Logger | `assets/js/traffic.js`, loaded by `index.html` (every app route) and by every generated `reference/` SEO page (`tools/reference/build_seo_pages.py`) |
| Storage | the existing `analytics_events` table, `kind = 'pageview'` (no new event table) |
| Write path | `track_view()` RPC, migration `supabase/migrations/028_traffic.sql` (rollback `028_traffic_down.sql`) |
| Dashboard | Owner admin page (`#/admin`) → **Traffic** section, via the admin-only `admin_traffic_stats(days)` RPC |
| Daily report | `tools/admin/daily_report.sh` (copy at `/workspace/admin/daily_report.sh`) adds a "Site traffic" line: yesterday's visits, unique visitors, top referrer, top page. Uses `report_traffic(day)` (service role) and falls back to reading `analytics_events` directly |

### What one page view stores
| Field | Stored as | Notes |
|---|---|---|
| Page | `ref` | Short path only: `/`, `/#/try`, `/#/try/new`, `/#/discover`, `/#/reference/record`, `/reference/`, `/reference/r/`… Deeper app segments (find ids, user pages), query strings and magic-link tokens are dropped in the browser **and** in SQL |
| Referrer | `meta.r` | Domain only (`reddit.com`), first page of a visit only; our own domain is ignored |
| Campaign | `meta.s` / `meta.m` / `meta.c` | `utm_source` / `utm_medium` / `utm_campaign`, lower-cased, first page of a visit only |
| Device | `meta.d` | `mobile` / `tablet` / `desktop`, from the user agent on the server |
| Country | `meta.cc` | 2-letter code from the edge's `cf-ipcountry` header when Supabase passes it; otherwise left empty. No geo-IP lookup service |
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

## Turning it on / rollback
1. Apply `supabase/migrations/028_traffic.sql` in the Supabase SQL editor (or with a management token). Nothing else is needed: the deployed site starts logging on the next page view, and the dashboard and daily report pick it up.
2. Until then the logger makes one quiet attempt per browser session (404) and stops; the dashboard says "switches on as soon as database update 028 is applied"; the daily report says "not counting yet".
3. Rollback: `028_traffic_down.sql` (keeps the anonymous page-view rows unless you uncomment the delete). The client code is harmless without the functions.

## Tests
- `PGLITE_DIR=/tmp/pgl node tests/traffic_sql_test.mjs` — runs 028 on an in-memory Postgres (PGlite + pgcrypto; `npm i @electric-sql/pglite` in `/tmp/pgl`): stored fields, path/token/referrer scrubbing, no IPs, DNT/GPC/bot/owner skips, salt rotation, caps, sign-up source, admin-only stats, grants, rollback, idempotency.
- `python3 tests/traffic_regress.py URL` — browser: static and app routes, UTM + referrer, record ids, DNT, owner exclusion, 404 back-off, no cookies, admin Traffic section, sign-up attribution.
