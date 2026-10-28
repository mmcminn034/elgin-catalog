"""Guest mode regression (mocked cloud; no production writes). Usage: python3 tests/guest_regress.py URL"""
import sys, json, io, base64, re
from PIL import Image
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8843/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
# a JPEG that carries EXIF GPS (30.267153, -97.743057 = a precise location) and a camera name
ex = Image.Exif(); ex[0x010F] = "TestCam"; ex[0x8825] = {1: "N", 2: (30.0, 16.0, 1.0), 3: "W", 4: (97.0, 44.0, 35.0)}
im = Image.new("RGB", (1600, 1200), (150, 120, 90)); 
for x in range(0, 1600, 40): 
    for y in range(0, 1200, 40): im.putpixel((x, y), (20, 20, 20))
buf = io.BytesIO(); im.save(buf, "JPEG", exif=ex.tobytes(), quality=90); open("/tmp/guest_gps.jpg", "wb").write(buf.getvalue())
chk("fixture really has EXIF + GPS", b"Exif" in buf.getvalue() and b"TestCam" in buf.getvalue())
def ctx(b, mock):
    c = b.new_context(viewport={"width": 1280, "height": 900}); reqs = []
    if mock is not None: c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock))
    def cap(r): reqs.append((r.request.method, r.request.url, r.request.post_data or "")); r.fulfill(status=200, content_type="application/json", body="[]")
    c.route("**/*.supabase.co/**", cap); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:300].replace("\n"," | "))); return c, pg, reqs
def add(pg, name, photo="/tmp/guest_gps.jpg", place="Bastrop County, Texas", feats="triangular, notched base, flake scars on both faces"):
    pg.goto(U + "#/try/new"); pg.wait_for_selector("#tryForm"); pg.fill("#tryForm [name=object_type]", name); pg.fill("#tryForm [name=key_features]", feats); pg.fill("#tryForm [name=region]", place)
    pg.set_input_files("#tryFile", photo); pg.wait_for_selector("#tryThumbs img"); pg.click("#trySave"); pg.wait_for_timeout(500)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    # ---- entry points (signed out) ----
    c, pg, reqs = ctx(b, {"online": True, "user": None}); pg.goto(U); pg.wait_for_selector("#tryBtn:visible", timeout=15000)
    chk("home has 'Try it without an account'", "Try it without an account" in pg.inner_text("#tryBtn"))
    pg.click("[data-auth-open=signin]"); pg.wait_for_selector("#authDlg[open]"); chk("sign-in dialog offers guest mode", pg.locator("#authDlg [data-guest-try]:visible").count() == 1)
    pg.click("#authDlg [data-guest-try]"); pg.wait_for_selector("#tryBody h1", timeout=10000); chk("opens guest page, dialog closed", pg.locator("#authDlg[open]").count() == 0 and pg.url.endswith("#/try"))
    chk("clear notice shown", "Guest finds stay on this device only; clearing your browser deletes them." in pg.inner_text("#tryBody"))
    chk("guest page reachable signed out (not bounced home)", pg.locator("#view-try:not([hidden])").count() == 1)
    chk("Discover and Learn still reachable", pg.locator("#tryBody a[href='#/discover']").count() == 1 and pg.locator("#tryBody a[href='#/learn']").count() == 1)
    # ---- validation: no exact locations ----
    pg.goto(U + "#/try/new"); pg.wait_for_selector("#tryForm"); chk("no coordinate/address/GPS fields on the form", pg.locator("#tryForm input[name*=lat], #tryForm input[name*=lon], #tryForm input[name*=gps], #tryForm input[name*=address], #tryForm input[name*=find_location]").count() == 0)
    pg.fill("#tryForm [name=object_type]", "test"); pg.set_input_files("#tryFile", "/tmp/guest_gps.jpg"); pg.wait_for_selector("#tryThumbs img")
    for bad, why in [("30.267153, -97.743057", "coordinates"), ("123 Main Street, Elgin", "street address"), ("78621", "zip"), ("N 30° 16' W 97° 44'", "dms")]:
        pg.fill("#tryForm [name=region]", bad); pg.click("#trySave"); pg.wait_for_timeout(200); chk(f"rejects {why} in the place box", pg.locator("#tryErr:visible").count() == 1 and "town or county" in pg.inner_text("#tryErr").lower() or "coordinates" in pg.inner_text("#tryErr").lower(), bad)
    pg.fill("#tryForm [name=region]", ""); pg.fill("#tryForm [name=key_features]", "found at 30.267153, -97.743057"); pg.click("#trySave"); pg.wait_for_timeout(200); chk("rejects coordinates hidden in notes", pg.locator("#tryErr:visible").count() == 1)
    pg.fill("#tryForm [name=key_features]", "ok"); pg.fill("#tryForm [name=object_type]", ""); pg.click("#trySave"); pg.wait_for_timeout(200); chk("requires a name", "what it is" in pg.inner_text("#tryErr"))
    # ---- add 3 finds, EXIF stripped ----
    add(pg, "Stemmed point"); pg.wait_for_selector("#tryAnalysis", timeout=8000)
    f = pg.evaluate("Guest.list()"); chk("find saved as guest G-1", len(f) == 1 and f[0]["id"] == "G-1", f[0]["id"] if f else "")
    src = f[0]["photos"][0]["src"]; raw = base64.b64decode(src.split(",", 1)[1])
    chk("stored photo is a JPEG with no EXIF/GPS (re-encoded)", raw[:2] == b"\xff\xd8" and b"Exif" not in raw and b"TestCam" not in raw and b"GPS" not in raw)
    chk("photo was downscaled", Image.open(io.BytesIO(raw)).size[0] <= 1400)
    chk("only town-level place stored", f[0]["fields"]["region"] == "Bastrop County, Texas" and not any(k in json.dumps(f[0]["fields"]).lower() for k in ["latitude", "longitude", "find_location"]))
    # ---- detail: rules analysis yes, AI/share no ----
    pg.wait_for_selector("#tryAnalysis .analysis", timeout=10000); t = pg.inner_text("#tryBody")
    chk("free rules-based analysis renders", "Identification" in t and pg.locator("#tryAnalysis .cands li").count() >= 1)
    chk("no 'save as verified' (learning store untouched)", pg.locator("#tryAnalysis .confirm").count() == 0)
    chk("AI button says sign up free", "Sign up free to run AI ID" in pg.inner_text("[data-try-ai]"))
    chk("no share / public / collaboration controls", pg.locator("#tryBody [data-act=share], #tryBody [data-act=vis], #tryBody [data-act=review], #tryBody a[href='#/labels'], #tryBody #aiRun").count() == 0 and not re.search(r"Share|Public link|Request expert", pg.locator("#tryBody").inner_text()) )
    pg.click("[data-try-ai]"); chk("AI click shows email-only sign-up, no AI call", pg.locator("#trySignup:visible").count() == 1 and not any("analyze-find" in u for _, u, _ in reqs))
    pg.wait_for_function("document.querySelectorAll('[data-pq]')[0] && document.querySelectorAll('[data-pq]')[0].textContent.length > 0", timeout=8000); chk("photo check ran on the guest photo", True)
    add(pg, "Oyster fossil", feats="curled thick shell"); add(pg, "Quartz pebble", feats="rounded cobble, no flake scars", place="")
    chk("3 finds stored", pg.evaluate("Guest.count()") == 3)
    # ---- limit ----
    pg.goto(U + "#/try"); pg.wait_for_selector("#tryAdd"); chk("list shows 3 of 3 and sign-up panel", "3 of 3" in pg.inner_text("#tryCount") and pg.locator("#trySignup:visible").count() == 1)
    pg.click("#tryAdd"); pg.wait_for_timeout(300); chk("4th find blocked at the button", not pg.url.endswith("/new"))
    pg.goto(U + "#/try/new"); pg.wait_for_selector("#tryBody h1"); pg.wait_for_timeout(300); chk("4th find blocked on the form route", pg.locator("#tryForm").count() == 0 and "3 finds" in pg.inner_text("#tryBody"))
    pg.goto(U + "#/try"); pg.wait_for_selector("#trySignupForm"); pg.fill("#trySignupEmail", "not-an-email"); pg.click("#trySignupForm button"); chk("bad email refused", "valid email" in pg.inner_text("#trySignupMsg"))
    pg.fill("#trySignupEmail", "guest@example.com"); pg.click("#trySignupForm button"); pg.wait_for_timeout(500)
    chk("magic link requested with email only", pg.evaluate("ROLLING_OAK_MOCK.magic") == ["guest@example.com"] and "one-time" in pg.inner_text("#trySignupMsg"))
    ev = pg.evaluate("ROLLING_OAK_MOCK.guestEvents || []"); chk("anonymous counters: 1 start, 3 finds, sign-up clicks", ev.count("guest_start") == 1 and ev.count("guest_find") == 3 and ev.count("guest_signup_click") >= 2, str(ev))
    chk("nothing about guest finds left the browser", not any("data:image" in body or "Stemmed point" in body or "guest_gps" in body for _, _, body in reqs) and not any(m != "GET" and "storage" in u for m, u, _ in reqs))
    pg.reload(); pg.wait_for_selector("#tryCount"); chk("finds survive a reload (IndexedDB)", "3 of 3" in pg.inner_text("#tryCount"))
    pg.click("[data-try-del='G-3']") if False else None
    pg.once("dialog", lambda d: d.accept()); pg.click("[data-try-del='G-3']"); pg.wait_for_timeout(400); chk("delete works", pg.evaluate("Guest.count()") == 2)
    pg.evaluate("localStorage.getItem('x')"); chk("no page errors (guest)", not errs, str(errs[:2]))
    # guest data survives for the import test
    state = pg.context.storage_state(indexed_db=True); c.close()
    # ---- sign in -> import as private (free account, 5 private limit) ----
    FREE = {"online": True, "user": {"id": "u2", "email": "free@example.com"}, "profile": {"display_name": "Free", "membership": "free"}, "adminUserId": "u1",
            "collections": [{"id": "c2", "slug": "free-finds", "name": "My finds", "role": "owner", "is_public": False}], "members": {}}
    def seeded(mock):
        c = b.new_context(viewport={"width": 1280, "height": 900}, storage_state=state); c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
        pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:300].replace("\n"," | "))); return c, pg
    c, pg = seeded(FREE); pg.goto(U); pg.wait_for_timeout(2500)
    chk("signed-in user with guest finds sees the import banner", pg.locator("#guestBanner:visible").count() == 1 and "2 guest finds" in pg.inner_text("#guestBanner"), pg.inner_text("#guestBanner"))
    pg.goto(U + "#/try"); pg.wait_for_selector("#tryImport"); chk("import panel says private + limit + no plan", "private" in pg.inner_text("#tryImport") and "5" in pg.inner_text("#tryImport") and pg.locator("#trySignup").count() == 0)
    pg.click("[data-try-import]"); pg.wait_for_function("document.querySelector('#tryImportLog') && /Done/.test(document.querySelector('#tryImportLog').innerText)", timeout=20000)
    pushed = pg.evaluate("ROLLING_OAK_MOCK.pushed || []")
    chk("2 finds pushed, all private, none public", len(pushed) == 2 and all(r.get("visibility") == "private" and not r.get("is_public") for r in pushed), str([(r.get("catalog_id"), r.get("visibility")) for r in pushed]))
    chk("no exact location / EXIF in the import", not any(k in json.dumps(pushed) for k in ["30.267", "-97.74", "find_location_private", "TestCam"]))
    chk("local copies removed after sync", pg.evaluate("Guest.count()") == 0, pg.inner_text("#tryImportLog").replace("\n", " | ")[:200])
    chk("imported finds are in the catalog", pg.evaluate("App.all.filter(r => /Stemmed point|Oyster fossil/.test(r.object_type)).length") == 2)
    chk("no plan granted", pg.evaluate("Membership.plan()") == "free"); chk("counter: imports logged", pg.evaluate("ROLLING_OAK_MOCK.guestEvents").count("guest_import") == 2 if pg.evaluate("ROLLING_OAK_MOCK.guestEvents") else False)
    c.close()
    # ---- at the free private limit: nothing imported, nothing made public ----
    def own(i): return {"catalog_id": f"FRE-00{i}", "_owner": "u2", "category": "artifact", "object_type": f"Test point {i}", "title": f"My find {i}", "material": "chert", "status": "Draft", "visibility": "private", "is_public": False, "photos": []}
    c, pg = seeded(dict(FREE, finds=[own(i) for i in range(1, 6)], privateBaseline=5)); pg.goto(U + "#/try"); pg.wait_for_selector("#tryImport"); pg.wait_for_timeout(1200)
    pg.click("[data-try-import]"); pg.wait_for_function("document.querySelector('#tryImportLog') && /Nothing was imported|Done/.test(document.querySelector('#tryImportLog').innerText)", timeout=20000)
    chk("free limit respected: nothing pushed", len(pg.evaluate("ROLLING_OAK_MOCK.pushed || []")) == 0, pg.inner_text("#tryImportLog").replace("\n", " | ")[:220])
    chk("guest finds kept on the device at the limit", pg.evaluate("Guest.count()") == 2 and "free private limit" in pg.inner_text("#tryImportLog").lower())
    c.close()
    # ---- sync failure keeps the guest copy ----
    c, pg = seeded(dict(FREE, pushFail=True)); pg.goto(U + "#/try"); pg.wait_for_selector("#tryImport"); pg.wait_for_timeout(800); pg.click("[data-try-import]"); pg.wait_for_timeout(5000)
    chk("sync failure: guest copies are kept (not deleted before sync)", pg.evaluate("Guest.count()") == 2, pg.inner_text("#tryImportLog").replace("\n", " | ")[:200]); c.close()
    b.close()
real = [e for e in errs if "Failed to load resource" not in e]; chk("no page errors", not real, str(real[:3])); print("FAILS", fails); sys.exit(1 if fails else 0)
