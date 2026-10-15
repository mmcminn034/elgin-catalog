"""Build data/reference/public-types.json (+ supabase seed SQL) from locally cached source pages.
Sources are fetched separately by crawl_ppn.py / crawl_pidba.py / wikidata.py at ~1 request/second (robots.txt checked).
Only short factual attributes are stored (names, aliases, dates, ranges in mm, states, trait keywords derived from a fixed
vocabulary, similar types) plus source name/URL/date/license. No paragraphs and no images are copied."""
import urllib.parse
import re, json, html, glob, os, statistics, datetime, sys
CACHE = os.environ.get("REF_CACHE", "/tmp/refscrape"); OUT = sys.argv[1] if len(sys.argv) > 1 else "data/reference/public-types.json"
TODAY = os.environ.get("REF_DATE", datetime.date.today().isoformat())
TRAITS = [("corner-notched", r"corner[- ]notch"), ("side-notched", r"side[- ]notch"), ("basal-notched", r"basal[- ]notch"), ("bifurcate base", r"bifurcat"),
  ("stemmed", r"\bstem"), ("expanding stem", r"expanding stem|stem (?:is |may be )?(?:\w+ )?expand"), ("contracting stem", r"contracting stem|stem (?:is |may be )?(?:\w+ )?contract"), ("straight stem", r"straight stem|stem is (?:commonly )?straight"),
  ("lanceolate", r"lanceolate"), ("triangular", r"triangular"), ("leaf-shaped", r"leaf[- ]shaped|ovate|ovoid"), ("auriculate / eared", r"auricul|eared|\bears\b"),
  ("fluted", r"\bflut"), ("beveled", r"bevel"), ("serrated", r"serrat"), ("barbed", r"\bbarb"), ("shouldered", r"shoulder"), ("weak shoulders", r"weak(?:ly)? shoulder|slight shoulder"),
  ("concave base", r"concave base|base is concave|basal concav"), ("convex base", r"convex base|base is convex"), ("straight base", r"straight base|base is straight"),
  ("ground base/stem", r"\bground\b|grind"), ("thinned base", r"basal thinning|thinned base|base thinn"), ("collateral flaking", r"collateral"), ("parallel flaking", r"parallel (?:oblique )?flak|parallel-oblique|transverse parallel"),
  ("random flaking", r"random flak"), ("pressure flaked", r"pressure flak"), ("needle tip", r"needle"), ("recurved blade", r"recurv"), ("excurvate blade", r"excurvat|convex blade|blade edges? (?:are )?convex"),
  ("incurvate blade", r"incurvat|concave blade"), ("thin cross-section", r"\bthin\b"), ("thick cross-section", r"\bthick\b"), ("lenticular cross-section", r"lenticular|biconvex"), ("unnotched", r"unnotched|no notch"),
  ("small (arrow point)", r"arrow ?point|arrowpoint"), ("dart point", r"\bdart"), ("knife", r"\bknife"), ("drill", r"\bdrill"), ("asymmetric", r"asymmetr"), ("diamond-shaped", r"diamond")]
PERIODS = ["Paleoindian", "Early Archaic", "Middle Archaic", "Late Archaic", "Transitional Archaic", "Late Prehistoric", "Early Woodland", "Middle Woodland", "Late Woodland", "Woodland", "Mississippian", "Historic", "Archaic"]
CA = {"Alberta","Saskatchewan","Manitoba","Ontario","Quebec","New Brunswick","Nova Scotia","New Foundland","British Columbia","Yukon","NW Territory","Nunavut"}
MX = {"Baja","Sonora","Coahuila","Chihuahua","Nuevo Leon","Tamaulipas","Durango","Zacatecas","San Luis Potosi","Sinaloa"}
FIX = {"NorthDakota": "North Dakota", "WestVirginia": "West Virginia", "SouthCarolina": "South Carolina", "NorthCarolina": "North Carolina", "NewJersey": "New Jersey", "RhodeIsland": "Rhode Island",
       "NewYork": "New York", "NewHampshire": "New Hampshire", "New_Mexico": "New Mexico", "South_Dakota": "South Dakota", "New Foundland": "Newfoundland", "NW Territory": "Northwest Territories", "Baja": "Baja California"}
def text(s): s = re.sub(r"(?s)<style.*?</style>|<script.*?</script>", " ", s); return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).replace("\xa0", " ")
def between(t, a, b): m = re.search(re.escape(a) + r"(.*?)(?:" + b + ")", t); return m.group(1).strip() if m else ""
def rng(t, label):
    m = re.search(label + r"[^0-9]{0,25}(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*(mm|cm|inch|in\b|\")?", t, re.I)
    if not m: return None
    a, b, u = float(m.group(1)), float(m.group(2)), (m.group(3) or "mm").lower(); f = 10 if u == "cm" else 25.4 if u.startswith("in") or u == '"' else 1
    a, b = round(a * f), round(b * f); return [a, b] if 0 < a <= b <= 600 else None
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
def ppn():
    smap = json.load(open(f"{CACHE}/ppn_statemap.json")); out = []
    for page, states in smap.items():
        fn = f"{CACHE}/ppn/Points_" + re.sub(r"[^A-Za-z0-9_.-]", "_", page)
        if not os.path.exists(fn) or os.path.getsize(fn) < 500: continue
        raw = open(fn, encoding="utf-8", errors="replace").read(); t = re.sub(r"\s+", " ", text(raw).replace("Â", " ")); tt = re.findall(r"(?is)<title>(.*?)</title>", raw)
        name = re.sub(r"\s+(Projectile )?Point.*$", "", html.unescape(tt[0]).replace("Â", " ").strip())[:60] if tt else page.rsplit(".", 1)[0].replace("_", " ")
        if not name or len(name) < 2: continue
        aka = between(t, "AKA:", r"Cluster:|Commonly Utilized|Date:"); aka = [a.strip(" .") for a in re.split(r",|;|/| or ", re.sub(r"\(.*?\)", "", aka)) if 2 < len(a.strip()) < 40][:6]
        dates = between(t, "Date :", r"Glacial Period|Culture") + " " + between(t, "Cultural Period :", r"Glacial Period|Culture") + " " + between(t, "Cultural Period:", r"Glacial Period|Culture:|Outline") + " " + between(t, "Date:", r"Glacial Period|Culture:")
        bp = re.search(r"(\d[\d,]{2,})\s*-\s*(\d[\d,]{2,})\s*(B\.?P|BP|B\.C|A\.D|Y\.?B\.?P)", dates)
        period = [p for p in PERIODS if p.lower() in dates.lower()]
        period = [p for p in period if not any(p != q and p in q for q in period)][:2]
        stem = page.rsplit(".", 1)[0].replace("_", " ").strip(); aka = list(dict.fromkeys(([stem] if stem.lower() != name.lower() and len(stem) > 2 else []) + aka))
        desc = between(t, "Flaking Pattern:", r"Size Measurements:|Distribution:|Commonly Utilized"); size = between(t, "Size Measurements:", r"Distribution:|Similar Points:|Commonly Utilized|Additional Comments")
        traits = [k for k, rx in TRAITS if re.search(rx, desc, re.I)]
        if re.search(r"\bunnotched|no notch", desc, re.I): traits = [x for x in traits if "notched" not in x or x == "unnotched"]
        sim = between(t, "Similar Points:", r"Other points|Related / Associated|Additional Comments|Pictures:"); sim = [x.strip(" .") for x in sim.split(",") if 1 < len(x.strip()) < 40][:10]
        valid = between(t, "Point Validity:", r"\. |Kelley|This type") [:40]
        st = sorted({FIX.get(s, s) for s in states}); us = [s for s in st if s not in {FIX.get(x, x) for x in CA | MX}]
        ca = [s for s in st if s in {FIX.get(x, x) for x in CA}]; mx = [s for s in st if s in {FIX.get(x, x) for x in MX}]
        e = {"id": "ppn-" + slug(urllib.parse.unquote(page.rsplit(".", 1)[0])), "name": name, "aliases": aka, "typology_system": "North American projectile point", "category": "artifact",
             "period": " / ".join(period), "dates": (f"{bp.group(1)}-{bp.group(2)} {bp.group(3).replace('.', '').replace('YBP', 'BP')}" + (" (as published; looks like a typo at the source)" if not re.fullmatch(r"\d{1,3}(,\d{3})*", bp.group(1)) or not re.fullmatch(r"\d{1,3}(,\d{3})*", bp.group(2)) else "") if bp else ""),
             "continent": "North America", "country": (["US"] if us else []) + (["CA"] if ca else []) + (["MX"] if mx else []), "admin1": st,
             "region_notes": f"Listed for {len(st)} state/province search page{'s' if len(st) != 1 else ''} on projectilepoints.net" + (" (Texas listing)" if "Texas" in st else ""),
             "length_mm": rng(size, r"(?:Total )?Length"), "width_mm": rng(size, r"(?<!Stem )Width"), "thickness_mm": rng(size, r"Thickness"),
             "traits": traits, "similar": sim, "validity": valid,
             "sources": [{"name": "projectilepoints.net", "url": "https://www.projectilepoints.net/Points/" + page, "retrieved": TODAY,
                          "license": "Facts only (names, dates, size ranges, states, similar types; traits are our keyword tags). Site content and photos © their contributors; no text or images copied. Link to the source page."}]}
        out.append(e)
    return out
def pidba(entries):
    import xlrd, openpyxl
    idx = [l.split("\t") for l in open(f"{CACHE}/pidba/xls_index.tsv").read().splitlines() if l]; stats = {}
    for url, page in idx:
        fn = f"{CACHE}/pidba/" + re.sub(r"[^A-Za-z0-9_.-]", "_", url.split("//")[1])
        if not os.path.exists(fn) or os.path.getsize(fn) < 1000: continue
        try:
            if fn.endswith("xlsx"): ws = openpyxl.load_workbook(fn, read_only=True, data_only=True).worksheets[0]; rows = [[c for c in r] for r in ws.iter_rows(values_only=True)]
            else: sh = xlrd.open_workbook(fn).sheet_by_index(0); rows = [sh.row_values(i) for i in range(sh.nrows)]
        except Exception as ex: print("skip", fn, ex); continue
        hi = next((i for i, r in enumerate(rows[:15]) if any(re.search(r"type|length", str(c), re.I) for c in r)), None)
        if hi is None: continue
        H = [str(c).strip().lower() for c in rows[hi]]
        col = lambda *ks: next((i for i, h in enumerate(H) if any(re.fullmatch(k, h) or re.search(k, h) for k in ks)), None)
        ct, cl, cw, cth = col(r"^(point )?type$", r"type", r"classification"), col(r"^(max(imum)? )?length", r"length"), col(r"^(max(imum)? )?width", r"width"), col(r"thick")
        if ct is None or cl is None: continue
        state = {"newmexico": "New Mexico", "southcarolina": "South Carolina", "centralamerica": "Central America", "southamerica": "South America"}.get(re.sub(r"\.htm$", "", page), re.sub(r"\.htm$", "", page).title())
        for r in rows[hi + 1:]:
            try: ty = str(r[ct]).strip()
            except Exception: continue
            if not ty or len(ty) > 40 or ty.lower() in ("unknown", "none", "n/a", "?"): continue
            ty = re.sub(r"\s+(point|fluted|preform|base|fragment).*$", "", ty, flags=re.I).strip().title()
            s = stats.setdefault(ty, {"L": [], "W": [], "T": [], "files": set(), "states": set()}); s["files"].add(url); s["states"].add(state)
            for k, c in (("L", cl), ("W", cw), ("T", cth)):
                if c is None: continue
                try: v = float(r[c])
                except Exception: continue
                if 3 < v < 400: s[k].append(v)
    by = {}
    for e in entries:
        for n in [e["name"]] + e.get("aliases", []): by.setdefault(n.lower(), e)
    added = merged = 0
    JUNK = re.compile(r"^(fluted|unfluted|preform|unknown.*|edwards|alibates|biface|other|misc.*|fragment)$", re.I)
    def q(v):
        if len(v) < 5: return None
        v = sorted(v); lo, hi = v[int(.05 * (len(v) - 1))], v[int(.95 * (len(v) - 1))]; return [round(lo), round(hi)]
    for ty, s in stats.items():
        n = len(s["L"]);
        if n < 5 or not re.match(r"^[A-Za-z][A-Za-z .'/-]{2,}$", ty) or JUNK.match(ty): continue
        src = {"name": "PIDBA (Paleoindian Database of the Americas)", "url": sorted(s["files"])[0], "retrieved": TODAY, "license": "CC BY 4.0, Anderson et al., PIDBA (pidba.utk.edu). Summary statistics computed from the published tables.", "n": n}
        meas = {"length_mm": q(s["L"]), "width_mm": q(s["W"]), "thickness_mm": q(s["T"]), "measured_n": n}
        e = by.get(ty.lower())
        if e: e.setdefault("pidba", meas); e["sources"].append(src); merged += 1
        else:
            entries.append({"id": "pidba-" + slug(ty), "name": ty, "aliases": [], "typology_system": "North American projectile point", "category": "artifact", "period": "Paleoindian", "dates": "",
                            "continent": "North America", "country": ["US"], "admin1": sorted(s["states"]), "region_notes": "PIDBA measured specimens from " + ", ".join(sorted(s["states"])),
                            "length_mm": meas["length_mm"], "width_mm": meas["width_mm"], "thickness_mm": meas["thickness_mm"], "traits": [], "similar": [], "pidba": meas, "sources": [src]}); added += 1
    print("PIDBA types with >=5 measured:", sum(1 for s in stats.values() if len(s["L"]) >= 5), "merged", merged, "added", added)
def world(entries):
    p = f"{CACHE}/world_curated.json"; wd = f"{CACHE}/wd_raw.json"; n0 = len(entries)
    if os.path.exists(p): entries += json.load(open(p))
    if os.path.exists(wd):
        seen = {e["name"].lower() for e in entries}; by = {}
        for r in json.load(open(wd)):
            if r["cls"]["value"] == "point" or "article" not in r: continue
            lab = r["xLabel"]["value"]
            if re.search(r"\(\d|\d{3}\.", lab) or lab.lower() in seen or lab.startswith("Q"): continue
            e = by.setdefault(r["x"]["value"], {"id": "wd-" + r["x"]["value"].rsplit("/", 1)[1], "name": lab, "aliases": [], "typology_system": "Archaeological culture / lithic industry", "category": "artifact",
                 "period": "Stone Age" if r["cls"]["value"] == "culture" else "Lithic industry", "dates": "", "continent": "", "country": [], "admin1": [], "region_notes": (r.get("xDescription", {}).get("value", "") or "")[:140],
                 "length_mm": None, "width_mm": None, "thickness_mm": None, "traits": [k for k, rx in TRAITS if re.search(rx, r.get("xDescription", {}).get("value", ""), re.I)], "similar": [],
                 "sources": [{"name": "Wikidata", "url": r["x"]["value"], "retrieved": TODAY, "license": "CC0 (Wikidata). Descriptions are Wikidata's short CC0 labels."}, {"name": "Wikipedia", "url": r["article"]["value"], "retrieved": TODAY, "license": "Link only (Wikipedia text is CC BY-SA 4.0; not copied)."}]})
            if r.get("contLabel"): e["continent"] = e["continent"] or r["contLabel"]["value"]
            if r.get("countryLabel") and r["countryLabel"]["value"] not in e["country"]: e["country"].append(r["countryLabel"]["value"])
            for k, lab2 in (("start", "from"), ("end", "to")):
                if r.get(k) and lab2 not in e["dates"]: y = int(r[k]["value"][:5].rstrip("-")) if r[k]["value"][0] == "-" else int(r[k]["value"][:4]); e["dates"] = (e["dates"] + f" {lab2} {abs(y)} {'BCE' if y < 0 else 'CE'}").strip()
        entries += list(by.values())
    print("world entries", len(entries) - n0)
if __name__ == "__main__":
    E = ppn(); print("ppn", len(E)); pidba(E); world(E)
    for e in E: e["texas"] = "Texas" in e.get("admin1", []); e["home_priority"] = 1 if e["texas"] else 2 if e.get("continent") == "North America" else 3
    E.sort(key=lambda e: (e["home_priority"], e["name"].lower()))
    meta = {"trait_patterns": {k: rx for k, rx in TRAITS}, "format": "rolling-oak-public-types/v1", "built": TODAY, "count": len(E), "note": "Published typology summaries for research comparison. Facts and keyword tags only, with attribution and a license note per source. Not identifications.",
            "sources": ["projectilepoints.net (state/province listings + type pages)", "PIDBA (CC BY 4.0) measurement tables", "Wikidata (CC0) archaeological cultures and lithic industries", "Curated worldwide industries (own summaries, Wikipedia links)"]}
    json.dump({"meta": meta, "types": E}, open(OUT, "w"), ensure_ascii=False, separators=(",", ":")); print("wrote", OUT, len(E))
