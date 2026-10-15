# Rolling Oak Catalog

**UnEarthed Finds: Discover. Catalog. Preserve.** An AI-Powered Catalog Tool. A static, no-build web catalog of surface finds from anywhere in the world, organized into three collections (Artifacts, Fossils, Rocks & Minerals): photos, measurements, descriptions, ranked research possibilities, and owner review notes.

> AI suggestions are possibilities for research, **not identifications**. This project makes no claims about authenticity or monetary value.

## Features
- Collection tabs (Artifacts / Fossils / Rocks & Minerals) driven by the `category` field (`artifact`, `fossil`, `rock`); the specific kind of object lives in `object_type`
- Category-first add-find wizard with fossil fields (geologic period, formation, preservation) and rock fields (hardness, luster, streak)
- Deep time timeline with a toggle between human eras and geologic eras
- Catalog grid with search, filters (status, type, confidence) and a stats strip (total, reviewed, drafts, measured)
- Detail view with Overview / Measurements / AI analysis / Review tabs, plus a print-friendly record card
- Guided "Add find" wizard: Photos → Measurements → Description → AI analysis → Review & save
- Light earthy theme and dark mode; keyboard accessible and responsive

## Privacy model
- `data/catalog.json` is public on GitHub Pages and **never contains exact find locations**. The `find_location_private` field is left out, and the app strips it if it ever shows up.
- Finds you add or edit are saved **only in your browser** (IndexedDB) and merged over the seed catalog. Nothing is uploaded.
- Photos are **re-encoded through a canvas** before they're stored, which removes EXIF metadata including GPS.
- CSV/JSON exports **leave out private location** unless you tick "Include private location" and confirm.
- Location sharing levels: Private (default), County, Fuzzed ~10 km.

## Legal note (Texas)
Collect only on private land with the landowner's permission. Collecting on public land is restricted or illegal. If you find human remains or burial items, stop, leave them in place, and contact the [Texas Historical Commission](https://thc.texas.gov/).

## Run locally
The app loads `data/catalog.json` with `fetch`, so serve the folder over HTTP rather than opening the file directly:
```bash
cd elgin-catalog
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages
```bash
git remote add origin git@github.com:mmcminn034/elgin-catalog.git
git push -u origin main
```
Then in **Settings → Pages**, set Source to *Deploy from a branch*, branch `main`, folder `/ (root)`. The site goes live at `https://mmcminn034.github.io/elgin-catalog/`. `.nojekyll` turns off Jekyll processing.

## Structure
```
index.html            app shell (Catalog, Add find, About & methods)
assets/css/styles.css theme, layout, print styles
assets/js/app.js      data loading, IndexedDB, wizard, modal, export
data/catalog.json     public seed catalog (no private locations)
images/ELG-xxx/       owner photos (EXIF stripped, max 1600px, NN.jpg + NN_thumb.jpg)
```

## Updating the public catalog
Edit `data/catalog.json` (or export JSON from the app **without** private location), commit, and push.

## License
MIT © 2026 PolForge, LLC

## Analysis engine & learning loop
- `assets/js/analysis.js`: transparent, rule-based scoring. Candidates come from `data/reference/points.json`, `fossils.json` and `rocks.json` (traits, typical sizes, approximate dates, look-alikes). Each score lists its reasons and conflicts. Confidence is capped at Moderate.
- Every find's **AI analysis** tab has 10 sections: identification, age/period, material, manufacture/formation, use-wear/preservation, Central Texas context, comparables, diagnostic checklist, documentation gaps and references.
- **Verified examples**: marking a find Reviewed, or using "Save as verified", stores an example in the browser (IndexedDB `rolling-oak-learning`). Similar new finds get a bonus ("Matches N of your verified examples"). Export from About → Model, then commit to `data/learned/learned-examples.json` to share across devices. The repo seed contains ELG-001.

## Cloud sync (Supabase, optional)
- `supabase/schema.sql`: tables, RLS, storage bucket policies and seed. Paste it into the Supabase SQL Editor. It is idempotent; regenerate the seed with `python3 supabase/gen_seed.py`.
- `assets/js/config.js` holds the project URL and the **publishable** key, which is safe to publish because RLS protects the data. `assets/js/cloud.js` is the sync layer.
- Signed-out visitors read public data. Signed-in owners sync edits, marks, photos (EXIF already stripped) and verified examples. Exact locations go only to the owner-only `find_locations` table.
- If Supabase or the CDN is unreachable, the app uses `data/catalog.json` + IndexedDB, as before.
