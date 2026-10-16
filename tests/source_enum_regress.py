"""Regression: every client value for *_source / heat_treatment / visibility normalizes to a DB-allowed value (finds_*_chk);
stale local ELG-017 is set aside, not resurrected, and the canonical record is what retries push."""
import sys, json, itertools
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8766/"
SRC_OK = {None, "measured", "photo_estimate", "estimate"}; HEAT_OK = {None, "none", "possible", "likely", "unknown"}; VIS_OK = {None, "private", "editors", "public"}
vals = ["", " ", None, "Unknown", "unknown", "Source…", "measured", "Measured", "Measured (caliper/ruler)", "photo_estimate", "Photo estimate", "photo-estimate", "Estimated from photo", "estimate", "Estimate", "Estimated", "approx", "Not measured", "garbage"]
heat = ["", None, "unknown", "Unknown", "none", "No", "possible", "maybe", "likely", "Yes", "weird"]
vis = ["", None, "private", "Private", "editors", "public", "PUBLIC", "x"]
fails = []; errs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome'); ctx = b.new_context(); pg = ctx.new_page()
    ctx.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U + "#/catalog"); pg.wait_for_selector(".card")
    rows = [{"length_source": a, "width_source": a, "thickness_source": a, "weight_source": a, "heat_treatment": h, "visibility": v, "material": ""} for a, h, v in itertools.product(vals, heat, vis)]
    out = pg.evaluate("rows => rows.map(r => Cloud.normalizeRow({...r}))", rows)
    for i, o in zip(rows, out):
        for k in ["length_source", "width_source", "thickness_source", "weight_source"]:
            if o[k] not in SRC_OK: fails.append((k, i[k], o[k]))
        if o["heat_treatment"] not in HEAT_OK: fails.append(("heat", i["heat_treatment"], o["heat_treatment"]))
        if o["visibility"] not in VIS_OK: fails.append(("vis", i["visibility"], o["visibility"]))
        if o["material"] is not None: fails.append(("empty->null", "", o["material"]))
    print("combos checked:", len(rows))
    spot = pg.evaluate("Cloud.normalizeRow({weight_source:'', length_source:'Photo estimate', width_source:'Measured', thickness_source:'Unknown'})"); print("spot:", spot)
    if spot != {"weight_source": None, "length_source": "photo_estimate", "width_source": "measured", "thickness_source": None}: fails.append(("spot", spot))
    # catalog.json seed carries only allowed values
    d = pg.evaluate("fetch('data/catalog.json').then(r=>r.json())")
    for r in d:
        for k in ["length_source", "width_source", "thickness_source", "weight_source"]:
            if k in r and r[k] not in SRC_OK: fails.append(("seed", r["catalog_id"], k, r[k]))
    # stale local ELG-017 (Mark's failed phone entry) must be set aside, and the queue retries the canonical record
    pg.evaluate("""() => new Promise(res => { localStorage.setItem('ro-pending-sync', JSON.stringify(['ELG-017'])); const q = indexedDB.open('elgin-catalog'); q.onsuccess = () => { const db = q.result, st = db.objectStoreNames[0], t = db.transaction(st,'readwrite');
      t.objectStore(st).put({catalog_id:'ELG-017', category:'rock', object_type:'my rock', material:'?', weight_source:'', saved_ts:'2026-10-14T19:00:00.000Z', photos:[]}); t.oncomplete = () => res(); }; })""")
    pg.reload(); pg.wait_for_selector(".card"); pg.wait_for_timeout(1200)
    st = pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('elgin-catalog'); q.onsuccess = () => { const db = q.result, s = db.objectStoreNames[0], t = db.transaction(s).objectStore(s).get('ELG-017'); t.onsuccess = () => r({ idb: t.result || null, aside: JSON.parse(localStorage.getItem('ro-set-aside') || '[]').map(x => x.object_type) }); }; })""")
    print("ELG-017 local after boot:", st["idb"], "| set aside:", st["aside"])
    if st["idb"] is not None or "my rock" not in st["aside"]: fails.append(("ELG-017 set-aside", st))
    pg.evaluate("location.hash='#/record/ELG-017'"); pg.wait_for_timeout(800); t = pg.inner_text("#mTitle"); print("ELG-017 title:", t)
    if "Petrified wood" not in t: fails.append(("ELG-017 title", t))
    b.close()
print("ERRORS", errs); print("FAILS", fails[:10], len(fails))
