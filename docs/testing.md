# Testing

| Command | Checks |
|---|---|
| `node tests/score_test.js` | Score math: caps, 100% rule, bands, label mapping, colours, overrides |
| `node tests/prompt_test.js` | Reference retrieval (top 5, region bonus rather than filter), attribution, EXTERNAL REFERENCE labels, region-neutral prompt, AI clamp (95 cap, coordinate scrub, labels, garbage, max 3) |
| `python3 tools/check_shared.py` | Browser and edge copies of retrieve/score/prompt are identical |
| `node --check assets/js/*.js` | Syntax |
| `python3 tests/reference_regress.py URL [shots]` | Chips, reference dialog, % bars ≤95, Why this score, AI % cap, prompt view, reference outage alert, AI failure alert, ambiguous-Verified ≤95, Verified single pick 100, low case, banner when public-types.json fails |
| `python3 tests/s5_regress.py`, `review_status_regress.py`, `category_persist_regress.py`, `source_enum_regress.py`, `add_flow_regress.py` | Existing regressions (status, Discover, measurement sources, categories, add flow) |

The Playwright tests run against a local `python3 -m http.server`, using Chrome at `/usr/bin/google-chrome`. Supabase calls are routed to an empty mock.
