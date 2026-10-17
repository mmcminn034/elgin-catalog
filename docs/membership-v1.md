# Membership v1 (preview branch `preview/membership-v1`)

Status: **preview only**. Migration 012 is written and tested locally (PGlite), **not applied to production**. Stripe is not connected.

## Plans
| Plan | Price | Private items | Private/public toggle | Ask an Expert |
|---|---|---|---|---|
| Free | $0 | 5 (6th+ are created public, with a warning first) | No (public stays public) | 3 / month (configurable) |
| Annual | $29.99 / year | Unlimited while active | Yes | Unlimited, answered first |
| Lifetime | $59.99 once | Unlimited, permanent | Yes | Unlimited, answered first, plus future member features |

AI identification is on every plan, with a per-account daily safety cap (`app_config.ai_daily_cap`, default 50). The cap is not advertised.
Exact locations stay in `find_locations` (owner and editors only) on every plan, always.
The old ~$10 "member" plan is removed. Existing `member` profiles become `annual` (same expiry).
The owner account (`app_config.owner_user_id`) is always Lifetime and admin.

## Lapse (Annual ends)
1. Day 0 after expiry: `apply_membership_lapses()` writes a `lapse_warning` notice. The app shows a banner, and the email is stubbed in `membership-cron`.
2. After `lapse_grace_days` (default 7): private items beyond `free_private_limit` (5) become public. The ones kept are those marked `keep_private` (chosen in *Your catalogs*) first, then the oldest. They get UF ids. Locations are untouched.

## Public ids
- `UF-XXXX`: 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31^4 ≈ 923k). They are random, not sequential, and unique; the id grows to 5+ characters on repeated collisions.
- A UF id is assigned by the `finds_zz_public_id` / `collections_zz_public_id` triggers ONLY while the item is public. It is NULL while private, and its registry row is inactive (not readable).
- If an item is made public again, it gets the same id back, so old share links keep working.
- Users can't write `public_id`; the trigger recomputes it on every write.
- `public_find(uf)` (security definer) returns no internal id, owner or location fields.
- Legacy links (`share/ELG-xxx.html`, QR labels, `#/find/ELG-xxx`) open the app, which redirects to `#/p/UF-…` when the find is public. `public_id_for()` handles the case where the find isn't loaded locally.

## Files
- `supabase/migrations/012_membership_v1.sql` and `012_membership_v1_down.sql`
- `supabase/functions/analyze-find` (calls `ai_quota_take`; falls back to the old rule if 012 is missing)
- `supabase/functions/stripe-webhook` (annual/lifetime)
- `supabase/functions/create-checkout` (new)
- `supabase/functions/membership-cron` (new). **None of these are deployed.**
- `assets/js/membership.js` and `assets/css/membership.css` (new)
- Small hooks in app.js, cloud.js, features.js, learning.js, redesign.js, shell.js, stage2.js, config.js and index.html
- Tests:
  - `tests/sql/membership_v1_test.mjs` (DB: RLS, gates, ids, lapse, AI cap, merch, experts, upgrade path, down)
  - `tests/membership_plan_regress.py` (Mark's 10-case plan, plus experts, merch, pricing and lapse checks)

## Go-live checklist (needs Mark's approval)
1. Back up: tag `backup/pre-membership-<date>`, export profiles/finds/collections/plans.
2. Apply 012 in the Supabase SQL editor (or the Management API). Then check:
   - `select plan_of('<mark id>')` returns `lifetime`;
   - the count of public finds with a `public_id` equals the count of public finds;
   - the anon read of `public_ids` returns only active rows.
3. Deploy `analyze-find` (AI on Free with the daily cap).
4. Set `schema012: true` in `assets/js/config.js`, bump, and merge to main.
5. Optional: schedule `membership-cron` daily (`CRON_SECRET`).
6. Stripe (later):
   - create the products/prices (Annual recurring yearly, Lifetime one-time);
   - set the secrets STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ANNUAL and STRIPE_PRICE_LIFETIME;
   - deploy `create-checkout` and `stripe-webhook --no-verify-jwt`;
   - set `checkoutEnabled: true`.

Rollback: run `012_membership_v1_down.sql`, which restores the 008/011 shapes and maps annual/lifetime back to `member`.
