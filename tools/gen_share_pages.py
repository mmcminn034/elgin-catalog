"""Generate share/<ID>.html: static pages with per-find Open Graph tags that redirect to the app's #/find/<ID>."""
import json, html, pathlib
root = pathlib.Path(__file__).resolve().parent.parent; SITE = "https://mmcminn034.github.io/elgin-catalog/"
out = root / "share"; out.mkdir(exist_ok=True)
for r in json.load(open(root / "data/catalog.json")):
    if r.get("is_public") is False or r.get("visibility", "public") != "public": continue
    region = r.get("region") or "Bastrop County, Texas"  # county-level only; exact find spots are never published
    cid = r["catalog_id"]; t = html.escape(f'{cid} · {r.get("object_type","Find")} | Rolling Oak Catalog')
    d = html.escape(f'{r.get("object_type","")} ({r.get("material","")}). Possibilities: {", ".join(x for x in [r.get("suggestion_1"), r.get("suggestion_2")] if x)}. Found in {region} (general area). Research suggestions, not identifications.')
    img = SITE + (r["photos"][0]["path"] if r.get("photos") else "assets/brand/og-image.png"); url = SITE + f"#/find/{cid}"
    (out / f"{cid}.html").write_text(f'''<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>{t}</title>
<meta name="description" content="{d}"><meta property="og:type" content="article"><meta property="og:site_name" content="Rolling Oak Catalog">
<meta property="og:title" content="{t}"><meta property="og:description" content="{d}"><meta property="og:image" content="{img}"><meta property="og:url" content="{SITE}share/{cid}.html">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{t}"><meta name="twitter:description" content="{d}"><meta name="twitter:image" content="{img}"><meta property="og:image:alt" content="{html.escape(cid)} primary photo"><link rel="icon" href="../favicon.ico"><link rel="canonical" href="{url}">
<meta http-equiv="refresh" content="0; url=../#/find/{cid}"><script>location.replace("../#/find/{cid}")</script></head>
<body><p><a href="../#/find/{cid}">Open {html.escape(cid)} in Rolling Oak Catalog</a></p></body></html>
''')
print("ok")
