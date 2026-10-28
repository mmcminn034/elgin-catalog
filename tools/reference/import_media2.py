"""Reference-library expansion (2026-10-27). ADDITIVE: reads data/reference/reference-media.json, adds new items, never removes or edits existing ones.
Sources (all free/public; every item carries source, license, license URL, attribution and a source-page link):
 - Wikimedia Commons: only Public domain / CC0 / CC BY / CC BY-SA files, credited to author + license + file page.
 - Smithsonian Open Access (NMNH), media flagged usage.access == "CC0" only.
 - The Met Open Access (CC0, isPublicDomain) - a handful of US Archaic ground-stone objects.
 - PBDB taxon records (CC BY 4.0), data only (no images).
Link-only (never copied): RRUFF, Puget Sound Knappers, Texas Beyond History (TARL), Digital Atlas of Ancient Life (PRI; non-commercial terms), Mindat.
Run: python3 tools/reference/import_media2.py   (idempotent; dedups by id)"""
import json, re, time, urllib.parse, urllib.request, datetime, pathlib, sys
UA = {"User-Agent": "UnEarthedFinds-reference-import/2.0 (https://unearthedfinds.com)"}
OUT = pathlib.Path(__file__).resolve().parents[2] / "data/reference/reference-media.json"
OK = re.compile(r"^(public domain|pd|cc0|cc[ -]by(-sa)?[ -]?[0-9.]*( [a-z]+)?)$", re.I)
BAD = re.compile(r"\bmap\b|chart|diagram|ooid|xpl|ppl|sculpture|catalogue|BHL|\.pdf|stamp|logo|portrait|thin section|SEM\b|poster|painting|drawing|engraving|plate \d", re.I)
# curation pass (2026-10-27): titles reviewed by eye; these off-topic hits (lumber axes, memorials, plates, campus photos, industrial caliche mining, duplicates) are never imported
DENY = re.compile(r"Hands Up|ice axes|^Naari a MAON|Orsten-Andrarum|plane pole|Beach and cliffs near Porte|brewbooks|Banded Chert near Marble|Calcrete \\(Quaternary; Old Sellicks Hill Road, Fleurieu Peninsula, South Australia\\) [23]|Four men|KENT-DDDFF8|microlith|Arkeologia muzeo|мемориальный|Russian Wikinews|Note in Blue|HKU|Sklodowskite|^Limestone$|Beach in Les-Portes|Sand Les Portes|PSM V\d+|A depiction of|woman grinding|ExchangeArrow|BARTHOLDY|Mémoire sur les fossiles|habitat model|Edge of the Cedars|Digger implements|Dolni Vestonice|Strimple", re.I)
def get(url, tries=4):
    for i in range(tries):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except Exception as e:
            if i == tries - 1: print("  ! fetch failed", url[:90], str(e)[:60]); return {}
            time.sleep(2 + 3 * i)
strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()
# (Commons category, kind, topic tags, keywords for matching AI candidate names, max, loose title filter, recurse subcategories)
C = [
 # artifact families
 ("Clovis points", "artifact", ["paleoindian"], ["clovis"], 8, True, False), ("Folsom points", "artifact", ["paleoindian"], ["folsom"], 4, True, False),
 ("Pre-Columbian projectile points", "artifact", ["projectile point"], ["projectile point", "dart point", "arrow point", "point"], 6, True, False),
 ("Arrowheads", "artifact", ["arrow point"], ["arrowhead", "arrow point", "point"], 8, True, False),
 ("Native American flintknapping", "artifact", ["flintknapping", "flake"], ["flake", "debitage", "flintknapping", "biface"], 4, True, False),
 ("Flintknapping at Joshua Tree National Park", "artifact", ["flintknapping"], ["flintknapping", "biface", "preform", "flake"], 3, True, False),
 ("Hammerstones", "artifact", ["hammerstone", "ground stone"], ["hammerstone", "ground stone", "hammer"], 4, True, False),
 ("Lithic cores", "artifact", ["core", "debitage"], ["core", "cobble core", "debitage", "flake"], 5, True, False),
 ("Retouching (lithics)", "artifact", ["retouch", "flake scars"], ["retouch", "flake", "scraper", "flake scars", "biface"], 6, True, False),
 ("Preforms (archeology)", "artifact", ["preform"], ["preform", "biface"], 3, True, False),
  ("End scrapers", "artifact", ["scraper"], ["scraper", "end scraper"], 3, True, False), ("Side scrapers", "artifact", ["scraper"], ["scraper", "side scraper"], 3, True, False),
 ("Spalls", "artifact", ["flake", "spall"], ["flake", "spall", "debitage"], 3, True, False),
 ("Pre-Columbian metates", "artifact", ["metate", "ground stone"], ["metate", "grinding slab", "ground stone"], 5, True, False),
 ("Stone pestles", "artifact", ["pestle", "ground stone"], ["pestle", "mano", "ground stone"], 5, True, False),
 ("Stone mortars and pestles", "artifact", ["mortar", "pestle", "ground stone"], ["pestle", "mortar", "ground stone", "mano"], 4, True, False),
 ("Bannerstone", "artifact", ["ground stone", "atlatl weight"], ["bannerstone", "atlatl weight", "ground stone"], 3, True, False),
 # natural look-alikes (what is NOT an artifact)
 ("Caliche", "mineral", ["natural", "caliche", "calcrete"], ["caliche", "calcrete", "natural rock", "geofact"], 5, True, False),
 ("Calcrete", "mineral", ["natural", "caliche", "calcrete"], ["caliche", "calcrete", "natural rock", "geofact"], 3, True, True),
 ("Concretions in sandstone", "mineral", ["natural", "concretion"], ["concretion", "natural rock", "geofact", "sandstone"], 5, True, False),
 ("Sandstone concretions", "mineral", ["natural", "concretion"], ["concretion", "natural rock", "geofact", "sandstone"], 4, True, False),
 ("Cannonball concretions", "mineral", ["natural", "concretion"], ["concretion", "natural rock", "geofact"], 3, True, False),
 ("Limestone concretions", "mineral", ["natural", "concretion"], ["concretion", "natural rock", "geofact"], 3, True, False),
 ("Flint concretion", "mineral", ["natural", "chert nodule"], ["chert nodule", "flint nodule", "natural rock", "geofact", "chert"], 4, True, False),
 ("Chert nodule", "mineral", ["natural", "chert nodule"], ["chert nodule", "flint nodule", "natural rock", "geofact", "chert"], 5, True, False),
 ("Sandstone pebbles", "mineral", ["natural", "cobble", "sandstone"], ["sandstone", "cobble", "natural rock", "geofact", "pebble"], 4, True, False),
 ("Pebble conglomerate", "mineral", ["natural", "conglomerate"], ["conglomerate", "sandstone", "natural rock", "geofact", "pebble"], 4, True, False),
 ("Chert conglomerate", "mineral", ["natural", "conglomerate"], ["conglomerate", "chert", "natural rock", "geofact"], 3, True, False),
 ("Quartz-pebble conglomerate", "mineral", ["natural", "conglomerate"], ["conglomerate", "quartz", "natural rock", "geofact"], 3, True, False),
 ("Conchoidal fracture (minerals)", "mineral", ["conchoidal fracture", "natural"], ["conchoidal fracture", "chert", "flint", "quartz"], 4, True, False),
 # Texas / Cretaceous fossils
 ("Fossils from the Glen Rose Formation", "fossil", ["texas", "cretaceous"], ["glen rose", "cretaceous", "fossil"], 6, True, False),
 ("Fossils from the Austin Chalk", "fossil", ["texas", "cretaceous"], ["austin chalk", "cretaceous", "fossil"], 6, True, False),
 ("Fossils from Texas", "fossil", ["texas"], ["texas", "fossil"], 6, True, False),
 ("Baculites fossils", "fossil", ["ammonite", "cretaceous"], ["baculites", "ammonite"], 5, True, False),
 ("Heteraster fossils", "fossil", ["echinoid", "cretaceous"], ["heteraster", "echinoid", "sea urchin"], 4, True, False),
 ("Echinoconus", "fossil", ["echinoid", "cretaceous"], ["echinoconus", "echinoid", "sea urchin"], 3, True, False),
 ("Holectypus depressus", "fossil", ["echinoid"], ["holectypus", "echinoid"], 2, True, False),
 ("Cidaroida fossils", "fossil", ["echinoid"], ["cidaroid", "echinoid", "spine"], 3, True, False),
 ("Spatangoida fossils", "fossil", ["echinoid"], ["heart urchin", "spatangoid", "echinoid"], 4, True, False),
 ("Hippurites fossils", "fossil", ["rudist", "cretaceous"], ["rudist", "hippurites"], 3, True, False),
 ("Requienia", "fossil", ["rudist", "cretaceous"], ["rudist", "requienia"], 3, True, False),
 ("Nautilida fossils", "fossil", ["nautiloid"], ["nautiloid", "nautilus", "ammonite"], 3, True, False),
 ("Ostrea fossils", "fossil", ["oyster"], ["oyster", "ostrea"], 4, True, False),
 ("Lopha marshii", "fossil", ["oyster", "cretaceous"], ["oyster", "lopha"], 2, True, False),
 ("Mammalia coprolites", "fossil", ["coprolite"], ["coprolite"], 2, True, False),
 ("Waconella wacoensis", "fossil", ["brachiopod", "texas", "cretaceous"], ["brachiopod", "waconella"], 3, True, False),
 ("Araucarioxylon texense", "fossil", ["petrified wood", "texas"], ["petrified wood", "fossil wood", "araucarioxylon"], 2, True, False),
 # minerals
 ("Quartz in Texas", "mineral", ["texas"], ["quartz"], 3, True, False), ("Gypsum in Texas", "mineral", ["texas"], ["gypsum", "selenite"], 3, True, False),
 ("Minerals of Brewster County, Texas", "mineral", ["texas"], ["mineral", "agate", "calcite", "fluorite"], 4, True, False),
 ("Chert samples", "mineral", ["chert"], ["chert", "flint"], 5, True, False), ("Fossiliferous chert", "mineral", ["chert", "fossil"], ["chert", "fossiliferous chert"], 3, True, False),
 ("Black chert", "mineral", ["chert"], ["chert", "black chert"], 2, True, False), ("Banded chert", "mineral", ["chert"], ["chert", "banded chert"], 2, True, False),
 ("Flint (rock)", "mineral", ["chert", "flint"], ["flint", "chert"], 4, True, False), ("Novaculite", "mineral", ["chert", "novaculite"], ["novaculite", "chert"], 3, True, False),
 ("Pyrite concretions", "mineral", ["concretion", "pyrite"], ["pyrite", "marcasite", "concretion"], 3, True, False),
 ("Septarian concretions", "mineral", ["concretion", "calcite"], ["septarian", "concretion", "calcite"], 3, True, False),
 ("Ironstone concretions", "mineral", ["concretion", "iron"], ["ironstone", "concretion", "limonite", "hematite"], 3, True, False),
 ("Moqui marbles", "mineral", ["concretion", "iron"], ["concretion", "hematite", "ironstone"], 2, True, False),
]
def commons_files(cat):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "categorymembers", "gcmtitle": "Category:" + cat, "gcmtype": "file", "gcmlimit": 80,
        "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 320, "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl|Credit"})
    return list(((get("https://commons.wikimedia.org/w/api.php?" + q) or {}).get("query") or {}).get("pages", {}).values())
def subcats(cat):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "list": "categorymembers", "cmtitle": "Category:" + cat, "cmtype": "subcat", "cmlimit": 20})
    return [x["title"][9:] for x in ((get("https://commons.wikimedia.org/w/api.php?" + q) or {}).get("query") or {}).get("categorymembers", [])]
def spread(lst, n):  # evenly spaced pick so a category's samples are varied, not 3 consecutive shots of one specimen
    if len(lst) <= n: return lst
    return [lst[int(i * len(lst) / n)] for i in range(n)]
def commons(cat, kind, topics, kw, n, loose, recurse):
    pages = commons_files(cat)
    if recurse:
        for s in subcats(cat)[:4]: pages += commons_files(s)
    ok = []
    for p in sorted(pages, key=lambda x: x["title"]):
        ii = (p.get("imageinfo") or [{}])[0]; m = ii.get("extmetadata", {}); lic = strip(m.get("LicenseShortName", {}).get("value"))
        if ii.get("mime") not in ("image/jpeg", "image/png") or not OK.match(lic) or BAD.search(p["title"]) or DENY.search(p["title"]): continue
        artist = strip(m.get("Artist", {}).get("value"))
        if "machine-readable" in artist: continue
        ok.append((p, ii, m, lic, artist))
    out = []
    for p, ii, m, lic, artist in spread(ok, n):
        artist = artist[:120] or "Unknown author"; credit = strip(m.get("Credit", {}).get("value"))[:160]
        usgs = bool(re.search(r"\bUSGS\b|U\.S\. Geological Survey", artist + " " + credit, re.I))
        out.append({"id": "wmc:" + str(p["pageid"]), "source": "USGS (public domain) via Wikimedia Commons" if usgs else "Wikimedia Commons", "kind": kind, "keywords": kw,
            "title": p["title"][5:].rsplit(".", 1)[0][:140], "category": cat, "thumb_url": ii.get("thumburl"), "image_url": ii.get("url"), "source_url": ii.get("descriptionurl"),
            "license": lic, "license_url": strip(m.get("LicenseUrl", {}).get("value")) or None, "attribution": f"{artist} / {lic} / Wikimedia Commons", "data": {"topics": topics}})
    return out
# ---- Smithsonian Open Access (NMNH), CC0 media only. api.data.gov DEMO_KEY, throttled.
SI_KEY = "DEMO_KEY"
SI = [  # (query, kind, topics, keywords, max, unit filter)
 ("Exogyra", "fossil", ["oyster", "cretaceous", "texas"], ["exogyra", "oyster"], 4, "NMNHPALEO"), ("Gryphaea", "fossil", ["oyster", "cretaceous"], ["gryphaea", "oyster", "devil's toenail"], 3, "NMNHPALEO"),
 ("Texas echinoid", "fossil", ["echinoid", "cretaceous", "texas"], ["echinoid", "sea urchin", "heart urchin"], 5, "NMNHPALEO"), ("Texas ammonite", "fossil", ["ammonite", "cretaceous", "texas"], ["ammonite"], 4, None),
 ("Turritella Texas", "fossil", ["gastropod", "texas"], ["turritella", "gastropod"], 3, "NMNHPALEO"), ("Texas Cretaceous bivalve", "fossil", ["bivalve", "cretaceous", "texas"], ["bivalve", "clam", "oyster"], 4, "NMNHPALEO"),
 ("Texas Cretaceous gastropod", "fossil", ["gastropod", "cretaceous", "texas"], ["gastropod", "snail"], 3, "NMNHPALEO"), ("Texas Cretaceous coral", "fossil", ["coral", "cretaceous", "texas"], ["coral"], 3, "NMNHPALEO"),
 ("Texas crinoid", "fossil", ["crinoid", "texas"], ["crinoid"], 2, "NMNHPALEO"), ("Texas brachiopod", "fossil", ["brachiopod", "texas"], ["brachiopod"], 3, "NMNHPALEO"),
 ("Texas shark tooth", "fossil", ["shark tooth", "texas"], ["shark tooth", "shark teeth"], 3, "NMNHPALEO"), ("fossil moon snail", "fossil", ["gastropod"], ["gastropod", "moon snail"], 2, "NMNHEDUCATION"),
 ("calcite Texas", "mineral", ["calcite", "texas"], ["calcite"], 2, "NMNHMINSCI"), ("celestine", "mineral", ["celestine"], ["celestine", "celestite"], 3, "NMNHMINSCI"), ("quartz Texas", "mineral", ["quartz", "texas"], ["quartz"], 3, "NMNHMINSCI"),
 ("barite Texas", "mineral", ["barite", "texas"], ["barite"], 2, "NMNHMINSCI"), ("agate Texas", "mineral", ["agate", "texas"], ["agate", "chalcedony"], 2, "NMNHMINSCI"), ("pyrite", "mineral", ["pyrite"], ["pyrite"], 3, "NMNHMINSCI"),
 ("gypsum selenite", "mineral", ["gypsum"], ["selenite", "gypsum"], 3, "NMNHMINSCI"), ("opalized wood", "fossil", ["petrified wood"], ["petrified wood", "fossil wood"], 2, None), ("chert", "mineral", ["chert"], ["chert", "flint"], 3, "NMNHMINSCI"),
 ("limonite concretion", "mineral", ["concretion"], ["limonite", "concretion"], 2, "NMNHMINSCI"), ("flint knapped", "artifact", ["flake", "flintknapping"], ["flake", "flintknapping", "biface"], 2, None),
]
def smithsonian(q, kind, topics, kw, n, unit):
    qq = f'{q} AND online_visual_material:true' + (f' AND unit_code:{unit}' if unit else "")
    url = "https://api.si.edu/openaccess/api/v1.0/search?" + urllib.parse.urlencode({"q": qq, "api_key": SI_KEY, "rows": 25})
    rows = ((get(url) or {}).get("response") or {}).get("rows", []); out = []
    for r in rows:
        dn = (r.get("content") or {}).get("descriptiveNonRepeating") or {}
        media = [x for x in (dn.get("online_media") or {}).get("media", []) if x.get("type") == "Images" and (x.get("usage") or {}).get("access") == "CC0" and x.get("thumbnail") and x.get("idsId")]
        if not media or not dn.get("record_link"): continue
        mm = media[0]; title = strip(r.get("title"))[:140]
        if BAD.search(title) or DENY.search(title) or sum(1 for o in out if o["title"] == title) >= (1 if len(title) > 12 and "Ammonite" in title or "cymba" in title else 2): continue
        place = strip(" ".join(p.get("content", "") for p in ((r.get("content") or {}).get("freetext") or {}).get("place", [])[:1]))[:140]
        out.append({"id": "si:" + str(r["id"])[-40:], "source": "Smithsonian Open Access (NMNH)", "kind": kind, "keywords": kw, "title": title, "category": q,
            "thumb_url": "https://ids.si.edu/ids/deliveryService?id=" + mm["idsId"] + "&max=320", "image_url": "https://ids.si.edu/ids/deliveryService?id=" + mm["idsId"], "source_url": dn["record_link"],
            "license": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "attribution": f"{strip(dn.get('data_source')) or 'Smithsonian National Museum of Natural History'} / CC0 (Smithsonian Open Access)", "data": {"topics": topics, "place": place}})
        if len(out) >= n: break
    return out
MET = [(307597, "artifact", ["ground stone", "archaic"], ["grooved axe", "ground stone", "celt"]), (313322, "artifact", ["ground stone", "archaic", "atlatl weight"], ["bannerstone", "atlatl weight", "ground stone"]),
       (319173, "artifact", ["ground stone", "archaic", "atlatl weight"], ["bannerstone", "atlatl weight", "ground stone"]), (319175, "artifact", ["ground stone", "archaic", "atlatl weight"], ["bannerstone", "atlatl weight", "ground stone"]),
       (313506, "artifact", ["ground stone", "archaic"], ["birdstone", "ground stone"])]
def met(oid, kind, topics, kw):
    d = get(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}") or {}
    if not (d.get("isPublicDomain") and d.get("primaryImageSmall")): return None
    return {"id": f"met:{oid}", "source": "The Met Open Access", "kind": kind, "keywords": kw, "title": f"{d['title']} ({d.get('culture') or 'N. America'}, {d.get('objectDate')})"[:140], "category": "Met Open Access",
        "thumb_url": d["primaryImageSmall"], "image_url": d.get("primaryImage") or d["primaryImageSmall"], "source_url": d["objectURL"], "license": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution": f"The Metropolitan Museum of Art, {d.get('creditLine')} / CC0 (Open Access)", "data": {"topics": topics, "place": "Eastern United States (not Texas)"}}
PBDB = {"Baculites": ["baculites", "ammonite"], "Heteraster": ["heteraster", "echinoid"], "Hemiaster": ["hemiaster", "echinoid", "heart urchin"], "Holectypus": ["holectypus", "echinoid"], "Echinoconus": ["echinoconus", "echinoid"],
        "Texigryphaea": ["texigryphaea", "oyster"], "Lopha": ["lopha", "oyster"], "Ostrea": ["ostrea", "oyster"], "Kingena": ["kingena", "brachiopod"], "Waconella": ["waconella", "brachiopod"], "Hippuritida": ["rudist", "hippurites"], "Caprinidae": ["rudist", "caprinid"],
        "Mosasauridae": ["mosasaur"], "Hybodontiformes": ["hybodont", "shark"], "Cretoxyrhina": ["cretoxyrhina", "shark tooth"], "Enchodus": ["enchodus", "fish"], "Protosphyraena": ["protosphyraena", "fish"], "Lamna": ["lamna", "shark tooth"], "Carcharodon": ["carcharodon", "shark tooth"],
        "Cyclorismina": ["cyclorismina", "echinoid"], "Pseudoperna": ["pseudoperna", "oyster"], "Neithea": ["neithea", "scallop"], "Pycnodonte": ["pycnodonte", "oyster"], "Mammuthus": ["mammoth"], "Bison": ["bison"], "Equus": ["horse"], "Glyptotherium": ["glyptodont"],
        "Aporrhais": ["aporrhais", "gastropod"], "Tylostoma": ["tylostoma", "gastropod"], "Nerinea": ["nerinea", "gastropod"], "Actaeonella": ["actaeonella", "gastropod"], "Turritella": ["turritella", "gastropod"], "Cidaris": ["cidaris", "echinoid"], "Salenia": ["salenia", "echinoid"]}
def pbdb(name, kw):
    d = get("https://paleobiodb.org/data1.2/taxa/single.json?" + urllib.parse.urlencode({"name": name, "show": "app,attr,class"}))
    r = ((d or {}).get("records") or [None])[0]
    if not r: return None
    oid = str(r.get("oid", "")).replace("txn:", "")
    return {"id": "pbdb:" + oid, "source": "Paleobiology Database (PBDB)", "kind": "fossil", "keywords": kw, "title": r.get("nam"), "thumb_url": None, "image_url": None,
        "source_url": f"https://paleobiodb.org/classic/basicTaxonInfo?taxon_no={oid}", "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Data: The Paleobiology Database (paleobiodb.org), CC BY 4.0", "data": {k: r.get(k) for k in ("rnk", "att", "fea", "fla", "lea", "lla", "phl", "cll", "odl", "fml") if r.get(k) is not None}}
if __name__ == "__main__":
    cur = json.loads(OUT.read_text()); have = {i["id"] for i in cur["items"]}; new, missing = [], []
    def add(xs, label):
        n = 0
        for x in xs or []:
            if x and x["id"] not in have and (x.get("thumb_url") or x["source"].startswith("Paleobiology")): have.add(x["id"]); new.append(x); n += 1
        n or missing.append(label)
    for c in C: add(commons(*c), c[0]); time.sleep(0.3)
    for s in SI: add(smithsonian(*s), "SI " + s[0]); time.sleep(1.5)
    for m in MET: add([met(*m)], f"Met {m[0]}"); time.sleep(0.2)
    for n, kw in PBDB.items(): add([pbdb(n, kw)], "PBDB " + n); time.sleep(0.3)
    cur["items"] += new
    cur["meta"].update({"built": datetime.date.today().isoformat(), "counts": {s: sum(1 for i in cur["items"] if i["source"] == s) for s in sorted({i["source"] for i in cur["items"]})}, "skipped_categories": missing,
        "note": "Freely licensed sample. Credits travel with every item; see docs/reference-sources.md."})
    OUT.write_text(json.dumps(cur, indent=1)); print(len(new), "new items;", len(cur["items"]), "total; empty/missing:", missing)
