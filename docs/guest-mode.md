# Guest mode ("Try it without an account")

Visitors can try the site with no sign-up. Entry points: the **Try it without an account** button on the home page and in the sign-in dialog, and the "Try it free" nav link. Route: `#/try`, `#/try/new`, `#/try/G-n`. Code: `assets/js/guest.js` (window.Guest).

## What a guest can do
- Add up to **3 finds** (1-4 photos each) with the object name, category, key features, notes, optional **town/county**, the attribute form (`Matching.ATTRS`) and a photo tag.
- See the **free rules-based analysis** (`Analysis.render`, with the "save as verified" block removed), the photo-quality checks (`AiPre.quality`), the Learn page and Discover.
- Not available: paid AI calls (the button reads "Sign up free to run AI ID" and opens the email sign-up), sharing, public links, collaboration, expert review.

## Where the data lives
- Browser only: IndexedDB `uf-guest` / store `finds`, with a `localStorage` `uf-guest-finds` fallback. It never goes through the app's `DB` layer, so nothing is synced, queued, or uploaded.
- Notice shown on every guest page: "Guest finds stay on this device only; clearing your browser deletes them."
- Photos are re-encoded through a canvas (max 1400 px, JPEG 0.82) which drops all EXIF, including GPS and camera data.
- No coordinate or address fields. The place box and free-text fields reject coordinates, DMS, street addresses, county/FM roads and ZIP codes.

## Sign-up and import
- At the 3-find limit, on "Save for keeps", or on "Sign up free to run AI ID": an email-only form calls `Cloud.magicLink` (no password, name or phone).
- After the magic link signs the user in on the same browser, a banner and an import panel appear. `App.importGuestFind` saves each find as **private** (`visibility: private`, `is_public: false`), runs `Membership.beforeSave`, and stops at the free 5-private limit (the rest stay on the device). It never changes or grants a plan; the server plan guard still applies.
- A local copy is deleted only after the find has synced (it is not in `ro-pending-sync`). On a sync failure the copy is kept and marked `importedAs`, so it is never imported twice.
- Attributes are carried to the AI pre-flight via `localStorage["ro-ai-attrs"]`.

## Anonymous counters (migration 026)
- `log_guest_event(kind)` (anon + authenticated) accepts only `guest_start`, `guest_find`, `guest_signup_click`, `guest_import`; stores kind + timestamp only (no user id, IP, ref or meta); capped at 5,000 per kind per day. `guest_start` is sent once per browser session.
- `admin_guest_stats()` (admin only) feeds the "guests" tile on the admin dashboard.
- Rollback: `supabase/migrations/026_guest_events_down.sql`.

## Tests
- `tests/guest_regress.py <url>` (Playwright, fully mocked, no production writes): entry points, validation, 3-find limit, EXIF/GPS stripping, no network leakage, analysis and AI gating, counters, reload persistence, import (free user, at-limit, sync failure).
- Run it against a test copy (`mk_test_copy.sh` adds the test-device line to config.js) or the live site: `python3 tests/guest_regress.py https://unearthedfinds.com/`.
- Some older suites fail on a bare repo checkout only because `data/catalog.json` lacks the private ELG-017..020 rows; suites needing `SVC_KEY` cannot run without it.
