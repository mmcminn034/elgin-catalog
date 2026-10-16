# Fossil and rocks & minerals reference layers (preview)

Two new layers mirror the artifact layer (`data/reference/public-types.json`): same entry shape (`id, name, aliases, typology_system, category,
period, dates, continent, country, admin1, region_notes, traits, similar_types, texas, home_priority, sources[]`), worldwide scope, Texas first,
and per-entry attribution (`sources: [{name, url, retrieved, license}]`). They are reference facts and links only, never identifications.

| File | Entries | What |
|---|---|---|
| `data/reference/public-fossils.json` | 1,896 | 28 curated groups (body fossils, plants, petrified wood, trace fossils, pseudofossils) + 1,868 PBDB genera (Texas genera with >=3 PBDB occurrences, plus a worldwide list of classic genera), each genus attached to its group |
| `data/reference/public-minerals.json` | 525 | 20 curated rock types and silica varieties (chert, chalcedony, agate incl. plume/tube agate, petrified wood, opal, quartz, quartzite, sandstone, limestone, concretions, geodes, ironstone, ...) with localities + 505 Wikidata minerals with properties |

Extra fields: `rules` (curated entry used by the rules engine), `group` (genus -> group), `fossil_kind` (body/plant/trace/pseudo), `age_ma` [oldest, youngest],
`formations`, `lookalikes`, `localities`, `taxonomy`, `properties` {hardness, luster, streak, system, colors, formula}, `diagnostic` (our own words), `merge_into`
(extends a hand-curated entry in fossils.json / rocks.json instead of duplicating it). `meta.formations` holds Macrostrat ages for 37 key Texas formations;
`meta.trait_patterns` holds the per-category trait vocabulary (fossil: coiled beak, suture, five-part, columnal, wood grain, burrow, ...; rock: waxy, conchoidal, banded, plumes, tubes, fizzes, streak, ...).

## Sources and licenses
| Source | Used for | License / caveat |
|---|---|---|
| Paleobiology Database (PBDB) API `occs/taxa`, `taxa/list` | genera, taxonomy, first/last appearance ages, Texas occurrence counts | **CC BY 4.0**: attribution per entry (taxon page link) and here. |
| Macrostrat API `defs/strat_names` | formation age ranges (Ma) | **CC BY 4.0**. Names are matched to Texas formations by expected period; a few names are shared with out-of-state units, so ages are a guide. |
| Wikidata SPARQL | mineral Mohs hardness, crystal system, color, streak, formula (minerals with >8 sitelinks) | **CC0**. Coverage is uneven (streak and luster often missing). |
| USGS / NPS pages | rock-type and fossil/pseudofossil definitions, summarized in our own words | **Public domain** (US Government works). |
| UT Bureau of Economic Geology (Geologic Atlas of Texas) | Texas formation context | Facts summarized and cited; no text or maps copied. |
| GBIF / iDigBio | **Not ingested.** | Record licenses vary per dataset (CC0 / CC BY / **CC BY-NC**); would need per-record license filtering before use. |
| RRUFF | **Not ingested.** | Free for research with citation, but no explicit open license for redistribution; Wikidata used instead. |
| Webmineral | **Not used.** | Copyrighted; no open license. |
| Mindat | **Not used.** | API needs a key and content is CC BY-NC-SA (non-commercial); incompatible with a paid membership tier. |
| Texas Memorial Museum (TMM) | **Not used.** | No open bulk data found; PBDB already includes many TMM-based occurrences. |

Images are never copied; the Library shows silhouettes.

## How the app uses them
* **Rules engine** (`assets/js/analysis.js` `mergeLayer`): curated entries (`rules: true`) join the fossil / rock knowledge base as trait-matched candidates, or
  extend the matching hand-curated entry (`merge_into`). PBDB genera and Wikidata minerals are reference-only (max 3 attached as sources on their group).
* **Confidence**: unchanged caps (`assets/js/score.js`): rules engine and AI max 95%; 100% only for an owner-Verified find that agrees with references.
* **AI prompt**: `analyze-find` and the in-app prompt preview rank only the find's own category layer (`public-types` / `public-fossils` / `public-minerals`) and send the top 5 (`Prompt.refBrief` now carries diagnostic, formations, ages, properties, lookalikes, localities).
* **Reference Library** (owner-only): Artifacts / Fossils / Rocks & Minerals tabs (arrow keys switch tabs); search also covers formations and taxonomy; the Details dialog shows the new fields.

## Database
`supabase/migrations/011_reference_fossil_mineral.sql` (**written, not applied**) adds nullable columns to `reference_types` and keeps owner-only read
(service role bypasses RLS). Seed: `supabase/seed/011_reference_fossil_mineral_seed.sql` (2,421 rows) from `tools/reference/gen_seed_sql_fm.py`.
Until it is applied, `analyze-find` reads these layers from the static JSON.

## Rebuild
```
mkdir -p raw && cd raw
curl -o pbdb_tx.json "https://paleobiodb.org/data1.2/occs/taxa.json?state=Texas&rank=genus&show=app,class&limit=all"
# pbdb_world.json: taxa/list.json?name=<worldwide list in the builder notes>&show=app,class,size ; macrostrat_fm.json: defs/strat_names?strat_name=<name> per formation
# wd_minerals.json: Wikidata SPARQL (minerals with P1088 Mohs hardness, P556 system, P462 color, P534 streak, P274 formula; sitelinks > 8)
python3 tools/reference/build_fossil_mineral.py raw && python3 tools/reference/gen_seed_sql_fm.py
```
