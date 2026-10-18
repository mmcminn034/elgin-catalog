"""Build the PUBLIC static data from a private full catalog export.

data/catalog.json is served to everyone (GitHub Pages / Porkbun), so it may only contain finds that are public to
signed-out visitors: the ones with an active UF public id (the same set as Discover). Private and members-only finds
are loaded from Supabase (RLS) for the signed-in owner and never ship in static files.

Usage: python3 tools/gen_public_catalog.py /path/to/private/catalog_full.json
  - keeps the full export OUTSIDE the repo (it must never be committed)
  - asks Supabase (anon key, public data only) which finds are public right now
  - writes data/catalog.json (public finds only), share/<ID>.html (full OG page for public finds; a detail-free
    redirect stub for any other ID that ever had a share page, so old links and QR labels keep working)
  - strips non-public seed rows from supabase/schema.sql
"""
import json, re, sys, pathlib, subprocess, urllib.request
root = pathlib.Path(__file__).resolve().parent.parent
if len(sys.argv) < 2: sys.exit(__doc__)
full = json.load(open(sys.argv[1]))
cfg = (root / "assets/js/config.js").read_text()
URL = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); KEY = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1)
req = urllib.request.Request(URL + "/rest/v1/public_ids?select=ref&kind=eq.find&active=eq.true", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
public = {r["ref"] for r in json.loads(urllib.request.urlopen(req).read())}
if not public: sys.exit("no public finds returned; refusing to write an empty catalog")
rows = [r for r in full if r["catalog_id"] in public]
for r in rows: r.pop("find_location_private", None)
(root / "data/catalog.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
# share pages: full pages for public finds (gen_share_pages reads data/catalog.json), stubs for the rest
existing = {p.stem for p in (root / "share").glob("*.html")}
subprocess.run([sys.executable, str(root / "tools/gen_share_pages.py")], check=True)
for cid in sorted(existing - public):
    (root / "share" / f"{cid}.html").write_text(f'''<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>UnEarthed Finds</title>
<meta name="robots" content="noindex"><meta name="description" content="A find in the UnEarthed Finds catalog. Sign in to view it if you have access.">
<meta property="og:site_name" content="UnEarthed Finds"><meta property="og:title" content="UnEarthed Finds"><meta property="og:image" content="https://unearthedfinds.com/assets/brand/og-image.png">
<link rel="icon" href="../favicon.ico"><meta http-equiv="refresh" content="0; url=../#/find/{cid}"><script>location.replace("../#/find/{cid}")</script></head>
<body><p><a href="../#/find/{cid}">Open this find in UnEarthed Finds</a></p><p><small>© 2026 PolForge, LLC</small></p></body></html>
''')
# schema.sql seed: keep only public finds' rows
sp = root / "supabase/schema.sql"; out = []
for line in sp.read_text().splitlines(keepends=True):
    m = re.match(r"insert into public\.(finds|photos) \([^)]*\) values \('([A-Z]{2,5}-\d{3,})'", line)
    if m and m.group(2) not in public: continue
    out.append(line)
sp.write_text("".join(out))
print(f"public finds: {len(rows)} ({', '.join(sorted(public))}); share stubs: {len(existing - public)}")
