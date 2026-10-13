# Elgin Catalog

**Documenting Central Texas surface finds.** A static, no-build web catalog of surface finds from the Rolling Oak property near Elgin, Texas: photos, measurements, descriptions, ranked research possibilities, and owner review notes.

> AI suggestions are possibilities for research, **not identifications**. This project makes no claims about authenticity or monetary value.

## Features
- Catalog grid with search, filters (status, category, confidence) and a stats strip (total, reviewed, drafts, measured)
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
```

## Updating the public catalog
Edit `data/catalog.json` (or export JSON from the app **without** private location), commit, and push.

## License
MIT © 2026 Mark McMinn
