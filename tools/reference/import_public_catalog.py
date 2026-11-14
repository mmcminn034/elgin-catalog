#!/usr/bin/env python3
"""Public Reference Catalog importer. The database is the source of truth: --add N (weekly) and --to-db write reference_media rows + Storage thumbnails (bucket reference-media). Legacy JSON mode can still write data/reference/public-catalog.json, but that file is no longer shipped or used by the app (removed after 027).

Only institution-held specimens/objects ("proven": museum catalog number or institutional record) whose IMAGE is
CC0, public domain, CC BY or CC BY-SA. Every record keeps license, license URL, creator/institution, source URL and an
attribution line. Locations are reduced to county/state (or country) level; coordinates and localities are never stored.
Thumbnails are re-encoded (max 480 px WebP), which also drops all EXIF/GPS metadata.

Sources (see docs/reference-sources.md):
  ypm   Yale Peabody Museum Anthropology via LUX (lux.collections.yale.edu), CC0 per IIIF manifest      -> artifacts
  met   The Met Open Access (isPublicDomain = CC0)                                                     -> artifacts
  cma   Cleveland Museum of Art Open Access (share_license_status = CC0)                               -> artifacts
  wmc   Wikimedia Commons files that name the holding museum/agency, free licenses only               -> artifacts
  gbif  GBIF fossil specimens (FOSSIL_SPECIMEN) whose MEDIA license is CC0/CC BY/CC BY-SA              -> fossils
  si    Smithsonian Open Access, NMNH Mineral Sciences, CC0 media only                                 -> minerals
  ref   existing reference_media rows from institutions (Smithsonian, Met) are reused, not duplicated

Usage: python3 tools/reference/import_public_catalog.py [--only ypm,gbif,...] [--cache DIR] [--no-images] [--cache-only]
Round 1 (2026-11-11) was capped by --cache-only for ypm; re-run without it (same --cache) to fetch more in a later round.
Additive: existing records in public-catalog.json are kept unless their source is re-run; ids are stable.
Skipped by policy: Colorado Projectile Point Database; any NC/ND or "all rights reserved" media.
"""
import argparse, concurrent.futures as cf, hashlib, io, json, os, pathlib, re, sys, time, urllib.parse, urllib.request
import faulthandler, signal; faulthandler.register(signal.SIGUSR1)
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data/reference/public-catalog.json"
IMG = ROOT / "images/reference"
UA = {"User-Agent": "UnEarthedFinds-reference-import/3.0 (https://unearthedfinds.com)"}
SI_KEY = os.environ.get("SI_API_KEY", "DEMO_KEY")  # api.data.gov key; DEMO_KEY is throttled but enough for a batch
ap = argparse.ArgumentParser(); ap.add_argument("--only", default=""); ap.add_argument("--cache", default=os.environ.get("PC_CACHE", "/tmp/pc-cache"))
ap.add_argument("--no-images", action="store_true")
ap.add_argument("--add", type=int, default=0, help="weekly mode: fetch the next N new records (not already in reference_media), upload thumbnails to Storage and insert them into the database")
ap.add_argument("--to-db", action="store_true", help="load data/reference/public-catalog.json (round 1) into reference_media + Storage")
ap.add_argument("--dry-run", action="store_true", help="with --add: build and report, write nothing")
ap.add_argument("--cache-only", action="store_true", help="metadata only from the local cache (no new API calls); images for those records may still download")
A = ap.parse_args()
CACHE = pathlib.Path(A.cache); CACHE.mkdir(parents=True, exist_ok=True)
strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(s or ""))).strip()

def get(url, raw=False, tries=4, cache=True):
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + (".bin" if raw else ".json"))
    if cache and f.exists() and f.stat().st_size: b = f.read_bytes(); return b if raw else json.loads(b)
    if A.cache_only and not raw: return None
    for i in range(tries):
        try:
            t0, b = time.time(), b""
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as resp:  # wall-clock cap: a trickling response must not stall the run
                while (c := resp.read(1 << 16)):
                    b += c
                    if time.time() - t0 > 45: raise TimeoutError("slow response")
            if os.environ.get("PC_DEBUG") and time.time() - t0 > 10: print(f"slow {time.time() - t0:.0f}s {url[:140]}", file=sys.stderr)
            if not raw: json.loads(b)
            f.write_bytes(b); return b if raw else json.loads(b)
        except TimeoutError as e:
            if str(e) == "slow response": print(f"skipped slow response: {url[:120]}", file=sys.stderr); return None
            time.sleep(2 + 3 * i)
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404, 410, 500): return None
            time.sleep(3 + 5 * i)
        except Exception: time.sleep(2 + 3 * i)
    return None

US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"]
ST_RE = re.compile(r"\b(" + "|".join(sorted(US_STATES, key=len, reverse=True)) + r")\b")
def region_us(state, county=None):
    """County/state only. County names are cleaned ('Co.' -> 'County'); anything finer is dropped by the callers."""
    if not state: return ""
    if county:
        c = re.sub(r"\s+(Co\.?|County|Parish)$", "", county.strip(), flags=re.I).strip(" ,.")
        if c and len(c) < 40 and not re.search(r"\d|near|mi\.|km|unknown|\?", c, re.I):
            return f"{c} {'Parish' if state == 'Louisiana' else 'County'}, {state}"
    return state
LITHIC = ["obsidian","novaculite","chalcedony","quartzite","rhyolite","basalt","jasper","agate","flint","chert","slate","granite","diorite","greenstone","hematite","steatite","sandstone","limestone","quartz","argillite","shale","jadeite","jade","serpentine","porphyry"]
def material_of(text, default="Stone"):
    t = text.lower(); hits = [m for m in LITHIC if re.search(r"\b" + m + r"\b", t)]
    hits = [h for h in hits if not (h == "quartz" and "quartzite" in hits)]
    return ", ".join(h.capitalize() if i == 0 else h for i, h in enumerate(hits[:2])) if hits else default
PERIODS = [("paleo-?indian|paleoindian|clovis|folsom|plainview|dalton", "Paleoindian"), ("\\barchaic\\b", "Archaic"), ("woodland", "Woodland"),
           ("mississippian", "Mississippian"), ("late prehistoric", "Late Prehistoric"), ("neolithic", "Neolithic"), ("mesolithic", "Mesolithic"),
           ("upper pal(a)?eolithic|aurignacian|solutrean|magdalenian|gravettian", "Upper Paleolithic"), ("middle pal(a)?eolithic|mousterian", "Middle Paleolithic"),
           ("lower pal(a)?eolithic|acheulean", "Lower Paleolithic"), ("predynastic", "Predynastic Egypt"), ("jomon|jōmon", "Jōmon (Japan)"), ("yayoi", "Yayoi (Japan)")]
def period_of(text):  # only when the source text names the period; never inferred from shape
    t = text.lower(); return next((p for rx, p in PERIODS if re.search(rx, t)), "")
SENSITIVE = re.compile(r"nagpra|repatriat|burial|grave|funerary|mortuary|human|skull|skeleton|cremat|sacred|medicine bundle|ceremonial object|scalp|remains", re.I)
LIC_URL = {"CC0": "https://creativecommons.org/publicdomain/zero/1.0/", "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
           "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/", "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/"}
def lic_from_url(u):
    u = (u or "").lower()
    if "publicdomain/zero" in u or u.strip() in ("cc0", "cc0 1.0"): return "CC0"
    if "publicdomain/mark" in u: return "Public domain"
    m = re.search(r"licenses/(by(?:-sa)?)/(\d\.\d)", u)
    return f"CC {m.group(1).upper()} {m.group(2)}" if m else None
# Dated or disrespectful wording in museum titles is softened for display; the museum's own wording is kept in source_title.
SOFTEN = [(r"\bPaleo-?Indian\b", "Paleoindian"), (r"\bAmerican Indians\b", "Native Americans"), (r"\bAmerican Indian\b", "Native American"),
          (r"\bIndians\b(?!\s+(?:Ocean|River|Creek|Lake|Mounds?|Hills?|Territory|Head|Springs?|Valley|Key)\b)", "Native Americans"),
          (r"\bIndian\b(?!\s+(?:Ocean|River|Creek|Lake|Mounds?|Hills?|Territory|Head|Springs?|Valley|Key)\b)", "Native American"),
          (r"\bEskimos?\b", "Arctic Indigenous"), (r"\bsquaws?\b", "Indigenous woman's"), (r"\bredskins?\b", "Native American"),
          (r"\bsavages?\b", "Indigenous people"), (r"\bprimitive\b", "early"), (r"\bhalf[- ]?breeds?\b", "mixed-heritage")]
def soften(t, americas=True):
    t = str(t or "")
    for rx, rep in SOFTEN:
        if "Indian" in rx and "Paleo" not in rx and not americas: continue  # objects from India keep "Indian"; "Paleoindian" is the period name  # e.g. objects from India keep "Indian"
        t = re.sub(rx, rep, t, flags=0 if "Indian" in rx else re.I)
    return re.sub(r"\bNative American\s+Native American\b", "Native American", t)
POINT_TYPES = None
def keywords_of(k):
    """Terms similar_reference_media() matches against AI candidate names (lower case, most specific first)."""
    global POINT_TYPES
    if POINT_TYPES is None:
        try: POINT_TYPES = sorted({re.sub(r"\s*\(.*$", "", t.get("name", "")).strip().lower() for t in json.load(open(ROOT / "data/reference/points.json"))["types"]} - {""}, key=len, reverse=True)
        except Exception: POINT_TYPES = []
    text = (k.get("name", "") + " " + k.get("description", "") + " " + k.get("source_title", "")).lower(); kw = []
    if k["category"] == "artifact":
        kw += [t for t in POINT_TYPES if len(t) > 3 and re.search(r"\b" + re.escape(t) + r"\b", text)][:3]
        kw += [t for t in ["clovis", "folsom", "dalton", "plainview", "bannerstone", "birdstone", "gorget", "celt", "grooved axe", "axe", "adze", "pestle", "mortar", "mano", "metate", "hammerstone",
                           "scraper", "end scraper", "side scraper", "drill", "perforator", "biface", "preform", "knife", "blade", "uniface", "chopper", "plummet", "abrader", "flake", "core"] if re.search(r"\b" + t + r"s?\b", text)]
        if re.search(r"\bax\b", text) and "axe" not in kw: kw.append("axe")
        if k.get("type") == "Projectile point" or re.search(r"projectile|arrow|dart|spear", text): kw += ["projectile point", "point", "arrowhead", "dart point", "arrow point"]
        m = (k.get("material") or "").split(",")[0].strip().lower()
        if m and m != "stone": kw.append(m + " " + ("point" if "point" in kw else "tool"))
    elif k["category"] == "fossil":
        nm = re.sub(r"\s*\(.*$", "", k.get("name", "")); g = nm.split(" ")[0].lower() if nm and nm[0].isupper() else ""
        if g and len(g) > 3: kw.append(g)
        parts = nm.split(" ")
        if len(parts) >= 2 and parts[1].islower() and parts[1].isalpha(): kw.insert(0, (parts[0] + " " + parts[1]).lower())
        grp = (k.get("type") or "").lower()
        for w, terms in [("ammonite", ["ammonite"]), ("echinoid", ["echinoid", "sea urchin"]), ("bivalve", ["bivalve", "clam", "oyster"]), ("gastropod", ["gastropod", "snail"]), ("brachiopod", ["brachiopod"]),
                         ("coral", ["coral"]), ("crinoid", ["crinoid"]), ("trilobite", ["trilobite"]), ("shark", ["shark tooth", "shark"]), ("plant", ["plant fossil", "petrified wood" if "wood" in text else "leaf fossil"]),
                         ("mammal", ["mammal fossil"]), ("reptile", ["reptile fossil"]), ("sponge", ["sponge"]), ("bryozoan", ["bryozoan"]), ("cephalopod", ["ammonite", "nautiloid"])]:
            if w in grp: kw += terms
    else:
        base = re.sub(r"\s*\(.*$|\bvar\..*$", "", k.get("name", "")).strip().lower()
        if base: kw.append(base)
        kw += [w for w in base.replace(",", " ").split() if len(w) > 3 and w not in ("with", "from", "and")][:3]
        if "agate" in base or "jasper" in base or "chert" in base or "flint" in base: kw.append("chert")
    out = []
    for w in kw:
        w = w.strip()
        if w and w not in out: out.append(w)
    return out[:10]
def rec(**k):
    am = bool(ST_RE.search(k.get("region", ""))) or "America" in (k.get("culture", "") + k.get("region", ""))
    k["source_title"] = k.get("name", ""); k["name"] = soften(k.get("name", ""), am); k["description"] = soften(k.get("description", ""), am)
    if k.get("culture"): k["culture"] = soften(k["culture"], am)
    k.setdefault("period", ""); k.setdefault("age", ""); k.setdefault("formation", ""); k.setdefault("catalog_number", ""); k.setdefault("description", "")
    k["tx"] = k.get("region", "").endswith("Texas"); k["us"] = bool(ST_RE.search(k.get("region", ""))) or k.get("region") == "United States"
    k["search"] = " ".join(str(k.get(x, "")) for x in ("name", "type", "material", "period", "age", "formation", "region", "institution", "catalog_number", "description")).lower()
    k["keywords"] = keywords_of(k)
    return k
EXCLUDE, EXCLUDE_PAIRS = set(), set()  # --add: ids and (source, catalog number) already in the database
def is_new(r): return r["id"] not in EXCLUDE and (r["source"], (r.get("catalog_number") or "").strip().upper()) not in EXCLUDE_PAIRS

# Round-1 caps (2026-11-11, ~1,100 records approved by Mark). Raise these (and the per-state numbers in gbif()) for a later round.
CAP_YPM_PER_STATE, CAP_YPM_OTHER, CAP_GBIF_TX, CAP_GBIF_GENUS_TX, YPM_MAX_PAGES, SI_MAX_START, GBIF_STATE_MULT = 25, 400, 520, 4, 12, 1000, 1
if A.add:  # weekly mode: look deeper; dedupe against the database decides what is new
    CAP_YPM_PER_STATE, CAP_YPM_OTHER, CAP_GBIF_TX, CAP_GBIF_GENUS_TX, YPM_MAX_PAGES, SI_MAX_START, GBIF_STATE_MULT = 10**6, 10**6, max(60, A.add), 6, 20, 3000, 1
# ---------------------------------------------------------------- Yale Peabody Museum Anthropology (LUX, CC0)
def ypm():
    out, seen = [], set()
    Q = [["Texas", "point"], ["Texas", "chert"], ["Texas", "flint"], ["Texas", "biface"], ["Texas", "scraper"], ["Texas", "knife"], ["Texas", "stone"], ["Texas", "arrow"], ["Texas", "drill"], ["Texas", "axe"], ["Texas", "celt"], ["Texas", "mano"], ["Texas", "metate"], ["Texas", "quartzite"], ["Texas", "flake"],
         ["Oklahoma", "point"], ["New Mexico", "point"], ["Louisiana", "point"], ["Arkansas", "point"], ["Kansas", "point"],
         ["projectile point", "USA"], ["arrowhead", "USA"], ["biface", "USA"], ["scraper", "USA"], ["celt", "USA"], ["axe", "USA"], ["drill", "USA"],
         ["knife", "chert", "USA"], ["bannerstone", "USA"], ["pestle", "USA"], ["Clovis"], ["Folsom"]]
    lim = {"Texas": 400}
    for terms in Q:
        q = json.dumps({"AND": [{"text": t} for t in terms] + [{"hasDigitalImage": 1}]})
        cap = 400 if "Texas" in terms else 60; got = 0; page = 1
        while got < cap:
            d = get("https://lux.collections.yale.edu/api/search/item?" + urllib.parse.urlencode({"q": q, "page": page, "pageLength": 50}))
            items = (d or {}).get("orderedItems") or []
            if not items: break
            for it in items:
                if it["id"] not in seen: seen.add(it["id"]); got += 1
            page += 1
            if page > YPM_MAX_PAGES: break
    print("ypm candidates", len(seen), file=sys.stderr)
    def one(u):
        o = get(u)
        if not o or not any("Anthropology" in (m.get("_label") or "") for m in o.get("member_of", [])): return None
        name = next((n.get("content") for n in o.get("identified_by", []) if n.get("type") == "Name"), "") or o.get("_label", "")
        catno = next((n.get("content") for n in o.get("identified_by", []) if n.get("type") == "Identifier" and "YPM ANT" in (n.get("content") or "")), "")
        label = o.get("_label", "")
        man = next((ap_["id"] for s in o.get("subject_of", []) for dg in s.get("digitally_carried_by", []) for ap_ in dg.get("access_point", []) if "manifests.collections.yale.edu" in ap_.get("id", "")), None)
        if not man or not catno: return None
        m = get(man) or {}
        if "publicdomain/zero" not in (m.get("rights") or ""): return None
        imgs = re.findall(r'"(https://images\.collections\.yale\.edu/iiif/2/ypm:[0-9a-f-]+)"', json.dumps(m))
        if not imgs: return None
        refs = {(c.get("_label") or ""): x.get("content") for x in o.get("referred_to_by", []) for c in x.get("classified_as", [])[:1]}
        # location: "... USA <State> [<County> County] [town...]" in the label; keep state + county only
        mm = re.search(r"\bUSA\s+" + ST_RE.pattern[2:-2] + r"\b(?:\s+([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)?)\s+(?:County|Co\.?|Parish)\b)?", label)
        if not mm or "?" in label or re.search(r"provenience unknown", label, re.I): return None
        region = region_us(mm.group(1), mm.group(2))
        sents = [s.strip() for s in re.split(r"(?<=[.;])\s+(?=[A-Z0-9\[])", re.sub(r"\s*\((?:No\.\s*)?\d+\)", "", name)) if s.strip()]
        keep = [s for s in sents if not ST_RE.search(s) and "USA" not in s and not re.search(r"\bCounty\b|\bCo\.|^(L|W|T|Th|Length|Width)\b\s*:?|\(.*#|\bcollection\b|\bcoll\.|\$|^from\b|\bfound\b|\bnear\b|\bfarm\b|\bsite\b|\bacc\.|\bmound\b|\bvillage\b|\bcreek\b|\briver\b|^indian\.?$", s, re.I)]
        if not keep: return None
        ALLOW = {"Clovis", "Folsom", "Dalton", "Archaic", "Woodland", "Paleo", "Paleoindian", "Made", "Probably", "Some", "Edges", "Tip", "Base", "Possibly", "One", "Two", "Three", "Four", "Five", "Several", "Various", "Chert", "Flint", "Quartz", "Quartzite", "Obsidian", "Jasper", "Slate", "Stone", "Gray", "Grey", "Brown", "White", "Black", "Red", "Tan", "Buff", "Leaf", "Triangular", "Stemmed", "Side", "Corner", "Basal", "Large", "Small", "Broken", "Well", "Roughly", "Long", "Chipped", "Polished", "Grooved", "Fragment", "Bifacial", "Notched", "This", "The", "With", "Concave", "Convex", "Straight", "Narrow", "Broad", "Thin", "Thick", "Fine", "Coarse"}
        def plain(s_): return not re.search(r"[\"“”]|label|no\.|#", s_, re.I) and all(w in ALLOW for w in re.findall(r"\b[A-Z][a-z]+\b", s_)) and not re.search(r"\b[A-Z]\.", s_)
        title = re.sub(r",?\s+[LW]$", "", re.split(r"\s+(?:from|at|near)\s+[A-Z]", keep[0])[0].rstrip(".;, -")); desc = " ".join(x for x in keep[1:] if plain(x))[:300]
        if not plain(title) and re.search(r"[\"“”]|label", title): return None
        text = name + " " + (refs.get("Culture Note") or "")
        if "?" in name or SENSITIVE.search(label) or re.search(r"\bcasts?\b|replica|reproduction|ivory|\bcorn\b|flour|\bbone\b|\bshell\b|wooden|copper|pottery|\bclay\b|\bglass\b|\biron\b|\bbrass\b", name, re.I): return None
        if SENSITIVE.search(text) or not re.search(r"point|arrow|biface|blade|knife|scraper|drill|celt|axe|adze|preform|flake|core|hammer|pestle|mano|metate|banner|gorget|chopper|graver|perforator|spear|dart|tool|uniface|gouge|plummet|abrader", text, re.I): return None
        title = re.sub(r"^1\s+", "", title); t = title[0].upper() + title[1:]
        if not re.search(r"point|arrow|biface|blade|knife|scraper|drill|celt|\bax|adze|preform|flake|core|hammer|pestle|mano|metate|banner|gorget|chopper|graver|perforator|spear|dart|tool|uniface|gouge|plummet|abrader|ornament|stone", t, re.I):
            return None  # the title must describe the object (some catalog titles are only a place name)
        typ = next((v for rx, v in [("projectile|arrow|dart|spear| point", "Projectile point"), ("biface|preform|blank", "Biface / preform"), ("scraper", "Scraper"),
                                    ("celt|\\bax\\b|axe|adze|gouge", "Celt / axe"), ("knife|blade", "Knife / blade"), ("drill|perforator|graver", "Drill / perforator"),
                                    ("pestle|mano|metate|hammer|abrader", "Ground stone / hammerstone"), ("banner|gorget|plummet", "Ground stone ornament / weight"),
                                    ("flake|core|chopper|uniface", "Flake / core tool")] if re.search(rx, " " + text.lower())), "Stone tool")
        culture = (refs.get("Culture Note") or "").replace(" : ", ": ")
        return rec(id="ypm:" + catno.replace("YPM ANT ", "ant-").replace(" ", ""), category="artifact", name=t[:120], type=typ, material=material_of(name),
                   period=period_of(name), age="", culture=culture, region=region, institution="Yale Peabody Museum (Anthropology)", catalog_number=catno,
                   description=desc, source="Yale Peabody Museum via LUX", source_url="https://collections.peabody.yale.edu/search/Record/" + catno.replace(" ", "-"),
                   image_src=imgs[0] + "/full/!600,600/0/default.jpg", license="CC0", license_url=LIC_URL["CC0"], creator="Yale Peabody Museum",
                   attribution=f"Yale Peabody Museum, {catno}. CC0 (public domain dedication).")
    with cf.ThreadPoolExecutor(6) as ex: rows = [r for r in ex.map(one, sorted(seen)) if r]
    # diversity: at most 3 records with the same title per state
    cnt, out = {}, []
    for r in sorted(rows, key=lambda r: (not r["tx"], r["region"], r["id"])):
        k = (r["name"].lower()[:40], r["region"].split(", ")[-1]); cnt[k] = cnt.get(k, 0) + 1
        if cnt[k] <= 3: out.append(r)
    tx = [r for r in out if r["tx"]]; other = [r for r in out if not r["tx"]]
    # cap other states so Texas stays the focus
    per, keep = {}, []
    for r in other:
        s = r["region"].split(", ")[-1]; per[s] = per.get(s, 0) + 1
        if per[s] <= CAP_YPM_PER_STATE: keep.append(r)
    return tx + keep[:CAP_YPM_OTHER]

# ---------------------------------------------------------------- GBIF fossil specimens (media license checked per image)
INST = {"YPM": "Yale Peabody Museum", "USNM": "Smithsonian National Museum of Natural History", "PRI": "Paleontological Research Institution",
        "UCMP": "University of California Museum of Paleontology", "AMNH": "American Museum of Natural History", "MCZ": "Museum of Comparative Zoology, Harvard",
        "VMNH": "Virginia Museum of Natural History", "ALMNH": "Alabama Museum of Natural History", "UNM": "University of New Mexico", "UTEP": "University of Texas at El Paso",
        "UOMNH": "University of Oregon Museum of Natural and Cultural History", "KU": "University of Kansas Biodiversity Institute", "NHMUK": "Natural History Museum, London",
        "UF": "Florida Museum of Natural History", "FLMNH": "Florida Museum of Natural History", "UMNH": "Natural History Museum of Utah", "ANSP": "Academy of Natural Sciences of Drexel University",
        "TMM": "Texas Vertebrate Paleontology Collections (UT Austin)", "NPL": "Non-vertebrate Paleontology Lab (UT Austin)", "DMNH": "Denver Museum of Nature & Science", "OU": "Sam Noble Museum"}
GROUP = [("class", "Cephalopoda", "Cephalopod (ammonite / nautiloid)"), ("order", "Ammonitida", "Ammonite"), ("class", "Echinoidea", "Sea urchin (echinoid)"),
         ("class", "Bivalvia", "Bivalve (clam / oyster)"), ("class", "Gastropoda", "Snail (gastropod)"), ("phylum", "Brachiopoda", "Brachiopod"),
         ("class", "Anthozoa", "Coral"), ("class", "Crinoidea", "Crinoid (sea lily)"), ("class", "Blastoidea", "Blastoid"), ("class", "Trilobita", "Trilobite"),
         ("class", "Asteroidea", "Starfish (asteroid)"), ("class", "Ophiuroidea", "Brittle star"), ("class", "Elasmobranchii", "Shark / ray"), ("class", "Chondrichthyes", "Shark / ray"),
         ("class", "Mammalia", "Mammal"), ("class", "Aves", "Bird"), ("class", "Reptilia", "Reptile"), ("class", "Squamata", "Reptile"), ("class", "Amphibia", "Amphibian"),
         ("class", "Actinopterygii", "Bony fish"), ("phylum", "Bryozoa", "Bryozoan"), ("phylum", "Porifera", "Sponge"), ("phylum", "Arthropoda", "Arthropod"),
         ("phylum", "Chordata", "Vertebrate"), ("kingdom", "Plantae", "Plant fossil"), ("phylum", "Echinodermata", "Echinoderm"), ("phylum", "Mollusca", "Mollusk"), ("phylum", "Cnidaria", "Coral / cnidarian")]
def group_of(r):
    for rank, name, lab in GROUP:
        if (r.get(rank) or "") == name: return lab
    return "Fossil"
SKIP_INST = {"NHMUK"}  # 2026-11-11 review: its Texas media are mostly register-book pages and SEM scans, not specimen photos
def gbif():
    out = []; seen_taxa = {}
    plan = [("Texas", CAP_GBIF_TX)] + [(st, n * GBIF_STATE_MULT) for st, n in [("Oklahoma", 14), ("New Mexico", 12), ("Kansas", 10), ("Arkansas", 6), ("Louisiana", 6), ("Alabama", 6), ("Florida", 8),
            ("Utah", 8), ("Wyoming", 8), ("South Dakota", 6), ("Montana", 6), ("Ohio", 8), ("New York", 8), ("Indiana", 6), ("Kentucky", 6), ("Tennessee", 6),
            ("Iowa", 4), ("Illinois", 4), ("California", 6)]]
    def pages(state, want):
        """Yield result pages spread across each open-licensed institution's records for a state (not just the first page)."""
        for lic in (("CC0_1_0",) if A.add else ("CC0_1_0", "CC_BY_4_0")):  # weekly mode adds CC0 / public domain only
            f = get("https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode({"basisOfRecord": "FOSSIL_SPECIMEN", "country": "US", "stateProvince": state,
                    "mediaType": "StillImage", "license": lic, "limit": 0, "facet": "institutionCode", "facetLimit": 40}))
            for c in ((f or {}).get("facets") or [{}])[0].get("counts", []):
                if c["name"].upper() in ("FMNH", "NMMNHS", "UCM"): continue  # their media are CC BY-NC / BY-NC-SA
                total = c["count"]; step = max(300, (total // max(1, min(8, want // 10 + 1))) // 300 * 300)
                for off in range(0, min(total, 6000 if A.add else 15000), step):  # GBIF trickles on deep offsets
                    yield c["name"].upper(), (get("https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode({"basisOfRecord": "FOSSIL_SPECIMEN", "country": "US",
                          "stateProvince": state, "mediaType": "StillImage", "license": lic, "institutionCode": c["name"], "limit": 300, "offset": off})) or {}).get("results") or []
    for state, want in plan:
        n = 0; per_inst = {}
        for icode, res in pages(state, want):
            if n >= want: break
            for r in res:
                if n >= want: break
                if re.search(r"cast|replica|model|mold of", strip(r.get("preparations")), re.I): continue  # photos of casts are not the specimen
                if f"gbif:{r['key']}" in EXCLUDE or ("GBIF.org", strip(r.get("catalogNumber")).upper()) in EXCLUDE_PAIRS: continue
                if r.get("kingdom") in ("Chromista", "Protozoa", "Bacteria") or not r.get("scientificName") or r.get("taxonRank") in ("KINGDOM",): continue
                ic = (r.get("institutionCode") or "").upper(); inst = INST.get(ic) or strip(r.get("institutionCode"))
                if ic in SKIP_INST: continue
                if not inst or not r.get("catalogNumber"): continue
                med = next((m for m in r.get("media", []) if m.get("identifier") and lic_from_url(m.get("license")) and (m.get("format") or "image/jpeg").startswith(("image", "jpeg"))), None)
                if not med: continue  # media license missing or NC/ND -> skip (never fall back to the record's license)
                lic = lic_from_url(med["license"]); sci = strip(r.get("scientificName"))
                taxon = r.get("genus") or sci.split(" ")[0]
                if seen_taxa.get((taxon, state), 0) >= (CAP_GBIF_GENUS_TX if state == "Texas" else 2): continue
                if per_inst.get(ic, 0) >= max(3, want * (0.6 if state == "Texas" else 0.6)): continue
                seen_taxa[(taxon, state)] = seen_taxa.get((taxon, state), 0) + 1; per_inst[ic] = per_inst.get(ic, 0) + 1; n += 1
                period = strip(" / ".join(x for x in [r.get("earliestPeriodOrLowestSystem"), r.get("earliestEpochOrLowestSeries"), r.get("earliestAgeOrLowestStage")] if x))
                src = r.get("references") if str(r.get("references", "")).startswith("http") else f"https://www.gbif.org/occurrence/{r['key']}"
                creator = strip(med.get("creator") or med.get("rightsHolder") or inst)[:100]
                img = med["identifier"]; img = re.sub(r"/full/(full|![0-9,]+)/0/", "/full/!600,600/0/", img); img = re.sub(r"([?&]h=)\d+", r"\g<1>600", img)
                name = sci if r.get("taxonRank") in ("SPECIES", "SUBSPECIES", "GENUS", "VARIETY") else f"{group_of(r)} ({sci})"
                out.append(rec(id=f"gbif:{r['key']}", category="fossil", name=name[:120], type=group_of(r), material=(strip(r.get("preparations"))[:60].capitalize() if re.search(r"body fossil|petrified|permineral|mold|impression|carboniz|pyritiz|silicif|replacement|compression|amber", strip(r.get("preparations")), re.I) else "Fossil specimen"),
                    period=period, age="", formation=strip(r.get("formation"))[:80], region=region_us(state, r.get("county")), institution=inst,
                    catalog_number=strip(r.get("catalogNumber"))[:60], description="", source="GBIF.org", source_url=src, gbif_url=f"https://www.gbif.org/occurrence/{r['key']}",
                    image_src=img, license=lic, license_url=med.get("license") if lic != "CC0" else LIC_URL["CC0"], creator=creator,
                    attribution=f"Photo: {creator}{'' if inst.lower() in creator.lower() or creator.lower() in inst.lower() else ', ' + inst}. {lic}. Specimen {strip(r.get('catalogNumber'))}; record via GBIF.org."))
    return out

# ---------------------------------------------------------------- Smithsonian NMNH Mineral Sciences (CC0)
def si():
    out = []; seen = set()
    for q, want in [('unit_code:NMNHMINSCI AND media_usage:CC0 AND Texas', 60 if not A.add else 10**6), ('unit_code:NMNHMINSCI AND media_usage:CC0 AND "United States"', 120 if not A.add else 10**6)]:
        for start in range(0, SI_MAX_START, 100):
            d = get("https://api.si.edu/openaccess/api/v1.0/search?" + urllib.parse.urlencode({"q": q, "api_key": SI_KEY, "rows": 100, "start": start}))
            rows = ((d or {}).get("response") or {}).get("rows") or []
            if not rows: break
            for x in rows:
                if len([o for o in out if o["_q"] == q]) >= want: break
                c = x.get("content", {}); dn = c.get("descriptiveNonRepeating", {}); ft = c.get("freetext", {})
                media = [m for m in (dn.get("online_media") or {}).get("media", []) if (m.get("usage") or {}).get("access") == "CC0" and m.get("content")]
                if not media: continue
                sets = " ".join(z.get("content", "") for z in ft.get("setName", []))
                if re.search(r"thin section|micrograph|meteorite|reference standard", sets + " " + json.dumps(ft.get("physicalDescription", [])), re.I): continue  # slides / micrographs are not hand-specimen references
                place = "; ".join(p.get("content", "") for p in ft.get("place", []))
                st = ST_RE.search(place)
                if not st: continue
                cm = re.search(r"([A-Z][\w.' -]{1,30}?)\s+(?:Co\.|County|Parish)", place)
                region = region_us(st.group(1), cm.group(1).split(",")[-1].strip() if cm else None)
                title = strip(x.get("title"))
                if not title or title.lower() in seen and len(out) > 40: pass
                key = (title.lower(), region)
                if key in seen: continue
                seen.add(key)
                notes = " ".join(strip(n.get("content")) for n in ft.get("physicalDescription", []) if not re.search(r"modified|site number|specimen count", n.get("label", "") + n.get("content", ""), re.I))[:240]
                catno = next((strip(i.get("content")) for i in ft.get("identifier", []) if re.search(r"catalog|USNM", i.get("label", ""), re.I)), "")
                gem = bool(re.search(r"\bgem|cut stone|faceted|cabochon", title + " " + notes, re.I))
                out.append(rec(id="si:" + x["id"], category="mineral", name=title[:120], type="Gem" if gem else ("Rock" if re.search(r"\b(rock|stone|chert|flint|concretion|meteorite|agate|jasper|marble|granite|diorite|basalt|gabbro|sandstone|limestone|shale|slate|schist|gneiss|rhyolite|andesite|obsidian|pumice|tuff|quartzite|novaculite|dolostone|conglomerate|breccia|travertine|serpentinite|peridotite|syenite|pegmatite)\b", title, re.I) else "Mineral specimen"),
                    material=title[:60], period="", region=region, institution="Smithsonian National Museum of Natural History (Mineral Sciences)", catalog_number=catno,
                    description=notes, source="Smithsonian Open Access", source_url=dn.get("record_link") or dn.get("guid") or "https://collections.si.edu",
                    image_src=media[0]["content"] + "&max=600", license="CC0", license_url=LIC_URL["CC0"], creator="Smithsonian NMNH",
                    attribution=f"Smithsonian National Museum of Natural History{', ' + catno if catno else ''}. CC0.", _q=q))
            time.sleep(1.5)
    for o in out: o.pop("_q", None)
    return out

# ---------------------------------------------------------------- The Met (CC0 public-domain objects)
def met():
    ids = set()
    for t in ["bannerstone", "birdstone", "projectile point", "celt", "stone axe", "pestle", "knife", "flint", "chert", "obsidian", "gorget", "point"]:
        for off in range(0, 300, 100):
            d = get("https://collectionapi.metmuseum.org/public/collection/v1.1/search?" + urllib.parse.urlencode({"hasImages": "true", "departmentId": 5, "q": t, "limit": 100, "offset": off}))
            if not d or not d.get("objectIDs"): break
            ids |= set(d["objectIDs"])
            if off + 100 >= d.get("total", 0): break
    for t in ["arrowhead", "neolithic flint", "paleolithic"]:
        d = get("https://collectionapi.metmuseum.org/public/collection/v1.1/search?" + urllib.parse.urlencode({"hasImages": "true", "q": t, "limit": 100}))
        ids |= set((d or {}).get("objectIDs") or [])
    def one(i):
        o = get(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{i}")
        if not o or not o.get("isPublicDomain") or not o.get("primaryImageSmall"): return None
        med = o.get("medium") or ""; text = " ".join([o.get("title", ""), o.get("objectName", ""), med, o.get("culture", ""), o.get("period", "")])
        if not re.search(r"\b(stone|flint|chert|obsidian|jasper|quartzite|slate|basalt|granite|greenstone|diorite|hematite|steatite|chalcedony|agate|banded)\b", med, re.I): return None
        if not re.search(r"point|arrow|blade|knife|axe|celt|adze|pestle|mortar|banner|birdstone|gorget|scraper|biface|drill|implement|tool|hammer|maul|plummet|chisel|spear|mace", text, re.I): return None
        if SENSITIVE.search(text) or re.search(r"figure|figurine|sculpture|mask|vessel|bowl|pipe|ornament|pendant|bead", o.get("objectName", "") + " " + o.get("title", ""), re.I): return None
        us = o.get("country") == "United States" or re.search(r"United States|North America|Native American|Mississippi|Ohio|Hopewell|Adena", text)
        reg = ", ".join(x for x in [o.get("state") if o.get("state") in US_STATES else "", "United States" if us and o.get("state") not in US_STATES else ""] if x) or ", ".join(x for x in [o.get("country")] if x) or strip(o.get("culture"))[:60]
        return rec(id=f"met:{i}", category="artifact", name=strip(o.get("title"))[:120], type=strip(o.get("objectName")) or "Stone object", material=strip(med)[:80],
                   period=strip(o.get("period")) or period_of(text), age=strip(o.get("objectDate"))[:60], culture=strip(o.get("culture"))[:80], region=reg,
                   institution="The Metropolitan Museum of Art", catalog_number=strip(o.get("accessionNumber")), source="The Met Open Access", source_url=o.get("objectURL"),
                   image_src=o["primaryImageSmall"], license="CC0", license_url=LIC_URL["CC0"], creator="The Metropolitan Museum of Art",
                   attribution=f"The Metropolitan Museum of Art, {strip(o.get('creditLine'))[:90]}, {strip(o.get('accessionNumber'))}. CC0 (Open Access).")
    with cf.ThreadPoolExecutor(6) as ex: rows = [r for r in ex.map(one, sorted(ids)) if r]
    cnt, keep = {}, []
    for r in sorted(rows, key=lambda r: (not r["us"], r["id"])):
        k = r["name"].lower(); cnt[k] = cnt.get(k, 0) + 1
        if cnt[k] <= 4: keep.append(r)
    return keep[:120]

# ---------------------------------------------------------------- Cleveland Museum of Art (CC0)
def cma():
    out = []
    for q in ["stone", "flint", "obsidian", "chert"]:
        d = get("https://openaccess-api.clevelandart.org/api/artworks/?" + urllib.parse.urlencode({"q": q, "cc0": 1, "has_image": 1, "limit": 1000, "department": "Art of the Americas"}))
        for r in (d or {}).get("data", []):
            t = (r.get("title") or "") + " " + (r.get("technique") or "")
            if r.get("share_license_status") != "CC0" or not re.search(r"\b(axe|celt|pestle|mortar|point|blade|knife|scraper)\b", r.get("title", ""), re.I) or re.search(r"figure|deity|feline|shaped", r.get("title", ""), re.I): continue
            if any(o["id"] == f"cma:{r['id']}" for o in out): continue
            img = ((r.get("images") or {}).get("web") or {}).get("url")
            if not img: continue
            cult = (r.get("culture") or [""])[0]
            out.append(rec(id=f"cma:{r['id']}", category="artifact", name=strip(r.get("title")), type=strip(r.get("type")), material=strip(r.get("technique"))[:80] or material_of(t),
                period=period_of(cult), age=strip(r.get("creation_date")), culture=cult, region=cult.split(",")[0] if cult else "", institution="Cleveland Museum of Art",
                catalog_number=strip(r.get("accession_number")), source="Cleveland Museum of Art Open Access", source_url=r.get("url"), image_src=img, license="CC0",
                license_url=LIC_URL["CC0"], creator="Cleveland Museum of Art", attribution=f"Cleveland Museum of Art, {strip(r.get('creditline'))}, {strip(r.get('accession_number'))}. CC0."))
    return out

# ---------------------------------------------------------------- Wikimedia Commons: museum-held lithics only
WMC_CATS = ["Stone projectile points", "Flint projectile points", "Neolithic arrowheads", "Mousterian points", "Stone arrowheads", "Obsidian arrowheads",
            "Pre-Columbian North American projectile points", "Aurignacian projectile points", "Upper Paleolithic projectile points", "Neolithic projectile points",
            "Arrowheads from the United States", "Clovis points", "Folsom points", "Paleo-Indian artifacts in the Wisconsin Historical Museum", "Projectile points in the Robbins Museum",
            "Hand axes", "Acheulean handaxes", "Flint daggers", "Neolithic axes", "Polished stone axes"]
HOLDER = re.compile(r"((?:[A-Z][\w'’.-]+\s){0,5}(?:Museum|Muséum|Musée|Museo|Museu|Museo|Smithsonian|National Park Service|Bureau of Land Management|Historical Society|Institution)(?:\s(?:of|de|du|des|for|the|and|d’|di|der|für)?\s?(?:[A-Z][\w'’.-]+\s?){0,4})?)")
def wmc():
    out = []
    for cat in WMC_CATS:
        d = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"format": "json", "action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + cat,
                "gcmtype": "file", "gcmlimit": 200, "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 640,
                "iiextmetadatafilter": "LicenseShortName|Artist|LicenseUrl|Credit|ImageDescription|DateTimeOriginal"}))
        n = 0
        for p in sorted(((d or {}).get("query") or {}).get("pages", {}).values(), key=lambda p: p["title"]):
            ii = (p.get("imageinfo") or [{}])[0]; m = ii.get("extmetadata", {}); g = lambda k: strip((m.get(k) or {}).get("value"))
            lic = g("LicenseShortName")
            if ii.get("mime") not in ("image/jpeg", "image/png") or not re.match(r"^(public domain|cc0|cc by(-sa)? [0-9.]+)$", lic, re.I): continue
            artist = g("Artist")[:100]
            desc = g("ImageDescription"); blob = p["title"] + " " + desc + " " + g("Credit")
            h = HOLDER.search(blob)
            if not h or not artist or SENSITIVE.search(blob) or re.search(r"replica|reproduction|modern|knapped by|experimental|souvenir|for sale|shop", blob, re.I): continue
            holder = re.sub(r"^.*\.\s+", "", h.group(1)).strip(" ,.-")
            if re.search(r"\.(jpe?g|png)|\b(bone|antler|bronze|iron|copper)\b", holder + " " + blob, re.I) or holder.endswith(("Vor", "Own")) or re.search(r"\bMHNT\b", holder): holder = re.sub(r"\s*MHNT.*$", "", holder)
            if re.search(r"\.(jpe?g|png)|\b(bone|antler|bronze|iron|copper)\b", holder + " " + blob, re.I) or re.search(r"(Vor|Own|of|de|du|the)$", holder): continue
            if len(holder) < 8 or holder.lower() in ("museum", "the museum"): continue
            title = re.sub(r"\.(jpe?g|png)$", "", p["title"][5:], flags=re.I).replace("_", " ")
            lic_n = "Public domain" if lic.lower() == "public domain" else lic.replace("Cc", "CC")
            n += 1
            if n > 12: break
            us = bool(re.search(r"United States|North America|Texas|Wisconsin|Ohio|Clovis|Folsom", blob + cat))
            st = ST_RE.search(desc)
            out.append(rec(id=f"wmc:{p['pageid']}", category="artifact", name=(desc[:110] if 15 < len(desc) < 110 else title[:110]), type="Projectile point" if re.search(r"point|arrow", cat, re.I) else "Stone tool",
                material=material_of(blob, "Stone"), period=period_of(blob + " " + cat), region=(st.group(1) if st else ("United States" if us else "")),
                institution=holder[:80], catalog_number="", description=desc[:300], source="Wikimedia Commons", source_url=ii.get("descriptionurl"), image_src=ii.get("thumburl"),
                license=lic_n, license_url=g("LicenseUrl") or LIC_URL.get(lic_n, ""), creator=artist, attribution=f"Photo: {artist} / {lic_n} / Wikimedia Commons. Object held by {holder[:80]}."))
    return out

# ---------------------------------------------------------------- existing institutional rows in reference_media (reused, same ids)
def ref():
    d = json.load(open(ROOT / "data/reference/reference-media.json"))
    out = []
    for i in d["items"]:
        if not i["id"].startswith(("si:", "met:")) or not i.get("thumb_url"): continue
        place = (i.get("data") or {}).get("place", ""); st = ST_RE.search(place)
        cm = re.search(r"([A-Z][\w.' -]{1,30}?)\s+(?:Co\.|County)", place)
        region = region_us(st.group(1), cm.group(1).split(",")[-1].strip() if cm else None) if st else (place.split(",")[-2].strip() if place.count(",") >= 1 else place) or ("Texas" if "texas" in (i.get("data") or {}).get("topics", []) else "")
        if "not Texas" in place: region = "Eastern United States"
        inst = "The Metropolitan Museum of Art" if i["id"].startswith("met:") else "Smithsonian National Museum of Natural History"
        nm = re.sub(r"\s*\((Archaic)[^)]*\)", "", i["title"]); age = (re.search(r"\(([^)]*)\)", i["title"]) or [None, ""])[1]
        if i["kind"] == "fossil": typ = "Fossil"
        elif i["kind"] == "mineral": typ = "Rock" if re.search(r"chert|concretion", nm, re.I) else "Mineral specimen"
        else: typ = "Ground stone"
        nm = ", ".join(dict.fromkeys(x.strip() for x in nm.split(",")))
        out.append(rec(id=i["id"], category=i["kind"], name=nm, type=typ, material="Stone" if i["kind"] == "artifact" else ("Fossil specimen" if i["kind"] == "fossil" else nm),
            period=period_of(i["title"]), age=age, region=region, institution=inst, source=i["source"], source_url=i["source_url"],
            image_src=i.get("image_url") + ("&max=600" if "ids.si.edu" in i.get("image_url", "") else "") if i.get("image_url") else i["thumb_url"], license=i["license"], license_url=i.get("license_url") or LIC_URL["CC0"],
            creator=inst, attribution=i["attribution"], reused=True))
    return out

SOURCES = {"ref": ref, "ypm": ypm, "gbif": gbif, "si": si, "met": met, "cma": cma, "wmc": wmc}
def thumb_bytes(r):
    """Download the source image and re-encode it as a <=480 px WebP. Re-encoding drops all EXIF/GPS metadata."""
    b = get(r["image_src"], raw=True)
    if not b: return None
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(b)); im = ImageOps.exif_transpose(im).convert("RGB"); im.thumbnail((480, 480))
        if min(im.size) < 120: return None
        buf = io.BytesIO(); im.save(buf, "WEBP", quality=74, method=5)  # no exif= argument: all metadata (incl. GPS) is dropped
        return buf.getvalue()
    except Exception: return None
def slug(rid): return re.sub(r"[^a-z0-9]+", "-", rid.lower()).strip("-")
def thumb(r):  # legacy JSON/repo mode only
    f = IMG / (slug(r["id"]) + ".webp")
    if f.exists() and f.stat().st_size > 1500: return f
    b = thumb_bytes(r)
    if not b: return None
    f.write_bytes(b); return f
CAT_FIELDS = ["name", "source_title", "type", "material", "period", "age", "formation", "culture", "region", "institution", "catalog_number", "creator", "description", "tx", "us", "gbif_url"]
def db_row(r, thumb_url):
    cat = {k: r.get(k) for k in CAT_FIELDS if r.get(k) not in (None, "")}
    topics = [r["category"]] + (["texas"] if r.get("tx") else [])
    return {"id": r["id"], "source": r["source"], "kind": r["category"], "title": r["name"], "keywords": r.get("keywords") or keywords_of(r), "category": "public-catalog",
            "thumb_url": thumb_url, "image_url": r.get("image_src"), "source_url": r["source_url"], "license": r["license"], "license_url": r.get("license_url"),
            "attribution": r["attribution"], "topics": topics, "data": {"pc": "1", "public": "1", "catalog": cat, "topics": topics}}
OK_LIC = re.compile(r"^(CC0|Public domain)$")  # database/weekly mode: CC0 / public domain only, as Mark asked
def to_db(records, fetch_thumbs):
    import pc_db
    pc_db.ensure_bucket(); existing = {x["id"]: x for x in pc_db.all_rows("id,source,data")}
    new, reused, failed = [], 0, 0
    def one(r):
        if not OK_LIC.match(r["license"]): return None
        if r["id"] in existing and not (existing[r["id"]].get("data") or {}).get("pc"):  # a pre-existing row (019/025): add catalog fields only, keep title/keywords/credits
            d = dict(existing[r["id"]].get("data") or {}); d.update({"public": "1", "catalog": {k: r.get(k) for k in CAT_FIELDS if r.get(k) not in (None, "")}})
            pc_db.patch_data(r["id"], d); return "reused"
        b = (ROOT / r["thumb"]).read_bytes() if (not fetch_thumbs and r.get("thumb") and (ROOT / r["thumb"]).exists()) else thumb_bytes(r)
        if not b: return None
        return db_row(r, pc_db.upload(f"{r['category']}/{slug(r['id'])}.webp", b))
    with cf.ThreadPoolExecutor(6) as ex: res = list(ex.map(one, records))
    for x in res:
        if x == "reused": reused += 1
        elif x: new.append(x)
        else: failed += 1
    pc_db.upsert(new)
    return new, reused, failed
def add_mode(n):
    """Weekly: the next n records that are not in reference_media yet (dedupe by id and by source + catalog number), mixed across categories."""
    import pc_db
    ids, pairs = pc_db.seen_keys(); EXCLUDE.update(ids); EXCLUDE_PAIRS.update(pairs)
    quota = {"fossil": round(n * .4), "artifact": round(n * .4)}; quota["mineral"] = n - quota["fossil"] - quota["artifact"]
    pools = {"artifact": [], "fossil": [], "mineral": []}
    for s in ["gbif", "ypm", "si", "met", "cma"]:
        t0 = time.time()
        try: got = [r for r in SOURCES[s]() if is_new(r) and OK_LIC.match(r["license"])]
        except Exception as e: print(f"{s}: skipped ({str(e)[:80]})", file=sys.stderr); continue
        print(f"{s}: {len(got)} new candidates ({time.time() - t0:.0f}s)", file=sys.stderr)
        for r in got: pools[r["category"]].append(r)
    for k in pools:  # Texas first, then US; spread across names so one week isn't 40 copies of the same taxon
        pools[k].sort(key=lambda r: (not r["tx"], not r["us"], r["id"])); seen_n = {}
        for r in pools[k]: r["_rank"] = seen_n[r["name"].lower()] = seen_n.get(r["name"].lower(), -1) + 1
        pools[k].sort(key=lambda r: (r["_rank"] > 0, not r["tx"], r["_rank"], not r["us"], r["id"]))
    pick, seen = [], set()
    for k, q in quota.items(): pick += pools[k][:q]
    spare = [r for k in pools for r in pools[k][quota[k]:]]; spare.sort(key=lambda r: (not r["tx"], r["id"]))
    pick += spare[: max(0, n - len(pick))]
    pick = [r for r in pick if not (r["id"] in seen or seen.add(r["id"]))][:n]
    for r in pick: r.pop("_rank", None)
    if A.dry_run:
        by = ", ".join(c + " " + str(sum(r["category"] == c for r in pick)) for c in pools)
        print(f"reference add (dry run): would add {len(pick)} ({by}); new available: " + ", ".join(f"{k} {len(v)}" for k, v in pools.items())); return
    new, reused, failed = to_db(pick, True)
    total = len(pc_db.all_rows("id"))
    print(f"{time.strftime('%Y-%m-%d %H:%M %Z')} reference add: requested {n}, added {len(new)} (" + ", ".join(f"{c} {sum(x['kind'] == c for x in new)}" for c in ("artifact", "fossil", "mineral")) +
          f"), skipped {failed} (no usable image), reference_media now {total} rows")
def main():
    if A.add: return add_mode(A.add)
    if A.to_db:
        items = json.load(open(OUT))["items"]
        new, reused, failed = to_db([dict(r, keywords=r.get("keywords") or keywords_of(r)) for r in items], False)
        print(f"reference load: {len(new)} rows upserted, {reused} existing rows flagged public, {failed} skipped"); return
    only = [s for s in A.only.split(",") if s] or list(SOURCES)
    old = {r["id"]: r for r in (json.load(open(OUT))["items"] if OUT.exists() else [])}
    rows = []
    for s in only:
        got = SOURCES[s](); print(f"{s}: {len(got)} candidates", file=sys.stderr); rows += [dict(r, src_key=s) for r in got]
    keep = {k: v for k, v in old.items() if v.get("src_key") not in only}
    IMG.mkdir(parents=True, exist_ok=True)
    def fin(r):
        if A.no_images: return r
        f = thumb(r)
        if not f: return None
        r["thumb"] = str(f.relative_to(ROOT)); return r
    with cf.ThreadPoolExecutor(6) as ex: done = [r for r in ex.map(fin, rows) if r]
    for r in done: keep[r["id"]] = r
    items = sorted(keep.values(), key=lambda r: ({"artifact": 0, "fossil": 1, "mineral": 2}[r["category"]], not r["tx"], not r["us"], r["name"].lower()))
    for r in items: r.pop("image_src", None) if False else None
    counts = {}
    for r in items: counts.setdefault(r["source"], {}).setdefault(r["license"], 0); counts[r["source"]][r["license"]] += 1
    OUT.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d"), "note": "Free public Reference Catalog. Institution-held objects with open images only. Locations are county/state level at most. Not identifications of user finds.",
                               "counts": counts, "items": items}, ensure_ascii=False, indent=0))
    used = {pathlib.Path(r["thumb"]).name for r in items if r.get("thumb")}
    for f in IMG.glob("*.webp"):
        if f.name not in used: f.unlink()
    print(json.dumps({"total": len(items), "by_category": {c: sum(r["category"] == c for r in items) for c in ("artifact", "fossil", "mineral")}, "counts": counts}, indent=1))
if __name__ == "__main__": main()
