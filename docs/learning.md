# Stage 1: how the catalog learns (feedback → retrieval → confidence)

Research suggestions only, never identifications. No authenticity or value claims, and confidence is capped at Moderate everywhere.

| Piece | Where | Storage |
|---|---|---|
| 👍 Matches well / 🤏 Close but not quite / 👎 Wrong ID, plus an optional correction and a better type (from the reference KB or free text) | Every find's **AI analysis** tab and the AI result dialog | `feedback` table (migration 003); always also kept in this browser (`localStorage["ro-feedback"]`) |
| Mark as verified reference | Overview tab, for owners and editors | `verified_examples`: type, material, county-level region, era, notes, `photo_ids`; also kept in local IndexedDB |
| Agreement per type | About → *How the AI learns*; confidence signal on the analysis tab | `type_accuracy()` RPC (aggregates only; no user ids or notes) |
| Low-confidence photo prompts | Overview tab | Derived from missing shot-list views plus checklist items still “unknown” |
| Most similar verified examples (top 3) | Analysis tab and Add-find wizard (after “Suggest”) | `assets/js/retrieve.js` |
| AI retrieval context | `supabase/functions/analyze-find` | Same `retrieve.js` (copy in `supabase/functions/_shared/`; `python3 tools/check_shared.py` verifies they match) |

**Confidence modifier.** Agreement = (matches + ½ × close) ÷ responses. With at least 3 responses for a type, agreement below 50% lowers that type's confidence by one level. Agreement can never raise confidence above Moderate.

**Similarity score.** The retrieval score adds points for:
- same candidate type: +3
- shared trait keywords: up to +4
- same material: +1.5
- length within 15%: +1.5 (within 30%: +0.75)
- same county-level region: +1
- same era: +0.75

## Visibility
`finds.visibility` can be one of:
- `private`: the find owner and the collection owner.
- `editors`: any collection member.
- `public`: anyone, if the collection is public.

`is_public` stays in sync automatically through a trigger. The public page (`#/find/ID`, plus the static `share/ELG-xxx.html` with OG/Twitter tags) only ever shows `region`, which is county-level. A check constraint rejects coordinates and street numbers in it. Exact GPS stays in `find_locations`, which only owners and editors can read through RLS.

The full record (with private fields, for people allowed to see them) is at `#/record/ID`.

## Keep / Correct as labeled data (2026-10-27)
- Every AI Keep (Accept) and every feedback response now carries `feedback.meta` (jsonb, max 4,000 characters): prompt version, model, top percentage, artifact-likelihood verdict, photo views seen, the owner's attribute answers, and `kept: true` for a Keep. No photos, no locations, no names.
- Admin-only export: `select * from admin_ai_labeled_data(5000)` returns feedback and type corrections joined to non-location find attributes. The owner id is hashed, so rows cannot be traced to an account.
- `type_accuracy()` feeds back into the prompt (aggregate agreement per type) and into calibration.

## Learn page (`#/learn`)
Public page built from `data/learn/learn.json` (29 Central Texas point types in our own words, a 45-row timeline, an "Is it an artifact?" guide, a photo-capture guide, a source map), the fossil/rock reference JSON, and the credited reference gallery. Rebuild the JSON with `python3 tools/learn/build_learn.py`. Every source is link-only; ages differ between sources and the page says so.
