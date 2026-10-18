"""Import a small, freely licensed sample of reference images + records (2026-10-18).
- Wikimedia Commons: up to 3 images per curated category; only PD / CC0 / CC BY / CC BY-SA files are kept, with author,
  license and file-page link. Files whose author/credit is the USGS are tagged "USGS (public domain) via Wikimedia Commons".
- PBDB (Paleobiology Database, CC BY 4.0): taxon records (rank, age range, link) for fossils we catalog. Data only, no images
  (PBDB silhouettes come from PhyloPic under per-image licenses, so they're link-only).
RRUFF, PIDBA, Puget Sound Knappers: link-only (see docs/reference-sources.md). Colorado sources: skipped.
Writes data/reference/reference-media.json. Re-runnable; nothing else is touched."""
import json, re, time, urllib.parse, urllib.request, datetime, pathlib
UA = {"User-Agent": "UnEarthedFinds-reference-import/1.0 (https://unearthedfinds.com)"}
OUT = pathlib.Path(__file__).resolve().parents[2] / "data/reference/reference-media.json"
OK = re.compile(r"^(public domain|pd|cc0|cc[ -]by(-sa)?[ -]?[0-9.]*( [a-z]+)?)$", re.I)
CATS = [  # (Commons category, kind, keywords used to match AI candidate names)
 ("Clovis points", "artifact", ["clovis"]), ("Folsom points", "artifact", ["folsom"]), ("Fishtail points", "artifact", ["fishtail", "fell's cave"]),
  ("Pre-Columbian North American projectile points", "artifact", ["projectile point", "dart point", "arrow point", "arrowhead", "point"]),
 ("Arrowheads", "artifact", ["arrowhead", "arrow point"]), ("Stone hand axes", "artifact", ["biface", "bifacial", "hand axe", "handaxe", "chopper"]),
 ("Stone scrapers", "artifact", ["scraper"]), ("Lithic cores", "artifact", ["core", "cobble core", "flake", "debitage"]), ("Metate", "artifact", ["metate", "grinding slab", "grinding stone"]),
 ("Querns", "artifact", ["mano", "quern", "grinding stone"]), ("Potsherds", "artifact", ["sherd", "potsherd", "pottery"]),
 ("Exogyra", "fossil", ["exogyra", "oyster"]), ("Gryphaea", "fossil", ["gryphaea", "devil's toenail", "oyster"]), ("Heteromorph ammonites", "fossil", ["ammonite", "heteromorph"]),
 ("Comatulida fossils", "fossil", ["crinoid"]), ("Terebratulida fossils", "fossil", ["brachiopod"]), ("Spiriferida fossils", "fossil", ["brachiopod", "spirifer"]),
 ("Hemicidaris", "fossil", ["echinoid", "sea urchin", "heart urchin"]), ("Shark teeth fossils", "fossil", ["shark tooth", "shark teeth"]),
 ("Petrified wood", "fossil", ["petrified wood", "silicified wood", "fossil wood"]), ("Belemnites", "fossil", ["belemnite"]), ("Trilobita fossils", "fossil", ["trilobite"]),
 ("Rugosa fossils", "fossil", ["coral", "horn coral", "rugose"]), ("Bivalvia fossils", "fossil", ["bivalve", "clam", "pelecypod"]),
 ("Chert", "mineral", ["chert"]), ("Flint", "mineral", ["flint"]), ("Agate", "mineral", ["agate"]), ("Jasper", "mineral", ["jasper"]),
 ("Chalcedony", "mineral", ["chalcedony"]), ("Calcite", "mineral", ["calcite"]), ("Celestine", "mineral", ["celestine", "celestite"]),
 ("Selenite", "mineral", ["selenite", "gypsum"]), ("Pyrite", "mineral", ["pyrite"]), ("Hematite", "mineral", ["hematite"]),
 ("Obsidian", "mineral", ["obsidian"]), ("Limonite", "mineral", ["limonite", "goethite"]), ("Geodes", "mineral", ["geode"]),
 ("Quartz", "mineral", ["quartz"]), ("Concretions", "mineral", ["concretion"]), ("Opal", "mineral", ["opal"]),
]
PBDB = {"Exogyra": ["exogyra", "oyster"], "Gryphaea": ["gryphaea", "devil's toenail"], "Ammonoidea": ["ammonite"], "Crinoidea": ["crinoid"], "Brachiopoda": ["brachiopod"], "Turritella": ["turritella", "gastropod"], "Echinoidea": ["echinoid", "sea urchin", "heart urchin"], "Belemnitida": ["belemnite"], "Trilobita": ["trilobite"], "Rugosa": ["horn coral", "rugose", "coral"], "Otodus": ["otodus", "shark tooth"], "Squalicorax": ["squalicorax", "shark tooth"], "Ptychodus": ["ptychodus", "shark tooth"], "Inoceramus": ["inoceramus", "clam", "bivalve"], "Pecten": ["pecten", "scallop"]}
def get(url):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            if i == 3: raise
            time.sleep(2 + 3 * i)
strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()
def commons(cat, kind, kw):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "categorymembers", "gcmtitle": "Category:" + cat, "gcmtype": "file", "gcmlimit": 60,
        "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 320, "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl|Credit|ImageDescription"})
    pages = list((get("https://commons.wikimedia.org/w/api.php?" + q).get("query") or {}).get("pages", {}).values()); out = []
    for p in sorted(pages, key=lambda x: x["title"]):
        ii = (p.get("imageinfo") or [{}])[0]; m = ii.get("extmetadata", {}); lic = strip(m.get("LicenseShortName", {}).get("value"))
        if ii.get("mime") not in ("image/jpeg", "image/png") or not OK.match(lic): continue
        stems = {w.rstrip("s").lower() for w in re.findall(r"[A-Za-z]{4,}", cat) if w.lower() not in ("fossil", "fossils", "stone", "north", "american", "columbian")} | {k.split()[0] for k in kw}
        if not any(st[:6] in p["title"].lower() for st in stems) or re.search(r"map|chart|diagram|ooid|xpl|ppl|sculpture|site|catalogue|BHL", p["title"], re.I): continue  # on-topic specimen photos only
        if "machine-readable" in strip(m.get("Artist", {}).get("value")): continue
        artist = strip(m.get("Artist", {}).get("value"))[:120] or "Unknown author"; credit = strip(m.get("Credit", {}).get("value"))[:160]
        usgs = bool(re.search(r"\bUSGS\b|U\.S\. Geological Survey", artist + " " + credit, re.I))
        out.append({"id": "wmc:" + str(p["pageid"]), "source": "USGS (public domain) via Wikimedia Commons" if usgs else "Wikimedia Commons", "kind": kind, "keywords": kw,
            "title": p["title"][5:].rsplit(".", 1)[0][:140], "category": cat, "thumb_url": ii.get("thumburl"), "image_url": ii.get("url"), "source_url": ii.get("descriptionurl"),
            "license": lic, "license_url": strip(m.get("LicenseUrl", {}).get("value")) or None, "attribution": f"{artist} / {lic} / Wikimedia Commons"})
        if len(out) == 3: break
    return out
def pbdb(name, kw):
    d = get("https://paleobiodb.org/data1.2/taxa/single.json?" + urllib.parse.urlencode({"name": name, "show": "app,attr,class"}))
    r = (d.get("records") or [None])[0]
    if not r: return None
    oid = str(r.get("oid", "")).replace("txn:", "")
    return {"id": "pbdb:" + oid, "source": "Paleobiology Database (PBDB)", "kind": "fossil", "keywords": kw, "title": r.get("nam"), "thumb_url": None, "image_url": None,
        "source_url": f"https://paleobiodb.org/classic/basicTaxonInfo?taxon_no={oid}", "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Data: The Paleobiology Database (paleobiodb.org), CC BY 4.0",
        "data": {k: r.get(k) for k in ("rnk", "att", "fea", "fla", "lea", "lla", "phl", "cll", "odl", "fml") if r.get(k) is not None}}
items, missing = [], []
for cat, kind, kw in CATS:
    got = commons(cat, kind, kw); items += got; got or missing.append(cat); time.sleep(0.4)
for n, kw in PBDB.items():
    x = pbdb(n, kw); x and items.append(x); x or missing.append("PBDB " + n); time.sleep(0.4)
OUT.write_text(json.dumps({"meta": {"built": datetime.date.today().isoformat(), "note": "Small freely licensed sample. Credits travel with every item; see docs/reference-sources.md.",
    "counts": {s: sum(1 for i in items if i["source"] == s) for s in sorted({i["source"] for i in items})}, "skipped_categories": missing}, "items": items}, indent=1))
print(len(items), "items;", "missing:", missing)
