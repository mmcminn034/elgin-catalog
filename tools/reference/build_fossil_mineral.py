"""Build data/reference/public-fossils.json and public-minerals.json (fossil and rocks & minerals reference layers).
Inputs (fetched into /workspace/ref-fossil-mineral/raw by the commands in docs/reference-fossil-mineral.md):
  pbdb_tx.json      PBDB occs/taxa (state=Texas, rank=genus, show=app,class)   CC BY 4.0
  pbdb_world.json   PBDB taxa/list for a curated worldwide genus list           CC BY 4.0
  macrostrat_fm.json Macrostrat defs/strat_names for key formations             CC BY 4.0
  wd_minerals.json  Wikidata SPARQL: minerals with Mohs hardness (+system, color, streak, formula)  CC0
Curated group/rock entries live in curated_fossil_mineral.py (own words; each cites its sources).
Usage: python3 tools/reference/build_fossil_mineral.py [raw_dir]"""
import json, re, sys, pathlib, datetime
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import curated_fossil_mineral as C
RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/ref-fossil-mineral/raw"); ROOT = pathlib.Path(__file__).resolve().parents[2]
TODAY = datetime.date.today().isoformat()
# layer entries that extend an existing hand-curated rules entry (data/reference/fossils.json / rocks.json) instead of duplicating it
MERGE = {"rk-petrified-wood": "petrified-wood-rock", "rk-natural-pebble": "natural-pebble", "rk-concretion": "concretion", "rk-chert": "chert", "rk-chalcedony": "chalcedony", "rk-quartzite": "quartzite",
         "rk-quartz": "quartz", "rk-limestone": "limestone", "rk-calcite": "calcite", "rk-gypsum": "gypsum", "rk-ironstone": "ironstone", "rk-pyrite": "pyrite",
         "fg-oyster-exogyra": "exogyra", "fg-oyster-gryphaea": "gryphaea", "fg-inoceramus": "inoceramus", "fg-baculites": "baculites", "fg-ammonite": "coiled-ammonite",
         "fg-echinoid": "heart-urchin", "fg-gastropod": "gastropod", "fg-shark": "shark-tooth", "fg-petrified-wood": "petrified-wood"}
def src(s): return {**s, "retrieved": TODAY}
def pat(t): w = re.escape(t).replace(r"\ ", r"[\s-]?").replace(r"\-", r"[\s-]?"); return r"\b" + w + (r"s?\b" if not t.endswith("s") else r"\b")
EXPECT = {**{k: ["Cretaceous"] for k in ["Austin","Taylor","Navarro","Del Rio","Eagle Ford","Edwards","Glen Rose","Walnut","Goodland","Woodbine","Pecan Gap","Kemp","Corsicana","Buda","Fort Worth","Duck Creek","Grayson","Paluxy","Kiamichi","Ozan","Wolfe City"]},
          **{k: ["Paleogene"] for k in ["Midway","Wilcox","Weches","Reklaw","Carrizo","Calvert Bluff","Simsboro","Hooper","Kincaid","Jackson","Sparta","Queen City","Yegua"]},
          "Catahoula": ["Paleogene","Neogene"], "Oakville": ["Neogene"], "Marble Falls": ["Carboniferous","Pennsylvanian"]}
def formations():
    fm = json.load(open(RAW / "macrostrat_fm.json")); out = {}
    for n, rows in fm.items():
        if not isinstance(rows, list): continue
        ok = [r for r in rows if r.get("b_period") in EXPECT.get(n, []) or r.get("t_period") in EXPECT.get(n, [])]
        if not ok: continue
        b = max(float(r["b_age"]) for r in ok); t = min(float(r["t_age"]) for r in ok)
        out[n] = {"name": n, "b_age": round(b, 2), "t_age": round(t, 2), "period": "/".join(sorted({r["b_period"] for r in ok} | {r["t_period"] for r in ok})),
                  "ranks": sorted({r["rank"] for r in ok}), "macrostrat_ids": [r["strat_name_id"] for r in ok][:4]}
    return out
def fossils():
    FM = formations(); groups = C.FOSSIL_GROUPS; types = []; tr = set()
    for g in groups:
        fms = [FM[f] for f in g["formations"] if f in FM]
        ages = f"; formations: " + ", ".join(f"{x['name']} ({x['b_age']}-{x['t_age']} Ma)" for x in fms) if fms else ""
        e = {"id": g["id"], "name": g["name"], "aliases": g["aliases"], "typology_system": {"body": "Fossil group (body fossil)", "plant": "Fossil group (plant)", "trace": "Trace fossil", "pseudo": "Pseudofossil (not a fossil)"}[g["kind"]],
             "category": "fossil", "rules": True, "fossil_kind": g["kind"], "period": g["period"], "dates": g["dates"] + ages, "age_ma": g["age_ma"], "continent": "Worldwide", "country": [], "admin1": ["Texas"] if g["texas"] else [],
             "region_notes": "Worldwide group; Texas formations listed where known", "traits": g["traits"], "similar_types": g["lookalikes"], "lookalikes": g["lookalikes"], "formations": g["formations"],
             "diagnostic": g["diag"], "texas": g["texas"], "home_priority": 1 if g["texas"] else 2, "sources": [src(s) for s in g["src"]] + [src(C.MACRO(f["name"])) for f in fms[:2]], "genera_tx": 0}
        types.append(e); tr |= set(g["traits"])
    gm = [(g, set(g["match"])) for g in groups if g["match"]]
    def group_of(r):
        for g in groups:
            if r.get("nam") in g["aliases"] or r.get("nam") in g["match"]: return g
        for key in ("fml", "odl", "cll", "phl"):
            for g, m in gm:
                if r.get(key) in m: return g
        return None
    seen = set(); byg = {}
    def add(r, tx):
        if r.get("nam") in seen: return
        g = group_of(r)
        if not g: return
        seen.add(r["nam"]); byg[g["id"]] = byg.get(g["id"], 0) + 1
        oid = r["oid"].split(":")[-1]; fea, lla = r.get("fea"), r.get("lla")
        types.append({"id": "pbdb-" + oid, "name": r["nam"], "aliases": [], "typology_system": f"PBDB genus ({r.get('cll') or r.get('phl') or 'fossil'})", "category": "fossil", "rules": False, "group": g["id"],
            "period": " to ".join(x for x in [r.get("tei"), r.get("tli")] if x) or None, "dates": f"{fea}-{lla} Ma" if fea is not None else None, "age_ma": [fea, lla] if fea is not None else None,
            "continent": "North America" if tx else "Worldwide", "country": ["US"] if tx else [], "admin1": ["Texas"] if tx else [], "region_notes": f"{r.get('noc', 0)} PBDB occurrences in Texas" if tx else "Worldwide PBDB taxon",
            "taxonomy": {k: r.get(v) for k, v in [("phylum", "phl"), ("class", "cll"), ("order", "odl"), ("family", "fml")] if r.get(v) and not str(r.get(v)).startswith("NO_")},
            "traits": g["traits"][:4], "similar_types": g["lookalikes"][:3], "texas": tx, "home_priority": 1 if tx else 3,
            "sources": [src({"name": "Paleobiology Database (PBDB)", "url": f"https://paleobiodb.org/classic/basicTaxonInfo?taxon_no={oid}", "license": "CC BY 4.0"})]})
    tx = sorted(json.load(open(RAW / "pbdb_tx.json"))["records"], key=lambda r: -r.get("noc", 0))
    for r in [r for r in tx if r.get("noc", 0) >= 3]: add(r, True)
    for r in json.load(open(RAW / "pbdb_world.json")): add({**r, "noc": 0}, False)
    for e in types:
        if e.get("rules"): e["genera_tx"] = byg.get(e["id"], 0)
    return types, sorted(tr), FM
def minerals():
    types = []; tr = set()
    for g in C.ROCKS:
        types.append({"id": g["id"], "name": g["name"], "aliases": g["aliases"], "typology_system": {"rock": "Rock type", "mineral": "Mineral / silica variety"}[g["kind"]], "category": "rock", "rules": True,
            "period": None, "dates": None, "continent": "Worldwide", "country": [], "admin1": ["Texas"] if g["texas"] else [], "region_notes": "; ".join(g["localities"]), "localities": g["localities"],
            "properties": {k: g[k] for k in ["hardness", "luster", "streak", "system"]} | {"colors": g["colors"]}, "traits": g["traits"], "similar_types": g["lookalikes"], "lookalikes": g["lookalikes"],
            "diagnostic": g["diag"], "texas": g["texas"], "home_priority": 1 if g["texas"] else 2, "sources": [src(s) for s in g["src"]]}); tr |= set(g["traits"])
    have = {a.lower() for g in C.ROCKS for a in [g["name"]] + g["aliases"]}
    for b in json.load(open(RAW / "wd_minerals.json"))["results"]["bindings"]:
        nm = b["mLabel"]["value"]; q = b["m"]["value"].rsplit("/", 1)[-1]
        if nm.lower() in have or re.fullmatch(r"Q\d+", nm): continue
        v = lambda k: [x for x in b.get(k, {}).get("value", "").split("|") if x]
        sys_ = [s.replace(" crystal system", "") for s in v("sys")]
        types.append({"id": "wd-" + q, "name": nm, "aliases": [], "typology_system": "Mineral (Wikidata)", "category": "rock", "rules": False, "period": None, "dates": None, "continent": "Worldwide", "country": [], "admin1": [],
            "properties": {"hardness": b.get("hard", {}).get("value"), "system": ", ".join(sys_) or None, "colors": v("col"), "streak": ", ".join(v("streak")) or None, "formula": b.get("formula", {}).get("value")},
            "traits": [t for t in ["metallic" if "metal" in nm.lower() else None] if t] + [c for c in v("col")[:3]], "similar_types": [], "texas": False, "home_priority": 3,
            "sources": [src({"name": "Wikidata", "url": "https://www.wikidata.org/wiki/" + q, "license": "CC0"})]})
    return types, sorted(tr)
def write(name, types, traits, note, sources, extra=None):
    for t in types:
        if t["id"] in MERGE: t["merge_into"] = MERGE[t["id"]]
    meta = {"format": "unearthed-reference/v1", "built": TODAY, "count": len(types), "category": types[0]["category"], "note": note, "sources": sources,
            "trait_patterns": {t: pat(t) for t in traits}, **(extra or {})}
    types.sort(key=lambda t: (not t.get("rules"), not t["texas"], t["name"].lower()))
    (ROOT / "data/reference" / name).write_text(json.dumps({"meta": meta, "types": types}, ensure_ascii=False, separators=(",", ":")))
    return len(types)
if __name__ == "__main__":
    ft, ftr, FM = fossils(); mt, mtr = minerals()
    n1 = write("public-fossils.json", ft, ftr, "Fossil reference layer: curated worldwide groups (incl. trace fossils, petrified wood, pseudofossils) with Texas formations, plus PBDB genera (Texas, >=3 occurrences, and a worldwide list). Facts and links only; not identifications.",
        [{"name": "Paleobiology Database", "url": "https://paleobiodb.org", "license": "CC BY 4.0"}, {"name": "Macrostrat", "url": "https://macrostrat.org", "license": "CC BY 4.0"}, {"name": "USGS / NPS", "url": "https://www.usgs.gov", "license": "Public domain"}, {"name": "Wikidata", "url": "https://www.wikidata.org", "license": "CC0"}, {"name": "UT BEG Geologic Atlas of Texas", "url": "https://www.beg.utexas.edu", "license": "facts summarized, cited"}],
        {"formations": FM})
    n2 = write("public-minerals.json", mt, mtr, "Rocks & minerals reference layer: curated rock types and silica varieties (agate, chalcedony, chert, petrified wood, concretions, geodes) with localities, plus Wikidata mineral properties (Mohs hardness, crystal system, color, streak). Facts and links only.",
        [{"name": "Wikidata", "url": "https://www.wikidata.org", "license": "CC0"}, {"name": "USGS", "url": "https://www.usgs.gov", "license": "Public domain"}])
    print("fossils", n1, "minerals", n2)
