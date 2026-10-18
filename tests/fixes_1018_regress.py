"""Regression for the 2026-10-18 fixes (mocks; no production writes).
 - server-side find numbering: online adds take the server number (Mark: ELG series; others: their own prefix)
 - offline/unallocated adds get a TMP- id and are renumbered on sync (local record, pending list, references)
 - friendly AI-unavailable / daily-cap / sign-in messages (never a raw provider error)
 - private-find lock screen shows no title or details (signed out), even when the record is in the bundled data
Usage: python3 tests/fixes_1018_regress.py URL [screenshot dir]   (EC_SEED=/path/full_catalog.json optional)"""
import sys, json, os, re
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8831/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/membership/"
SEED = open(os.environ["EC_SEED"]).read() if os.environ.get("EC_SEED") else None
IMG = "images/ELG-001/01.jpg"; fails = []; errs = []
def chk(n, ok, info=""): print(("PASS " if ok else "FAIL ") + n, info if info != "" else ""); ok or fails.append(n)
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "lifetime"}, "adminUserId": "u1",
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": True, "visibility": "public"}], "members": {},
         "serverNumbering": True, "prefix": "ELG", "nextN": 36}
FREE = {"online": True, "user": {"id": "u2", "email": "free@example.com"}, "profile": {"display_name": "Free Collector", "membership": "free"}, "adminUserId": "u1",
        "collections": [{"id": "c2", "slug": "free-finds", "name": "My finds", "role": "owner", "is_public": False}], "members": {}, "serverNumbering": True, "prefix": "DPG", "nextN": 1}
def ctx(b, mock, extra=""):
    c = b.new_context(viewport={"width": 1280, "height": 900})
    if mock is not None: c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock) + ";" + extra)
    c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    if SEED: c.route("**/data/catalog.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=SEED))
    pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e))); return c, pg
def add(pg, obj):
    pg.goto(U + "#/add"); pg.wait_for_timeout(900)
    pg.check("input[name=category][value=artifact]"); pg.click("#next"); pg.wait_for_timeout(300)
    pg.set_input_files("[data-shot=front]", IMG); pg.wait_for_timeout(700); pg.click("#next"); pg.wait_for_timeout(300)
    pg.fill("[name=length_mm]", "40"); pg.click("#next"); pg.wait_for_timeout(300)
    pg.fill("#wizard [name=object_type]", obj); pg.fill("#wizard [name=material]", "chert"); pg.fill("#wizard [name=key_features]", "test")
    pg.check("[name=landowner_permission]"); pg.click("#next"); pg.wait_for_timeout(700); pg.click("#next"); pg.wait_for_timeout(500)
    newid = pg.inner_text("#newId") if pg.locator("#newId").count() else ""
    pg.click("#save") if pg.locator("#save").count() else pg.click("#wizard button[type=submit]")
    pg.wait_for_timeout(1500)
    d = pg.locator("#memDlg[open] #memSavePublic")
    if d.count(): d.click(); pg.wait_for_timeout(1200)
    return newid
mine = lambda pg, obj: pg.evaluate(f"App.all.filter(x => x.object_type === {json.dumps(obj)}).map(x => x.catalog_id)")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    # 1. online: Mark's new find gets the next ELG number from the server
    c, pg = ctx(b, OWNER); pg.goto(U + "#/catalog"); pg.wait_for_timeout(2500)
    nid = add(pg, "Numbering test A"); ids = mine(pg, "Numbering test A")
    chk("N1 wizard says the number is assigned on save", "assigned when saved" in nid and "ELG" in nid, nid)
    chk("N2 owner's online add uses the server ELG number", ids == ["ELG-036"], ids)
    chk("N3 pushed with the server number", any(r.get("catalog_id") == "ELG-036" for r in pg.evaluate("window.ROLLING_OAK_MOCK.pushed || []")))
    c.close()
    # 2. another account gets its own prefix
    c, pg = ctx(b, FREE); pg.goto(U + "#/catalog"); pg.wait_for_timeout(2500)
    add(pg, "Numbering test B"); ids = mine(pg, "Numbering test B")
    chk("N4 a second account numbers in its own series (no ELG collision)", ids == ["DPG-001"], ids); c.close()
    # 3. offline add -> TMP id -> renumbered on sync
    c, pg = ctx(b, FREE, "if (localStorage.getItem('t-online') !== '1') window.ROLLING_OAK_MOCK.offline = true;"); pg.goto(U + "#/catalog"); pg.wait_for_timeout(2500)
    add(pg, "Offline test C"); ids = mine(pg, "Offline test C"); tmp = ids[0] if ids else ""
    pend = pg.evaluate("JSON.parse(localStorage.getItem('ro-pending-sync') || '[]')")
    chk("N5 offline add gets a temporary TMP- id", re.match(r"^TMP-\d+$", tmp or "") is not None, ids)
    chk("N6 temporary find is queued for sync", tmp in pend, pend)
    chk("N7 nothing pushed with a temporary id", not any(str(r.get("catalog_id", "")).startswith("TMP-") for r in pg.evaluate("window.ROLLING_OAK_MOCK.pushed || []")))
    pg.evaluate(f"localStorage.setItem('t-online','1'); localStorage.setItem('ro-test-ref', JSON.stringify({{ref: '{tmp}'}}))")
    pg.reload(); pg.wait_for_timeout(3500)
    ids2 = mine(pg, "Offline test C"); pend2 = pg.evaluate("JSON.parse(localStorage.getItem('ro-pending-sync') || '[]')")
    rec = pg.evaluate("App.all.find(x => x.object_type === 'Offline test C') || {}")
    chk("N8 on sync the server assigns a real number", ids2 == ["DPG-001"], ids2)
    chk("N9 local record keeps the temp id for reference", rec.get("temp_id") == tmp, rec.get("temp_id"))
    chk("N10 pending list updated (nothing left)", pend2 == [], pend2)
    chk("N11 local references remapped", tmp not in pg.evaluate("localStorage.getItem('ro-test-ref')") and "DPG-001" in pg.evaluate("localStorage.getItem('ro-test-ref')"))
    chk("N12 pushed with the real number", any(r.get("catalog_id") == "DPG-001" for r in pg.evaluate("window.ROLLING_OAK_MOCK.pushed || []")))
    pg.screenshot(path=O + "f-offline-renumbered.png"); c.close()
    # 4. friendly AI messages
    for code, want, n in [("ai_no_credits", "unavailable right now", "A1 no-credits"), ("ai_daily_cap", "today's AI limit", "A2 daily cap"), ("sign_in_required", "Sign in to use AI", "A3 signed out")]:
        m = dict(OWNER, aiError={"error": "You've reached today's AI limit (50 analyses)." if code == "ai_daily_cap" else "provider said 429 insufficient_quota", "code": code})
        c, pg = ctx(b, m); pg.goto(U + "#/record/ELG-001"); pg.wait_for_selector(".rv-layout", timeout=15000); pg.wait_for_timeout(800)
        pg.click("#tab-2"); pg.wait_for_timeout(500)
        if pg.locator("#aiRun").count(): pg.click("#aiRun"); pg.wait_for_timeout(1200); t = pg.inner_text("#aiBody")
        else: t = ""
        chk(f"{n}: friendly message", want in t and "insufficient_quota" not in t and "failed" not in t.lower(), t[:140])
        if code == "ai_no_credits": pg.screenshot(path=O + "f-ai-unavailable.png")
        c.close()
    # 5. lock screen: signed out, private find (present in bundled data only when a fixture is used)
    c, pg = ctx(b, None); pg.goto(U + "#/find/ELG-018"); pg.wait_for_timeout(4000)
    t = pg.inner_text("#view-find") if pg.locator("#view-find").count() else ""
    chk("L1 lock screen shown", "isn't public" in t, t[:120])
    chk("L2 lock screen has no title/details", "chalcedony" not in t.lower() and "ELG-018" not in t and "chalcedony" not in pg.title().lower(), (t[:120], pg.title()))
    pg.screenshot(path=O + "f-lock-screen.png"); c.close()
    print("errors", errs[:3]); chk("no page errors", not errs, errs[:3])
    print("FAILS", fails)
