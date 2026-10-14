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
