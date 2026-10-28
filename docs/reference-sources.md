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
