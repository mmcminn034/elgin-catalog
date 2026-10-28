# AI photo analysis (Supporters)

`supabase/functions/analyze-find/index.ts` is a Supabase Edge Function. It:
1. Verifies the caller's Supabase session and checks `profiles.membership = 'member'`. Otherwise it returns 402.
2. Receives the find's photo URLs (https only, max 6), the owner's notes, our reference knowledge base subset (`data/reference/*.json`) and the checklist feature names.
3. Loads shared `verified_examples` for that category (RLS applies).
4. Calls any **OpenAI-compatible** `/chat/completions` vision endpoint with a strict system prompt: possibilities only, no authenticity/value claims, confidence as a 0-100 percentage capped at 95 with signed factors (see docs/confidence-scoring.md), mark only visible features. Up to 5 published reference summaries are added, labelled EXTERNAL REFERENCE (see docs/ai-prompt.md).
5. Sanitizes the JSON. It keeps at most 3 candidates and 8 marks per photo, clamps coordinates to 0–1 in our annotations format (`arrow|line|measure|box: [x1,y1,x2,y2]`, `circle: [cx,cy,r]`), and adds a fixed caveat.

The client button **🤖 Analyze photos with AI** (AI analysis tab, members only) shows candidates and suggested marks drawn on the photos.
The owner can untick or relabel each one before **Accept selected**. Accepted marks are saved with `source: "ai"`, and nothing saves without that click.

## Deploy (needs an AI API key)
```
npm i -g supabase && supabase login && supabase link --project-ref qqllbazrwfebpnqhdwox
supabase secrets set AI_API_KEY=sk-...            # required
supabase secrets set AI_BASE_URL=https://api.openai.com/v1   # optional; any OpenAI-compatible endpoint
supabase secrets set AI_MODEL=gpt-4o-mini         # optional; must accept image input
supabase functions deploy analyze-find
```
Photos must be publicly reachable over https (repo images on GitHub Pages, or synced photos in the public `find-photos` bucket).
Cost is roughly a few cents or less per analysis with small vision models. Set a monthly spend limit at the provider.

## Pre-flight and cache (2026-10-27)
Pressing "Analyze photos with AI" now opens a short pre-flight first (`assets/js/aipre.js`): photo-capture guidance, an in-browser photo check (resolution, focus, light; nothing is uploaded), and an attribute form. Material and flake scars are required ("unknown" counts as an answer); form, flake pattern, base, edges, surface, L/W/T and a general setting are optional. Answers are validated against fixed option lists (no free text, no places), sent as `attrs`, and stored on the find as `extra.attrs` plus in this browser for next time.
The function checks `ai_cache` before taking quota (see `docs/ai-costs.md`). Deploy as before (`supabase functions deploy analyze-find`); migration 025 must be applied first, and its rollback is `025_matching_learn_down.sql`. Without `AI_API_KEY` the function still answers 503 `ai_unavailable` and the app falls back to the rules engine. Nothing in the new code calls a model on its own.
