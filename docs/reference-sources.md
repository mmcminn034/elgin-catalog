# Free reference sources

Updated October 18, 2026. Each source below lists what it offers, its license or terms, how we access it, and whether we **import** a sample or **link only**.
Imported rows always carry their source, license, license URL, attribution and source-page URL, and the UI shows those credits next to every thumbnail.

| Source | URL | What's there | License / attribution | Access | Imported? |
|---|---|---|---|---|---|
| Wikimedia Commons | https://commons.wikimedia.org | Photos of projectile points, stone tools, fossils, minerals | Per file. We keep only Public domain, CC0, CC BY and CC BY-SA files, and credit author / license / "Wikimedia Commons" with a link to the file page | MediaWiki API (`categorymembers` + `imageinfo/extmetadata`), polite User-Agent | **Imported**: 115 thumbnails from 42 curated categories (≤3 each), table `reference_media` |
| Paleobiology Database (PBDB) | https://paleobiodb.org | Fossil taxa, ranks, first/last appearance ages, occurrences | Data CC BY 4.0, credited "Data: The Paleobiology Database". Its silhouettes come from PhyloPic under per-image licenses, so we **don't** copy images | Data API `data1.2/taxa/single.json` | **Imported**: 15 taxon records (Exogyra, Gryphaea, ammonoids, crinoids, brachiopods, Turritella, echinoids, belemnites, trilobites, rugose corals, Otodus, Squalicorax, Ptychodus, Inoceramus, Pecten). Data only, no images |
| PIDBA (Paleoindian Database of the Americas) | https://pidba.utk.edu | Measurements of Paleoindian points | CC BY 4.0, attributed | Spreadsheets over HTTPS | Already imported earlier (measurement ranges on `reference_types`, see reference-layer.md). Unchanged |
| RRUFF Project | https://rruff.info | Mineral photos, chemistry, Raman/XRD spectra | Open access. The project asks for citation (Lafuente et al. 2015) but states **no image reuse license**, so we don't copy its photos | Website / bulk ZIP downloads | **Link only**: mineral pages are linked from About → Reference Sources |
| USGS | https://www.usgs.gov | Mineral and geology fact sheets and photos | US federal works are generally public domain; credit "USGS" | Website | **Link only** for now. USGS-credited Commons files are labelled "USGS (public domain) via Wikimedia Commons" (none in this sample) |
| Puget Sound Knappers point database | https://pugetsoundknappers.com/interesting_stuff/Point%20Database.html | ~1,300 point types, 37,000+ images | Compiled from many third-party sources; the site says attribution and permission are incomplete. **Not reusable** | Website | **Link only** |
| Colorado sources | n/a | n/a | n/a | n/a | **Skipped** for now, at Mark's direction |

## How imported rows are used
- `data/reference/reference-media.json` is built by `tools/reference/import_media.py` and loaded with `tools/reference/load_media_sql.py`, migration 019.
- Table `reference_media` follows the same owner-only rule as `reference_types`: only the owner can select it directly, and clients can't write to it. Signed-in users only get matches through `similar_reference_media(names, kind, limit)`, which returns thumbnail, title, source, license and attribution, never the whole table.
- AI suggestion view: for each candidate at moderate or higher confidence (≥40%, the yellow and green bands), up to 3 similar reference thumbnails are shown. Each has its credit line and a link to the source page. A generic match (e.g. "projectile point") is labelled as general. Low-confidence candidates get no thumbnails.
- These are look-alike references for research, not identifications.
- The existing 4,042 `reference_types` rows are untouched.
