# Free reference sources

Updated October 27, 2026. Each source below lists what it offers, its license or terms, how we access it, and whether we **import** a sample or **link only**.
Imported rows always carry their source, license, license URL, attribution and source-page URL, and the UI shows those credits next to every thumbnail.

| Source | URL | What's there | License / attribution | Access | Imported? |
|---|---|---|---|---|---|
| Wikimedia Commons | https://commons.wikimedia.org | Photos of projectile points, stone tools, fossils, minerals | Per file. We keep only Public domain, CC0, CC BY and CC BY-SA files, and credit author / license / "Wikimedia Commons" with a link to the file page | MediaWiki API (`categorymembers` + `imageinfo/extmetadata`), polite User-Agent | **Imported**: 274 thumbnails from curated categories (stone tools, artifact look-alikes, fossils, minerals and natural rocks such as caliche, concretions and water-worn cobbles), importer `tools/reference/import_media2.py` (additive; dedupes by id), table `reference_media` |
| Paleobiology Database (PBDB) | https://paleobiodb.org | Fossil taxa, ranks, first/last appearance ages, occurrences | Data CC BY 4.0, credited "Data: The Paleobiology Database". Its silhouettes come from PhyloPic under per-image licenses, so we **don't** copy images | Data API `data1.2/taxa/single.json` | **Imported**: 48 Texas fossil taxon records (the original 15 plus 33 more: echinoids, bivalves, gastropods, ammonoids, corals, sharks and others). Data only, no images |
| PIDBA (Paleoindian Database of the Americas) | https://pidba.utk.edu | Measurements of Paleoindian points | CC BY 4.0, attributed | Spreadsheets over HTTPS | Already imported earlier (measurement ranges on `reference_types`, see reference-layer.md). Unchanged |
| RRUFF Project | https://rruff.info | Mineral photos, chemistry, Raman/XRD spectra | Open access. The project asks for citation (Lafuente et al. 2015) but states **no image reuse license**, so we don't copy its photos | Website / bulk ZIP downloads | **Link only**: mineral pages are linked from About → Reference Sources |
| USGS | https://www.usgs.gov | Mineral and geology fact sheets and photos | US federal works are generally public domain; credit "USGS" | Website | **Link only** for now. USGS-credited Commons files are labelled "USGS (public domain) via Wikimedia Commons" (none in this sample) |
| Puget Sound Knappers point database | https://pugetsoundknappers.com/interesting_stuff/Point%20Database.html | ~1,300 point types, 37,000+ images | Compiled from many third-party sources; the site says attribution and permission are incomplete. **Not reusable** | Website | **Link only** |
| Smithsonian Open Access (NMNH) | https://www.si.edu/openaccess | Museum photos of fossils and minerals | **CC0** (credited "Smithsonian NMNH"). Only media flagged CC0 are used | Open Access API (`api.si.edu/openaccess/api/v1.0`), thumbnails from `ids.si.edu` | **Imported**: 17 images. No Texas projectile-point records had open-access images, so artifacts come from other sources |
| The Met Open Access | https://www.metmuseum.org/about-the-met/policies-and-documents/open-access | Museum object photos | **CC0** (credited "The Metropolitan Museum of Art") | Collection API (`/public/collection/v1`, `search` + `objects`) | **Imported**: 5 US Archaic ground-stone objects |
| Digital Atlas of Ancient Life | https://www.digitalatlasofancientlife.org | Fossil identification atlases and an encyclopedia | **CC BY-NC-SA 4.0** (checked 2026-10-27). Non-commercial, so it does not fit a site with paid membership | Website | **Link only** (its CC0 3D Virtual Collection models are 3D, not photos, so none are imported) |
| Texas Beyond History, Hill Country Archeological Association typology, TAS Bulletin 47, Texas State Spring Lake chronology, projectilepoints.net | see `data/learn/learn.json` → `sources` | Type descriptions, ages and chronology for Central Texas points | Copyrighted by their publishers | Read manually | **Link only.** Facts (ages, diagnostic traits) are restated in our own words on the Learn page, each type naming its sources |
| Colorado sources | n/a | n/a | n/a | n/a | **Skipped** for now, at Mark's direction |

## How imported rows are used
- `data/reference/reference-media.json` is built by `tools/reference/import_media.py` and loaded with `tools/reference/load_media_sql.py`, migration 019.
- Table `reference_media` follows the same owner-only rule as `reference_types`: only the owner can select it directly, and clients can't write to it. Signed-in users only get matches through `similar_reference_media(names, kind, limit)`, which returns thumbnail, title, source, license and attribution, never the whole table.
- AI suggestion view: for each candidate at moderate or higher confidence (≥40%, the yellow and green bands), up to 3 similar reference thumbnails are shown. Each has its credit line and a link to the source page. A generic match (e.g. "projectile point") is labelled as general. Low-confidence candidates get no thumbnails.
- These are look-alike references for research, not identifications.
- The existing 4,042 `reference_types` rows are untouched.

## Counts after the 2026-10-27 expansion (`reference_media`: 344 rows, was 130)
| Source | Rows | Licenses |
|---|---|---|
| Wikimedia Commons | 274 | CC BY-SA 4.0 (82), CC BY-SA 3.0 (66), Public domain (40), CC BY 2.0 (39), CC BY 4.0 (14), CC0 (12), CC BY-SA 2.0 (11), CC BY-SA 2.5 (8), CC BY 3.0 (1), CC BY-SA 2.0 de (1) |
| Paleobiology Database | 48 | CC BY 4.0 (data only, no images) |
| Smithsonian Open Access (NMNH) | 17 | CC0 |
| The Met Open Access | 5 | CC0 |

- 31 rows are natural look-alikes (caliche, concretions, water-worn cobbles; `topics` contains `natural`). They use `kind = 'mineral'` because the table's check constraint allows only artifact/fossil/mineral. `similar_reference_media()` returns them for any kind when a name matches `natural rock`, `caliche`, `concretion` or `geofact`.
- Curation: a contact-sheet review removed off-topic hits (lumber axes, memorials, plates, campus photos, industrial mining, graphs, outcrop-only shots). Patterns are kept in the importer (`DENY`).
- Gap, stated plainly: Commons has almost no photos of named Central Texas point types, so type-specific photos are mostly generic artifact/lithic photos. The Learn page describes each type in words and links to the original sources instead.
- Skipped: Colorado Projectile Point Database (at Mark's direction).


## Public Reference Catalog (added 2026-11-11, ro-v9.13.0)
A free catalog anyone can browse, signed in or not: `#/reference` (https://unearthedfinds.com/#/reference). It is **separate from members' finds** and does not touch any user collection or its visibility.

**What qualifies ("proven"):** the object or specimen is held by a museum or research collection and has a catalog number or an institutional record page, **and the image itself** is CC0 or public domain. For GBIF the license on the *media item* is checked; the record's license is never used as a stand-in. NC/ND or "all rights reserved" images are skipped.

**Privacy:** locations are cut to county + state (or state/country). Coordinates, localities, towns, sites and survey sections are never stored. Thumbnails are re-encoded (≤480 px WebP), which drops all EXIF/GPS.

**Sensitive items:** records that mention burials, graves, human remains or sacred or ceremonial objects are excluded.

**Database is the source of truth (ro-v9.14.0).** Every record is a row in `reference_media`: `data.public = '1'` marks it public, and `data.catalog` holds the display fields (`name`, `source_title`, type, material, period, region, institution, catalog number, …). Rows the importer adds also carry `data.pc = '1'`, `category = 'public-catalog'` and `keywords`. Thumbnails are ≤480 px WebP with EXIF stripped, stored in the **public Storage bucket `reference-media`** at `<category>/<slug>.webp`. They are not kept in the repo. 22 Met/Smithsonian rows from earlier migrations were only flagged public; their titles, keywords and institution-hosted thumbnails are unchanged.

**Page:** `assets/js/refcatalog.js` reads `reference_media` rows where `data->>public = 1` from Supabase, 1,000 rows per page. If that fails it shows a retry message ("The Reference Catalog can't load right now…").

**Migration 027 (`supabase/migrations/027_public_reference_catalog.sql`, down: `027_public_reference_catalog_down.sql`):** adds the anon/authenticated SELECT policy limited to public rows, a unique index on (source, catalog number) for importer rows, and a partial index. **Status 2026-11-11: written, NOT applied.** Applying it needs the Supabase Management API token (`SUPABASE_ACCESS_TOKEN`, see docs/run-deploy-extend.md), which isn't on the box right now. Until 027 is applied, anon reads return no rows. The page then falls back to a **temporary bridge export**, `data/reference/public-catalog.json`, built from the DB rows with Storage thumbnail URLs. **After 027:** confirm signed-out reads show `RefCatalog.origin() === "db"`, then delete the `BRIDGE` fallback in refcatalog.js and the JSON file.

**Wording:** the museum's original title is kept in `data.catalog.source_title`, and the page shows a softened title (`soften()` in the importer):
- "Paleo-Indian" becomes "Paleoindian".
- "(American) Indian(s)" becomes "Native American(s)". Place names such as "Indian River" are not changed, and neither is text about India.
- "Eskimo" becomes "Arctic Indigenous".
- Slurs or dated terms such as "squaw", "savage" and "primitive" are replaced.

16 titles were softened in round 1. The detail page shows "Museum's title" whenever it differs from the displayed title.

**AI look-alike matching:** importer rows get `keywords`, and `similar_reference_media` (signed-in, used by the find page and `analyze-find`) matches on them. Keywords are:
- point type names from `data/reference/points.json`, tool terms, and "material + point/tool" for artifacts;
- species, genus and group for fossils;
- the mineral name for minerals.

Results are research suggestions only, never identifications. Two records have no matching keyword (`met:310686` "Mace head", `ypm:ant-013958` "Drilled stone ornament"). They still appear in the catalog.

**Weekly growth (`--add N`):** fetches the next N CC0/public-domain records that are not in `reference_media` yet, under the same rules. Dedupe is by id and by (source, catalog number). The mix is about 40% fossils, 40% artifacts and 20% minerals, with Texas first. It uploads thumbnails to Storage, inserts the rows, and prints one line:
`2026-11-18 03:00 CST reference add: requested 100, added 100 (artifact 40, fossil 40, mineral 20), skipped 0 (no usable image), reference_media now 1550 rows`

```
cd /workspace/ec-main && set -a && . /workspace/.svc && set +a && \
  PYTHONPATH=tools/reference python3 tools/reference/import_public_catalog.py --add 100 --cache /workspace/pubref/cache
```

Add `--dry-run` to see what would be added without writing anything. It needs only the service key (`SVC_KEY` in `/workspace/.svc`), not 027. The HTTP cache keeps later weeks fast. CC BY sources aren't used in weekly mode. When a source runs dry, the count added can fall below N, and the summary line shows it.

**Files:**
- importer `tools/reference/import_public_catalog.py`, with DB/Storage I/O in `tools/reference/pc_db.py`;
- UI `assets/js/refcatalog.js`;
- test `tests/public_reference_regress.py`. With `SVC_KEY` set it checks the DB rows and a Storage thumbnail sample; without it, the bridge.

**Round 1 (in the DB): 1,128 records:** 391 artifacts, 593 fossils and 144 minerals, 561 of them from Texas. Backups taken before the load are in `/workspace/backups/pre-public-reference-2026-11-11/` and under git tag `pre-public-reference-2026-11-11`.

| Source | Records | License |
|---|---|---|
| GBIF.org | 584 | CC0 |
| Yale Peabody Museum via LUX | 366 | CC0 |
| Smithsonian Open Access | 136 | CC0 |
| The Met Open Access | 23 | CC0 |
| Smithsonian Open Access (NMNH) | 17 | CC0 |
| Cleveland Museum of Art Open Access | 2 | CC0 |

## Search-engine pages for the Reference Catalog (added 2026-11-13, ro-v9.15.0)
The app is a hash-routed single page (`#/reference`), which search engines don't index. So the Reference Catalog also has plain, crawlable HTML pages:

| Path | What |
|---|---|
| `/reference/` (`reference/index.html`) | Overview, counts, links to each category, a few sample records |
| `/reference/artifacts.html`, `fossils.html`, `minerals.html`, `texas.html` | Every record in that group, as thumbnail cards |
| `/reference/r/<name>-<id>.html` | One lightweight page per public record |
| `/reference/seo.css` | Shared styles for those pages |
| `/sitemap.xml` | Home, the 5 overview pages and every record page |
| `/robots.txt` | Hand-written: allows crawling, points at the sitemap, keeps `/tools/`, `/tests/`, `/supabase/`, `/docs/` out of results |

Each page has a title, meta description, canonical URL, Open Graph and Twitter tags, schema.org JSON-LD (`CollectionPage` + `ItemList` for lists; `CreativeWork` with an `ImageObject` carrying `license`, `acquireLicensePage` and `creditText` for records), the thumbnail from Supabase Storage (bucket `reference-media`; 22 older Smithsonian/Met rows still use the museum's own CC0 image URL, as the app does), the credit line and license, a link to the original museum record, an **Open in the app** link (`#/reference/<id>`) and **Try it free** (`#/try`). Titles use the softened display name (`data.catalog.name`); the museum's `source_title` is not used on these pages.

**These pages are generated output, not data.** The database (`reference_media`, rows with `data->>'public' = '1'`) is the only source of truth. Every file under `reference/` and `sitemap.xml` can be deleted and rebuilt from the database at any time, in about a second:

```
set -a; . /workspace/.svc; set +a
python3 tools/reference/build_seo_pages.py        # --dry-run to preview, --force to accept a >20% drop
python3 tests/seo_pages_regress.py [URL]          # pages == database public rows; no private data
```

Safety built into the generator: it reads only public catalog rows (never user finds or `find_locations`), skips any row whose text looks like coordinates/GPS/UTM, builds into a temporary folder and swaps it in only after checks pass, refuses to replace a `reference/` folder it didn't generate, and changes nothing if the database read fails or returns more than 20% fewer records than are already published. If a generated file is ever damaged or lost, re-run the command; nothing is lost because nothing lives only in these files.

**Weekly growth:** `tools/reference/weekly_refresh.sh 100 --push` runs the importer (`--add 100`, database + Storage), rebuilds these pages from the database, runs the SEO test and, with `--push`, commits only `reference/` + `sitemap.xml` and pushes `main` so Porkbun picks it up.

**Home page:** `index.html` now has a canonical URL, robots, `og:site_name`, Twitter title/description, a `WebSite` + `WebApplication` JSON-LD block, and a `<noscript>` row of plain links to the reference pages. There is a commented placeholder for Search Console / Bing verification meta tags; no token is filled in.
