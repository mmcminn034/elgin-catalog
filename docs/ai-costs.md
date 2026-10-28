# AI cost estimate and controls

Prices and image-token rules were read from OpenAI's public pages on **2026-10-27**:
https://platform.openai.com/docs/pricing and https://platform.openai.com/docs/guides/images-vision. They change, and the provider's invoice is the truth. The model is set by the edge-function secret `AI_MODEL` (default `gpt-4o-mini`). The code in `assets/js/matching.js` (`PRICES`, `imageTokens`, `estimateCost`) reproduces the arithmetic, and `tests/matching_test.js` checks it.

## List prices (USD per 1M tokens, input / output)
| Model | Input | Output | Image token rule |
|---|---|---|---|
| gpt-4o-mini | $0.15 | $0.60 | tiles: base 2833 + 5667 per 512px tile (low detail = base only) |
| gpt-4o | $2.50 | $10.00 | tiles: base 85 + 170 per tile |
| gpt-4.1-mini | $0.40 | $1.60 | 32px patches ×1.62 (budget 6144) |
| gpt-5.4-nano | $0.20 | $1.25 | 32px patches ×1.2 (budget 2500) |
| gpt-5.4-mini | $0.75 | $4.50 | 32px patches ×1.2 (budget 2500) |

## One identification, as the app sends it
Assumptions: 4 owner photos of 1600×1200 (the first 2 at `detail: high`, the rest `low`), 2 low-detail reference images, about 7,000 text tokens (measured prompt ≈ 5,500; the rest is headroom for verified examples), about 1,300 output tokens.

| Model | Per ID (estimate) |
|---|---|
| gpt-5.4-nano | ≈ $0.005 |
| gpt-4.1-mini | ≈ $0.010 |
| **gpt-4o-mini (default)** | **≈ $0.011** |
| gpt-5.4-mini | ≈ $0.018 |
| gpt-4o | ≈ $0.035 |

gpt-4o-mini: all photos at low detail ≈ $0.004; 6 photos all at high detail ≈ $0.026. Reasoning-style models (gpt-5.x) can add hidden reasoning tokens billed as output, so treat their numbers as a floor. A re-run of the same photos and answers is served from cache and costs nothing.
Rough budget at the default: 100 IDs ≈ $1.10; 1,000 IDs ≈ $11.

## Cost controls (all free, in the code)
- **Image detail policy**: first 2 photos high, others low, reference images always low (`Matching.detailFor`).
- **Output cap**: `max_tokens` 2500 (`max_completion_tokens` 6000 for reasoning models).
- **Result cache** (`ai_cache`, migration 025): key = prompt version + find + photo URLs without query strings + record + answers + region. Valid 7 days; "refresh" bypasses it. A hit skips quota and the model.
- **Per-account daily cap** (`app_config.ai_daily_cap`, default 50; members unlimited) and a new **global daily cap** (`ai_global_daily_cap`, default 300 analyses/day across all accounts). Change either with an `update app_config` statement.
- **Quota refunds** on provider errors, as before.
- **Retry without reference images** if the provider cannot fetch a hot-linked reference photo (400), never without the owner's photos.
- Only 2 reference images and a short text context are sent; the full reference library is never sent.
