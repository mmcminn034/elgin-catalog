# AI prompt

**Template.** `Prompt.SYSTEM` in `assets/js/prompt.js` is shared with the edge function, so the browser's **View AI prompt** disclosure shows exactly what the model receives. It is region-neutral and worldwide. Its main rules:
- Give possibilities, not identifications, and make no authenticity or value claims.
- Owner provenance wins, but the model must not assume a region.
- `confidence_pct` must be 0-95, with signed `factors`; the server caps it again.
- Mark only visible features, with `photo_index` and normalised coordinates.
- Never output coordinates or addresses.
- `external_references` are **published typology, not the find**. Cite the ids the model used in `reference_ids`.
- Also return `classification` and `origin` sections.

## User message assembly (`Prompt.buildUserText`)
```mermaid
sequenceDiagram
  participant B as Browser (features.js)
  participant F as analyze-find
  participant D as Supabase
  participant M as Model
  B->>F: catalog_id, kind, photos (https), record (no suggestions), kb, checklist, region_hint, rules_top
  F->>D: verified_examples (RLS) → Retrieve.rankSimilar top 3 + 1 photo each
  F->>D: reference_types (009) or the site's public-types.json → Prompt.rankReferences top 5
  F->>M: SYSTEM + JSON context + "EXTERNAL REFERENCE (published typology, not the find): …" lines + photo parts + "REFERENCE (not the find; do not mark)" photos
  M-->>F: JSON
  F-->>B: Score.clampCandidates(...), marks clamped, external_references_used, reference_status, caveat
```
- `rankReferences` scores each published entry:
  - name or alias mentioned in the record: +4
  - among the rules engine's top 3 (`rules_top`): +3
  - traits: +1 each up to 5, plus 2 × the share of the entry's own traits that were seen
  - length inside the range: +1; outside: −1
  - region bonus: admin1 +1, else country +0.5, else continent +0.25
- An entry is kept only if it scores ≥2 and has either ≥2 trait hits or a name/rules match. Negated statements such as "not ground" are removed first (`Prompt.affirmed`).
- Every reference line carries its source, URL, retrieval date and license.
- When references cannot be loaded, `reference_status` says so and the AI panel shows a red alert. Nothing fails silently.

## Example
`ai_prompt_example.txt` (in the package and in `/workspace/reference-layer/`) is the full system prompt plus the assembled user message for **ELG-001**. It was generated with:
```
node tools/reference/prompt_example.js <captured request body.json> <verified_examples rows.json> > ai_prompt_example.txt
```
