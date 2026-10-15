# Run, deploy, extend

## Run locally
```
python3 -m http.server 8765 --bind 127.0.0.1    # from the repo root, then open http://127.0.0.1:8765/
```
With no network, the app still works from `data/catalog.json` and IndexedDB. For UI tests, `window.ROLLING_OAK_MOCK` simulates the cloud.

## Deploy
- **Site:** push to `main`, and GitHub Pages publishes it. Bump `VERSION` in `sw.js` whenever a cached file changes.
- **Database:** apply the next migration in `supabase/migrations/` (SQL editor or `supabase db push`). Migrations are additive only.
- **Reference layer (when approved):** apply `009_reference_types.sql`, then run `python3 tools/reference/gen_seed_sql.py` and apply the generated `supabase/seed/009_reference_types_seed.sql`.
- **Edge functions:** `supabase functions deploy analyze-find` (and `stripe-webhook`).

### Secret names only (never commit values)
| Where | Names |
|---|---|
| Edge function secrets | `AI_API_KEY`, `AI_BASE_URL` (optional), `AI_MODEL` (optional), `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the last three are provided automatically), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Maintainer shell | `SUPABASE_ACCESS_TOKEN` (Management API) |

The anon key in `assets/js/config.js` is public by design; RLS protects the data.

## Extend
- **New reference source:**
  - Add a crawler that fetches politely (about 1 request per second, robots.txt and terms checked) into a cache.
  - Add a parser to `tools/reference/build_reference.py` that emits the same entry shape, with `sources[{name,url,retrieved,license}]`.
  - Rebuild, run `tests/prompt_test.js`, and regenerate the seed.
- **New trait tag:** add a regex to `TRAITS` in the builder. It is exported as `meta.trait_patterns`, which both the rules engine and the AI retrieval use.
- **Tune scoring:** edit `Score.DEFAULTS` (both copies; `tools/check_shared.py`) or override with `window.ROLLING_OAK_SCORE`. Run `node tests/score_test.js`.
