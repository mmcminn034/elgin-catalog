# Testing

| Command | Checks |
|---|---|
| `node tests/score_test.js` | Score math: caps, 100% rule, bands, label mapping, colours, overrides |
| `node tests/prompt_test.js` | Reference retrieval (top 5, region bonus rather than filter), attribution, EXTERNAL REFERENCE labels, region-neutral prompt, AI clamp (95 cap, coordinate scrub, labels, garbage, max 3) |
| `python3 tools/check_shared.py` | Browser and edge copies of retrieve/score/prompt are identical |
| `node --check assets/js/*.js` | Syntax |
| `python3 tests/reference_regress.py URL [shots]` | Chips, reference dialog, % bars ≤95, Why this score, AI % cap, prompt view, reference outage alert, AI failure alert, ambiguous-Verified ≤95, Verified single pick 100, low case, banner when public-types.json fails |
| `python3 tests/redesign_regress.py URL [shots]` | Redesign: sidebar/drawer links, review screen parts, library filters, settings, all views render, mobile 390 no overflow |
| `python3 tests/s5_regress.py`, `review_status_regress.py`, `category_persist_regress.py`, `source_enum_regress.py`, `add_flow_regress.py` | Existing regressions (status, Discover, measurement sources, categories, add flow) |

The Playwright tests run against a local `python3 -m http.server`, using Chrome at `/usr/bin/google-chrome`. Supabase calls are routed to an empty mock.

## Added 2026-10-27 (matching + Learn)
| Command | Covers |
|---|---|
| `node tests/matching_test.js` | Attributes, region priors, output sanitizers, calibration (never raises a %), cache key, cost estimate, prompt additions |
| `deno run -A tests/edge/analyze_find_mock_test.ts` | The whole `analyze-find` function against a mocked Supabase and a mocked AI provider: attributes, priors, history, reference images at low detail, calibration, cache hit, refresh, retry without reference images on a 400, per-account and global caps. No network, no AI spend |
| `python3 tests/learn_matching_regress.py URL` | Learn page (tabs, search, gallery credits, link-only sources), natural-rock ranking, AI pre-flight (required fields, request payload, result sections, Keep feedback meta, prefill, cancel) |
| `python3 tools/check_shared.py` | Now also checks `matching.js` |
The four AI-dialog suites (`fixes_1018`, `membership_plan`, `reference_media`, `reference`) now fill the pre-flight (`aigo(pg)`) before the run. `add_flow_regress` fails on `ELG-017 has provenance, no nag` and a missing `.card` both before and after this change (verified on a clean checkout).
Suites that need `SVC_KEY` (plan_guard, security, batch4, account_delete, experts_directory, site_improvements, viewer_role, location_privacy) were not run from this box because no service key is available here.

## Guest mode
`python3 tests/guest_regress.py <base-url>` covers the no-signup flow, EXIF stripping, the 3-find limit, the email-only sign-up and the private import. See `docs/guest-mode.md`.
