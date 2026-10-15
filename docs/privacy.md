# Privacy

- **No public exact GPS.** Coordinates live only in `find_locations`, which has owner-only RLS. Records, Discover, share pages, PDFs and AI prompts carry only the county or general area (`region`, `admin1`, `country`).
- **EXIF:** photos added in the app pass through `App.stripExif` before upload. A check of the 356 repository JPEGs on 2026-10-15 found no GPS EXIF.
- **AI:**
  - The request carries the record (owner suggestions removed), the area-level region hint and https photo URLs; it never includes `find_locations`.
  - The system prompt forbids coordinates and addresses, and the server replaces coordinate-like strings in factors with "[coordinates removed]".
- **Visibility:**
  - Finds are private / collection / public (`visibility`, `is_public`).
  - Discover additionally needs `show_on_discover`, with a check constraint (`finds_discover_public_chk`).
  - Photos on Discover are readable only through `find_on_discover()`.
- **Reference layer:** contains only published typology facts. It holds no find data, no locations and no photos.

## ⚠ GitHub image caveat
The repository **mmcminn034/elgin-catalog is public**, and GitHub Pages serves everything under `images/`. Any photo committed to the repo can therefore be fetched by anyone who knows or guesses its URL, **even if the find is private in the app**; RLS cannot protect files in git.
- Keep sensitive finds' photos out of the repo. Upload them in the app, where they go to the Supabase `find-photos` storage bucket.
- Note that `find-photos` is also a *public* bucket today. Its URLs are unguessable but not access-controlled; moving to signed URLs is on the roadmap.
- Removing a photo from git does not erase it from history or from forks.
- The package zip includes `images/` (see the package README), so treat the zip as public-grade material.
