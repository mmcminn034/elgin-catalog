"""Public Reference Catalog regression (signed out, mocked cloud; no production writes). Usage: python3 tests/public_reference_regress.py URL"""
import sys, json, re, pathlib
from PIL import Image
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8843/"; fails = []; errs = []
ROOT = pathlib.Path(__file__).resolve().parents[1]
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
# ---- data rules: the database is the source of truth (service key from the env when present; otherwise the bridge export) ----
import os, urllib.request
def db_rows():
    k = os.environ.get("SVC_KEY")
    if not k: return None
    out, off = [], 0
    while True:
        rq = urllib.request.Request(f"https://qqllbazrwfebpnqhdwox.supabase.co/rest/v1/reference_media?select=id,source,kind,title,keywords,thumb_url,source_url,license,license_url,attribution,data&data->>public=eq.1&order=id&limit=1000&offset={off}", headers={"apikey": k, "Authorization": "Bearer " + k})
        b = json.load(urllib.request.urlopen(rq, timeout=60)); out += b; off += 1000
        if len(b) < 1000: return out
rows = db_rows()
if rows is None:
    print("NOTE data rules read the bridge export (SVC_KEY not set)")
    rows = [{"id": x["id"], "source": x["source"], "kind": x["category"], "title": x["name"], "keywords": ["x"], "thumb_url": x["thumb"], "source_url": x["source_url"], "license": x["license"], "license_url": x.get("license_url"),
             "attribution": x["attribution"], "data": {"public": "1", "pc": "1" if "/storage/v1/" in x["thumb"] else None, "catalog": x}} for x in json.load(open(ROOT / "data/reference/public-catalog.json"))["items"]]
items = [{**(r["data"].get("catalog") or {}), "id": r["id"], "category": r["kind"], "name": (r["data"].get("catalog") or {}).get("name") or r["title"], "thumb": r["thumb_url"], "source": r["source"],
          "source_url": r["source_url"], "license": r["license"], "attribution": r["attribution"], "keywords": r.get("keywords") or [], "pc": r["data"].get("pc")} for r in rows]
OKLIC = re.compile(r"^(CC0|Public domain)$")
chk("has the first batch (>= 1,000 records)", len(items) >= 1000, len(items))
chk("all three categories present", all(any(x["category"] == c for x in items) for c in ("artifact", "fossil", "mineral")))
chk("ids unique", len({x["id"] for x in items}) == len(items))
chk("every license is CC0 / public domain", all(OKLIC.match(x["license"]) for x in items), [x["license"] for x in items if not OKLIC.match(x["license"])][:3])
need = ["name", "type", "material", "institution", "license", "attribution", "source_url", "thumb", "source"]
chk("every record has name/type/material/institution/license/attribution/source/photo", all(all(x.get(k) for k in need) for x in items), [x["id"] for x in items if not all(x.get(k) for k in need)][:5])
chk("source URLs and thumbnails are http(s) (no repo files)", all(re.match(r"^https?://", x["source_url"]) and re.match(r"^https://", x["thumb"]) for x in items))
chk("importer thumbnails live in the public Storage bucket", all("/storage/v1/object/public/reference-media/" in x["thumb"] for x in items if x["pc"]))
chk("importer rows have matching keywords (used by similar_reference_media)", sum(bool(x["keywords"]) for x in items if x["pc"]) >= 0.98 * sum(1 for x in items if x["pc"]))
COORD = re.compile(r"-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|\b\d{1,3}°\s*\d{1,2}['′]|\blat(itude)?\b|\blon(gitude)?\b|\bT\d{1,2}[NS],?\s*R\d{1,2}[EW]\b|\bsec\.\s*\d+", re.I)
blob = lambda x: " ".join(str(x.get(k, "")) for k in ("name", "region", "description", "formation", "attribution"))
chk("no coordinates / survey sections anywhere", not any(COORD.search(blob(x)) for x in items), [x["id"] for x in items if COORD.search(blob(x))][:5])
chk("no coordinate keys", not any(k in x for x in items for k in ("lat", "lon", "latitude", "longitude", "decimalLatitude", "decimalLongitude", "locality")))
bad_reg = [x["region"] for x in items if x.get("region") and len(x["region"].split(", ")) > 2]
chk("region is county/state level at most", not bad_reg, bad_reg[:3])
chk("Texas first: >= 400 Texas records", sum(bool(x.get("tx")) for x in items) >= 400, sum(bool(x.get("tx")) for x in items))
DATED = re.compile(r"\b(Indians?|Eskimos?|squaws?|savages?|redskins?|primitive)\b(?!\s+(Ocean|River|Creek|Lake|Mounds?|Territory))")
chk("displayed titles/descriptions use respectful wording", not any(DATED.search(str(x.get("name", "")) + " " + str(x.get("description", ""))) for x in items if x.get("us")), [x["name"] for x in items if x.get("us") and DATED.search(str(x.get("name", "")))][:3])
chk("museum's original wording kept in source_title", any(x.get("source_title") and "Indian" in x["source_title"] and "Native American" in x["name"] for x in items))
chk("no Colorado Projectile Point Database", not any("projectile point database" in json.dumps(x).lower() and "colorado" in json.dumps(x).lower() for x in items))
from io import BytesIO
smp = [x for x in items if x["pc"]][::60]
bad = []
for x in smp:
    try:
        b = urllib.request.urlopen(x["thumb"], timeout=30).read(); im = Image.open(BytesIO(b))
        if im.getexif() or b"Exif" in b[:4096] or max(im.size) > 480: bad.append(x["id"])
    except Exception as e: bad.append(x["id"] + " " + str(e)[:40])
chk(f"Storage thumbnails load, <= 480 px, no EXIF/GPS (sample of {len(smp)})", not bad, bad[:3])
MOCKROWS = [{"id": x["id"], "source": x["source"], "kind": x["category"], "title": x["name"], "thumb_url": x["thumb"], "source_url": x["source_url"], "license": x["license"], "license_url": x.get("license_url"),
             "attribution": x["attribution"], "data": {"public": "1", "catalog": {k: v for k, v in x.items() if k not in ("keywords", "pc", "thumb")}}} for x in items]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    c = b.new_context(viewport={"width": 1280, "height": 900}); c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps({"online": True, "user": None, "refcatalog": MOCKROWS}))
    c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_selector("#tryBtn:visible", timeout=15000)
    chk("home links to the Reference Catalog", pg.locator("#view-home a[href='#/reference']").count() == 1)
    pg.goto(U + "#/reference"); pg.wait_for_selector("#rcGrid .rc-card", timeout=15000)
    chk("page reads the database rows (not the bridge file)", pg.evaluate("RefCatalog.origin()") == "db")
    chk("signed out: reference view visible (not bounced home)", pg.locator("#view-reference:not([hidden])").count() == 1 and pg.url.endswith("#/reference"))
    chk("clearly labelled Reference Catalog, separate from finds", "Reference Catalog" in pg.inner_text("#rc-h") and "separate from members' finds" in pg.inner_text("#referenceBody"))
    n_all = int(pg.inner_text("#rcTabs [data-cat=''] .n")); chk("All tab count = records", n_all == len(items), n_all)
    chk("first page shows 48 cards + Show more", pg.locator("#rcGrid .rc-card").count() == 48 and pg.locator("#rcMore:visible").count() == 1)
    pg.goto(U + "#/reference/" + next(x["id"] for x in items if x.get("source_title") and x["source_title"] != x["name"])); pg.wait_for_selector("#rcDlg[open]", timeout=8000)
    t = pg.inner_text("#rcDlgBody"); chk("detail shows softened title and the museum's original title", "Museum's title" in t)
    pg.keyboard.press("Escape"); pg.goto(U + "#/reference"); pg.wait_for_selector("#rcGrid .rc-card")
    first = pg.inner_text("#rcGrid .rc-card >> nth=0"); chk("card shows license + source link", pg.locator("#rcGrid .rc-card >> nth=0 >> .rc-credit a").count() == 1 and re.search(r"CC|Public domain", first) is not None, first[:120])
    for cat in ("artifact", "fossil", "mineral"):
        pg.click(f"#rcTabs [data-cat={cat}]"); pg.wait_for_timeout(150)
        want = sum(x["category"] == cat for x in items); got = pg.evaluate("RefCatalog.filtered().length")
        chk(f"{cat} tab filters ({want})", got == want and all(t in ("Artifact", "Fossil", "Mineral") for t in pg.locator("#rcGrid .rc-cat").all_inner_texts()[:5]), got)
    pg.click("#rcTabs [data-cat='']"); pg.fill("#rcQ", "chert"); pg.wait_for_timeout(400)
    got = pg.evaluate("RefCatalog.filtered().length"); chk("search 'chert' narrows results", 0 < got < len(items), got)
    pg.fill("#rcQ", "zzzqqqnotathing"); pg.wait_for_timeout(400); chk("empty search shows a message", "No records match" in pg.inner_text("#rcGrid"))
    pg.fill("#rcQ", ""); pg.check("#rcTx"); pg.wait_for_timeout(300); chk("Texas only filter", pg.evaluate("RefCatalog.filtered().every(x => x.tx)") and pg.evaluate("RefCatalog.filtered().length") == sum(bool(x.get("tx")) for x in items))
    pg.uncheck("#rcTx"); pg.click("#rcGrid .rc-link >> nth=0"); pg.wait_for_selector("#rcDlg[open]")
    t = pg.inner_text("#rcDlgBody"); chk("detail shows institution, license, credit and original record link", "Held by" in t and "Credit:" in t and "View the original record" in t)
    chk("detail URL is shareable", "#/reference/" in pg.url); pg.keyboard.press("Escape"); pg.wait_for_timeout(200); chk("closing returns to list URL", pg.url.endswith("#/reference"))
    first_id = pg.evaluate("RefCatalog.filtered()[0].id"); first_nm = pg.evaluate("RefCatalog.filtered()[0].name"); pg.goto(U + "#/reference/" + first_id); pg.wait_for_selector("#rcDlg[open]", timeout=8000); chk("deep link opens the record", first_nm[:20] in pg.inner_text("#rcDlgH"))
    # graceful error state: database fails and the bridge file is unavailable
    c2 = b.new_context(); c2.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps({"online": True, "user": None, "refcatalog": "error"}))
    c2.route("**/public-catalog.json*", lambda r: r.fulfill(status=404, body="")); p2 = c2.new_page(); p2.goto(U + "#/reference"); p2.wait_for_selector("#rcRetry", timeout=15000)
    chk("graceful error state with retry", "can't load right now" in p2.inner_text("#referenceBody")); c2.close()
    pg.goto(U + "#/discover"); pg.wait_for_timeout(500); chk("Discover links to the Reference Catalog", pg.locator("#view-discover a[href='#/reference']").count() == 1)
    pg.goto(U + "#/learn"); pg.wait_for_timeout(800); chk("Learn still renders", pg.locator("#view-learn:not([hidden])").count() == 1)
    pg.goto(U + "#/paydig"); pg.wait_for_timeout(800); chk("Pay dig still renders", pg.locator("#view-paydig:not([hidden])").count() == 1)
    pg.goto(U + "#/catalog"); pg.wait_for_timeout(800); chk("private catalog still gated when signed out", pg.locator("#view-catalog:not([hidden])").count() == 0)
    b.close()
real = [e for e in errs if "Failed to load resource" not in e]; chk("no page errors", not real, str(real[:3])); print("FAILS", fails); sys.exit(1 if fails else 0)
