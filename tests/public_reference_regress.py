"""Public Reference Catalog regression (signed out, mocked cloud; no production writes). Usage: python3 tests/public_reference_regress.py URL"""
import sys, json, re, pathlib
from PIL import Image
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8843/"; fails = []; errs = []
ROOT = pathlib.Path(__file__).resolve().parents[1]
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
# ---- data rules ----
d = json.load(open(ROOT / "data/reference/public-catalog.json")); items = d["items"]
OKLIC = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d\.\d)$")
chk("has a first batch (>= 300 records)", len(items) >= 300, len(items))
chk("all three categories present", all(any(x["category"] == c for x in items) for c in ("artifact", "fossil", "mineral")))
chk("ids unique", len({x["id"] for x in items}) == len(items))
chk("every license is CC0 / PD / CC BY / CC BY-SA (no NC/ND)", all(OKLIC.match(x["license"]) for x in items), [x["license"] for x in items if not OKLIC.match(x["license"])][:3])
need = ["name", "type", "material", "institution", "license", "attribution", "source_url", "thumb", "source"]
chk("every record has name/type/material/institution/license/attribution/source/photo", all(all(x.get(k) for k in need) for x in items), [x["id"] for x in items if not all(x.get(k) for k in need)][:5])
chk("source URLs are http(s)", all(re.match(r"^https?://", x["source_url"]) for x in items))
COORD = re.compile(r"-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|\b\d{1,3}°\s*\d{1,2}['′]|\blat(itude)?\b|\blon(gitude)?\b|\bT\d{1,2}[NS],?\s*R\d{1,2}[EW]\b|\bsec\.\s*\d+", re.I)
blob = lambda x: " ".join(str(x.get(k, "")) for k in ("name", "region", "description", "formation", "attribution", "search"))
chk("no coordinates / survey sections anywhere", not any(COORD.search(blob(x)) for x in items), [x["id"] for x in items if COORD.search(blob(x))][:5])
chk("no coordinate keys", not any(k in x for x in items for k in ("lat", "lon", "latitude", "longitude", "decimalLatitude", "decimalLongitude", "locality")))
bad_reg = [x["region"] for x in items if x["region"] and len(x["region"].split(", ")) > 2]
chk("region is county/state level at most", not bad_reg, bad_reg[:3])
chk("Texas first: >= 150 Texas records", sum(x["tx"] for x in items) >= 150, sum(x["tx"] for x in items))
chk("no Colorado Projectile Point Database", not any("projectile point database" in json.dumps(x).lower() and "colorado" in json.dumps(x).lower() for x in items))
th = [ROOT / x["thumb"] for x in items]; miss = [str(t) for t in th if not t.exists()]
chk("every thumbnail exists in the repo", not miss, miss[:3])
exif = [str(t) for t in th[:2000] if t.exists() and (Image.open(t).getexif() or b"Exif" in t.read_bytes()[:4096])]
chk("thumbnails carry no EXIF/GPS", not exif, exif[:3])
chk("thumbnails <= 480 px", all(max(Image.open(t).size) <= 480 for t in th if t.exists()))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    c = b.new_context(viewport={"width": 1280, "height": 900}); c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps({"online": True, "user": None}))
    c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_selector("#tryBtn:visible", timeout=15000)
    chk("home links to the Reference Catalog", pg.locator("#view-home a[href='#/reference']").count() == 1)
    pg.goto(U + "#/reference"); pg.wait_for_selector("#rcGrid .rc-card", timeout=15000)
    chk("signed out: reference view visible (not bounced home)", pg.locator("#view-reference:not([hidden])").count() == 1 and pg.url.endswith("#/reference"))
    chk("clearly labelled Reference Catalog, separate from finds", "Reference Catalog" in pg.inner_text("#rc-h") and "separate from members' finds" in pg.inner_text("#referenceBody"))
    n_all = int(pg.inner_text("#rcTabs [data-cat=''] .n")); chk("All tab count = records", n_all == len(items), n_all)
    chk("first page shows 48 cards + Show more", pg.locator("#rcGrid .rc-card").count() == 48 and pg.locator("#rcMore:visible").count() == 1)
    first = pg.inner_text("#rcGrid .rc-card >> nth=0"); chk("card shows license + source link", pg.locator("#rcGrid .rc-card >> nth=0 >> .rc-credit a").count() == 1 and re.search(r"CC|Public domain", first) is not None, first[:120])
    for cat in ("artifact", "fossil", "mineral"):
        pg.click(f"#rcTabs [data-cat={cat}]"); pg.wait_for_timeout(150)
        want = sum(x["category"] == cat for x in items); got = pg.evaluate("RefCatalog.filtered().length")
        chk(f"{cat} tab filters ({want})", got == want and all(t in ("Artifact", "Fossil", "Mineral") for t in pg.locator("#rcGrid .rc-cat").all_inner_texts()[:5]), got)
    pg.click("#rcTabs [data-cat='']"); pg.fill("#rcQ", "chert"); pg.wait_for_timeout(400)
    got = pg.evaluate("RefCatalog.filtered().length"); chk("search 'chert' narrows results", 0 < got < len(items), got)
    pg.fill("#rcQ", "zzzqqqnotathing"); pg.wait_for_timeout(400); chk("empty search shows a message", "No records match" in pg.inner_text("#rcGrid"))
    pg.fill("#rcQ", ""); pg.check("#rcTx"); pg.wait_for_timeout(300); chk("Texas only filter", pg.evaluate("RefCatalog.filtered().every(x => x.tx)") and pg.evaluate("RefCatalog.filtered().length") == sum(x["tx"] for x in items))
    pg.uncheck("#rcTx"); pg.click("#rcGrid .rc-link >> nth=0"); pg.wait_for_selector("#rcDlg[open]")
    t = pg.inner_text("#rcDlgBody"); chk("detail shows institution, license, credit and original record link", "Held by" in t and "Credit:" in t and "View the original record" in t)
    chk("detail URL is shareable", "#/reference/" in pg.url); pg.keyboard.press("Escape"); pg.wait_for_timeout(200); chk("closing returns to list URL", pg.url.endswith("#/reference"))
    pg.goto(U + "#/reference/" + items[0]["id"]); pg.wait_for_selector("#rcDlg[open]", timeout=8000); chk("deep link opens the record", items[0]["name"][:20] in pg.inner_text("#rcDlgH"))
    pg.goto(U + "#/discover"); pg.wait_for_timeout(500); chk("Discover links to the Reference Catalog", pg.locator("#view-discover a[href='#/reference']").count() == 1)
    pg.goto(U + "#/learn"); pg.wait_for_timeout(800); chk("Learn still renders", pg.locator("#view-learn:not([hidden])").count() == 1)
    pg.goto(U + "#/paydig"); pg.wait_for_timeout(800); chk("Pay dig still renders", pg.locator("#view-paydig:not([hidden])").count() == 1)
    pg.goto(U + "#/catalog"); pg.wait_for_timeout(800); chk("private catalog still gated when signed out", pg.locator("#view-catalog:not([hidden])").count() == 0)
    b.close()
real = [e for e in errs if "Failed to load resource" not in e]; chk("no page errors", not real, str(real[:3])); print("FAILS", fails); sys.exit(1 if fails else 0)
