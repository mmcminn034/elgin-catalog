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

## Matching v2 (2026-10-27, `match-2026-10-27.1`)
The system prompt stays region-neutral. What changed:
- **Output schema** adds `artifact_likelihood` (`likely_artifact` / `possible_artifact` / `uncertain` / `likely_natural` with evidence for and against), `diagnostic_checklist` (feature, present / absent / not_visible, photo, note) and `photo_quality` (usable, issues, retake advice, views seen).
- **NOT AN ARTIFACT**: the model must consider "Natural rock / geofact (not an artifact)" (caliche, concretions, water-worn cobbles, frost or thermal fracture) as a candidate and say so when a piece shows no patterned flaking.
- **Ranking and calibration** instructions: give ranked candidates with reasons, name the features that would separate close candidates, and score only what is visible.
- **User message** now starts with, when present: `OWNER-SUPPLIED OBSERVATIONS` (validated attribute answers), `REGION PRIORS` (context only; `data/learn/priors.json`, matched on state) and `PAST FEEDBACK ON SUGGESTIONS` (anonymous aggregate from `type_accuracy()`, types with at least 3 responses).
- **Images**: owner photos (first 2 `detail: high`, rest `low`), up to 2 verified-example photos and up to 2 credited reference-library photos (low detail) retrieved by type name and tags (`similar_reference_media`). If the owner says there are no flake scars, natural-rock reference photos are included.
- **After the answer** (`Matching.extras`, `Matching.calibrate` in `assets/js/matching.js`, copied to `supabase/functions/_shared/`): sections are sanitized and coordinates scrubbed; confidence is only ever lowered: natural verdict caps artifact types at 35%, "uncertain" at 60%, unusable photos at 45%, a single photo at 50%, and a type owners disagreed with (under 50% over at least 3 responses) loses 10 points. Each change appears under "Why this score" as a `-` factor with source `calibration`.
- The rules engine has a matching generic type, "Natural rock / geofact (not an artifact)", scored from natural-surface words and from absence statements such as "no flake scars".
