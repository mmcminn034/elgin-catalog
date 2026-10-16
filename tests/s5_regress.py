"""S5 regression: status progression, per-find Discover toggle + bulk, measurement sources. Mocked cloud (window.ROLLING_OAK_MOCK).
Usage: python3 tests/s5_regress.py URL [screenshot_dir]"""
import sys, json, os
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; SS = sys.argv[2] if len(sys.argv) > 2 else ""; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": False}], "members": {"c1": {"members": [], "invites": []}}, "comments": []}
DISC = [{"catalog_id": "ELG-001", "category": "artifact", "object_type": "Stemmed dart point", "material": "Edwards chert", "era": "Archaic", "region": "Bastrop County, Texas", "suggestion_1": "Dart point (Moderate)", "confidence": "Moderate", "status": "Reviewed", "length_mm": "62", "length_source": "measured", "thumb": "images/ELG-001/01_thumb.jpg", "verified": True},
        {"catalog_id": "ELG-002", "category": "artifact", "object_type": "Corner-notched dart point", "material": "Chert", "era": "Archaic", "region": "Bastrop County, Texas", "suggestion_1": "Corner-notched dart (Moderate)", "confidence": "Moderate", "status": "Reviewed", "thumb": "images/ELG-002/01_thumb.jpg"},
        {"catalog_id": "ELG-003", "category": "artifact", "object_type": "Triangular biface", "material": "Chert", "era": "Undetermined", "region": "Bastrop County, Texas", "suggestion_1": "Biface (Low-moderate)", "confidence": "Low-moderate", "status": "Draft", "thumb": "images/ELG-003/01_thumb.jpg"},
        {"catalog_id": "ELG-005", "category": "artifact", "object_type": "Large biface", "material": "Chert", "era": "Undetermined", "region": "Bastrop County, Texas", "status": "Draft", "thumb": "images/ELG-005/01_thumb.jpg"}]
def page(b, mock, w=1280, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); pg.add_init_script("window.confirm=()=>true")
    pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]")); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.wait_for_timeout(900); return ctx, pg
def rec(pg, id, k="status"): return pg.evaluate(f"(App.all.find(x=>x.catalog_id==='{id}')||{{}})['{k}']")
def openr(pg, id, tab=0):
    pg.goto(U + "#/record/" + id); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(300)
    if tab: pg.click(f"#tab-{tab}"); pg.wait_for_timeout(350)
def shot(pg, name, sel=None):
    if not SS: return
    os.makedirs(SS, exist_ok=True); p = os.path.join(SS, name)
    (pg.locator(sel).first.screenshot(path=p) if sel else pg.screenshot(path=p)); print("shot", p)
def clip(pg, name, a, b):
    if not SS: return
    A = pg.locator(a).first.bounding_box(); B = pg.locator(b).first.bounding_box(); x = min(A["x"], B["x"]) - 10; y = max(0, A["y"] - 10)
    w = max(A["x"] + A["width"], B["x"] + B["width"]) - x + 10; h = B["y"] + B["height"] - y + 10; p = os.path.join(SS, name); pg.screenshot(path=p, clip={"x": x, "y": y, "width": w, "height": min(h, 1200)}); print("shot", p)
def fullclip(pg, name, a, b):
    if not SS: return
    A = pg.evaluate(f"(()=>{{const r=document.querySelector('{a}').getBoundingClientRect();return [r.top+scrollY,r.left]}})()")
    B = pg.evaluate("(()=>{const r=[...document.querySelectorAll('#grid .card')][2].getBoundingClientRect();return [r.bottom+scrollY,r.right]})()")
    p = os.path.join(SS, name); pg.screenshot(path=p, full_page=True, clip={"x": 0, "y": A[0] - 20, "width": 1280, "height": min(B[0] - A[0] + 40, 1400)}); print("shot", p)
pushed = lambda pg, id: pg.evaluate(f"(window.ROLLING_OAK_MOCK.pushed||[]).filter(x=>x.catalog_id==='{id}').map(x=>x.status)")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx, pg = page(b, OWNER)
    # ---- 1. status ----
    for o in ["Draft", "Needs review", "Reviewed", "Verified", "_needs"]:
        chk(f"filter option {o}", pg.locator(f"#fStatus option[value='{o}']").count() == 1 or pg.locator(f"#fStatus option:text-is('{o}')").count() == 1)
    stats = pg.inner_text("#stats"); chk("stats has Needs review count", "needs review" in stats.lower(), stats.replace("\n", " "))
    chk("cards flagged needs review", pg.locator(".card.needs .needs-flag").count() > 0, str(pg.locator(".card.needs").count()))
    if SS:
        pg.select_option("#fStatus", "_needs"); pg.wait_for_timeout(300); fullclip(pg, "status-list-needs-review.png", "#stats", "#grid .card >> nth=2"); pg.select_option("#fStatus", ""); pg.wait_for_timeout(200)
    openr(pg, "ELG-020"); chk("detail: Mark as Reviewed button", pg.locator("[data-s5-bar] [data-s5-status=Reviewed]").count() == 1)
    chk("panel: Mark as Reviewed button", pg.locator(".corr [data-s5-status=Reviewed]").count() == 1)
    shot(pg, "status-detail-and-panel.png", "#modal .modal-card, #modal [role=dialog], #modal"); shot(pg, "status-review-panel.png", ".corr")
    pg.click("[data-s5-bar] [data-s5-status=Reviewed]"); pg.wait_for_timeout(900)
    chk("detail button -> Reviewed", rec(pg, "ELG-020") == "Reviewed", rec(pg, "ELG-020")); chk("pushed Reviewed to cloud", "Reviewed" in pushed(pg, "ELG-020"), str(pushed(pg, "ELG-020")))
    openr(pg, "ELG-021"); pg.click(".corr [data-s5-status=Reviewed]"); pg.wait_for_timeout(900); chk("panel button -> Reviewed", rec(pg, "ELG-021") == "Reviewed", rec(pg, "ELG-021"))
    openr(pg, "ELG-022", 3); pg.click("#reviewForm .wiz-nav .btn.primary"); pg.wait_for_timeout(1000); chk("Save changes keeps Draft (no auto-promote)", rec(pg, "ELG-022") != "Reviewed", rec(pg, "ELG-022"))
    openr(pg, "ELG-025", 3); pg.select_option("#reviewForm select[name=status]", "Needs review"); pg.click("#reviewForm .wiz-nav .btn.primary"); pg.wait_for_timeout(1000)
    chk("explicit Needs review is kept", rec(pg, "ELG-025") == "Needs review", rec(pg, "ELG-025"))
    openr(pg, "ELG-023"); k = pg.locator(".corr [data-corr=keep]")
    if k.count(): k.first.click(); pg.wait_for_timeout(900)
    chk("Keep on a main field keeps Draft (no auto-promote)", rec(pg, "ELG-023") != "Reviewed", rec(pg, "ELG-023"))
    openr(pg, "ELG-021"); chk("Verified option offered once Reviewed", pg.locator("[data-s5-status=Verified]").count() == 1)
    pg.click("[data-s5-status=Verified]"); pg.wait_for_timeout(800); chk("-> Verified", rec(pg, "ELG-021") == "Verified")
    pg.keyboard.press("Escape"); pg.goto(U + "#/catalog"); pg.wait_for_timeout(300)
    pg.click(".ctab[data-kind=rock]"); pg.wait_for_timeout(300); pg.select_option("#fStatus", "Verified"); pg.wait_for_timeout(300); chk("Verified filter", "ELG-021" in pg.inner_text("#grid")); pg.click(".ctab[data-kind=artifact]"); pg.wait_for_timeout(300)
    pg.select_option("#fStatus", "_needs"); pg.wait_for_timeout(300); g = pg.inner_text("#grid"); chk("needs filter excludes reviewed", "ELG-020" not in g and "ELG-021" not in g and "ELG-022" in g)
    cloud_rows = pg.evaluate("(()=>{const m={};(window.ROLLING_OAK_MOCK.pushed||[]).forEach(r=>m[r.catalog_id]={...(m[r.catalog_id]||{}),...r});return Object.values(m)})()")
    pushed_before_reload = cloud_rows
    pg.select_option("#fStatus", ""); pg.reload(); pg.wait_for_selector(".card"); pg.wait_for_timeout(1000); chk("persists after reload", rec(pg, "ELG-020") == "Reviewed" and rec(pg, "ELG-025") == "Needs review")
    # ---- 2. Discover ----
    openr(pg, "ELG-024"); chk("Discover toggle shown with general area", pg.locator("[data-s5-disc]").count() == 1 and "general area only" in pg.inner_text(".s5-disc"))
    chk("toggle text has no coordinates", not __import__("re").search(r"-?\d{2}\.\d{3,}", pg.inner_text(".s5-disc")))
    was = rec(pg, "ELG-024", "visibility"); pg.check("[data-s5-disc]"); pg.wait_for_timeout(900)
    chk("toggle on -> show_on_discover + public", rec(pg, "ELG-024", "show_on_discover") is True and rec(pg, "ELG-024", "visibility") == "public")
    chk("cloud setDiscover called", pg.evaluate("(window.ROLLING_OAK_MOCK.discoverSet||{})['ELG-024']") is True)
    pg.uncheck("[data-s5-disc]"); pg.wait_for_timeout(900); chk("toggle off restores visibility", rec(pg, "ELG-024", "visibility") == (was or "public") and not rec(pg, "ELG-024", "show_on_discover"), f"{was} -> {rec(pg, 'ELG-024', 'visibility')}")
    pg.keyboard.press("Escape"); pg.goto(U + "#/catalog"); pg.wait_for_timeout(300); chk("bulk button visible to owner", pg.is_visible("#s5BulkBtn"))
    pg.click("#s5BulkBtn"); pg.wait_for_selector("#s5Bulk[open]"); pg.check("#s5Bulk input[value='ELG-030']"); pg.check("#s5Bulk input[value='ELG-031']"); pg.click("#s5Bulk [data-apply]"); pg.wait_for_timeout(1500)
    chk("bulk select applied", rec(pg, "ELG-030", "show_on_discover") is True and rec(pg, "ELG-031", "show_on_discover") is True)
    ctx.close()
    # fresh browser context = another device: cloud rows read back
    ctx2, pg2 = page(b, {**OWNER, "finds": pushed_before_reload})
    loc = pg2.evaluate("new Promise(r=>{const q=indexedDB.open('elgin-catalog');q.onsuccess=()=>{try{const g=q.result.transaction('finds').objectStore('finds').count();g.onsuccess=()=>r(g.result)}catch(e){r(0)}}})")
    chk("fresh context reads status from cloud (no local edits)", loc == 0 and rec(pg2, "ELG-020") == "Reviewed" and rec(pg2, "ELG-025") == "Needs review", f"local={loc} {rec(pg2, 'ELG-020')}, {rec(pg2, 'ELG-025')}"); ctx2.close()
    # signed-out visitor sees mocked Discover rows
    ctx3, pg3 = page(b, {"online": True, "user": None, "discover": DISC}); pg3.goto(U + "#/discover"); pg3.wait_for_selector(".dcard"); pg3.wait_for_timeout(600)
    t = pg3.inner_text("#discoverBody"); chk("mocked Discover shows public finds", pg3.locator(".dcard").count() == 4, str(pg3.locator(".dcard").count()))
    chk("Discover region coarse only", "Bastrop County, Texas" in t and not __import__("re").search(r"-?\d{2}\.\d{3,}", t)); chk("no bulk button for visitor", not pg3.is_visible("#s5BulkBtn"))
    pg3.evaluate("document.querySelector('#discoverBody').insertAdjacentHTML('afterbegin','<p class=\"tip\"><strong>MOCKED DATA</strong>: preview of Discover after migration 008 + seed (ELG-001, 002, 003, 005). Not live.</p>')")
    shot(pg3, "discover-mocked.png"); ctx3.close()
    # ---- 3. measurements ----
    ctx4, pg4 = page(b, OWNER, 1280, 1300); openr(pg4, "ELG-027", 2); chk("scaled-photo tip on estimate-only find", pg4.locator(".s5-scale").count() == 1 and "ruler" in pg4.inner_text(".s5-scale"))
    openr(pg4, "ELG-027", 3); f = "#reviewForm"
    chk("ruler-in-photo options", pg4.locator(f + " [name=width_source] option[value='ruler:2']").count() == 1)
    pg4.fill(f + " [name=length_mm]", "86"); pg4.select_option(f + " [name=length_source]", "measured"); pg4.select_option(f + " [name=width_source]", "ruler:2"); pg4.fill(f + " [name=width_mm]", "~61")
    chk("measured field styled distinctly", pg4.get_attribute(f + " [name=length_mm] >> xpath=ancestor::label", "data-src") == "measured" and pg4.get_attribute(f + " [name=width_mm] >> xpath=ancestor::label", "data-src") == "ruler")
    pg4.locator("#reviewForm [name=measure_method]").scroll_into_view_if_needed(); pg4.wait_for_timeout(300); clip(pg4, "measurement-fields.png", "#reviewForm .unit-bar", "#reviewForm [name=measure_method]")
    pg4.click(f + " .wiz-nav .btn.primary"); pg4.wait_for_timeout(1100)
    chk("measured -> measure_method=Measured", rec(pg4, "ELG-027", "measure_method") == "Measured", rec(pg4, "ELG-027", "measure_method"))
    chk("~ estimate accepted", rec(pg4, "ELG-027", "width_mm") == "~61"); chk("ruler -> photo_estimate source", rec(pg4, "ELG-027", "width_source") == "photo_estimate")
    chk("ruler photo ref saved", json.loads(rec(pg4, "ELG-027", "measure_refs") or "{}").get("width") == 2, str(rec(pg4, "ELG-027", "measure_refs")))
    chk("counts as measured", pg4.evaluate("/^measured/i.test(App.all.find(x=>x.catalog_id==='ELG-027').measure_method)"))
    openr(pg4, "ELG-027", 1); chk("ruler chip on Measurements tab", "ruler in photo #2" in pg4.inner_text("#mBody")); chk("no scaled tip once measured", pg4.locator(".s5-scale").count() == 0)
    shot(pg4, "measurement-tab.png", "#mBody"); ctx4.close()
    chk("no page errors", not errs, str(errs[:3])); print("FAILS", fails); b.close()
