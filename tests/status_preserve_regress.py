"""Status workflow regression: status changes ONLY when the owner explicitly picks it.
Plain edit + Save changes, Keep on the review screen and adding a measurement keep the current status (no auto-promote, no auto-demote);
choosing Reviewed in the Status control promotes; cloud pushes carry the unchanged status. Usage: python3 tests/status_preserve_regress.py URL"""
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"}, "adminUserId": "u1",
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": True}], "members": {"c1": {"members": [], "invites": []}}, "comments": []}
DRAFT, REVIEWED = "ELG-020", "ELG-017"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx = b.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(OWNER)); pg.add_init_script("window.confirm=()=>true")
    pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(800)
    st = lambda id: pg.evaluate(f"(App.all.find(x=>x.catalog_id==='{id}')||{{}}).status||'Draft'")
    pushed = lambda id: pg.evaluate(f"(window.ROLLING_OAK_MOCK.pushed||[]).filter(x=>x.catalog_id==='{id}').map(x=>x.status||'Draft')")
    def edit_save(id, note, status=None, length=None):
        pg.goto(U + "#/record/" + id); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(400); pg.click("#tab-3"); pg.wait_for_timeout(400)
        pg.fill("#reviewForm [name=owner_observations]", note)
        if length: pg.fill("#reviewForm [name=length_mm]", length)
        if status: pg.select_option("#reviewForm select[name=status]", status)
        btn = pg.locator("#reviewForm .wiz-nav .btn.primary"); label = btn.inner_text(); btn.click(); pg.wait_for_timeout(1000); pg.keyboard.press("Escape"); return label
    def keep(id):
        pg.goto(U + "#/record/" + id); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(500)
        k = pg.locator("[data-rv=keep]"); (k.first.click() if k.count() else pg.locator(".corr [data-corr=keep]").first.click()); pg.wait_for_timeout(900); pg.keyboard.press("Escape")
    chk("Draft fixture starts Draft", st(DRAFT) == "Draft", st(DRAFT)); chk("Reviewed fixture starts Reviewed", st(REVIEWED) == "Reviewed", st(REVIEWED))
    lab = edit_save(DRAFT, "test edit 1"); chk("save button says Save changes", lab.strip() == "Save changes", lab)
    chk("edit Draft + save -> stays Draft", st(DRAFT) == "Draft", st(DRAFT)); chk("cloud push keeps Draft", pushed(DRAFT) and set(pushed(DRAFT)) == {"Draft"}, str(pushed(DRAFT)))
    edit_save(DRAFT, "test edit 2", length="~62"); chk("add measurement -> stays Draft", st(DRAFT) == "Draft", st(DRAFT))
    keep(DRAFT); chk("Keep on review screen -> stays Draft", st(DRAFT) == "Draft", st(DRAFT))
    edit_save(DRAFT, "test edit 3", status="Reviewed"); chk("explicit Status=Reviewed -> Reviewed", st(DRAFT) == "Reviewed", st(DRAFT)); chk("cloud push carries Reviewed", "Reviewed" in pushed(DRAFT), str(pushed(DRAFT)))
    edit_save(REVIEWED, "test edit 4"); chk("edit Reviewed + save -> stays Reviewed", st(REVIEWED) == "Reviewed", st(REVIEWED))
    keep(REVIEWED); chk("Keep on Reviewed -> stays Reviewed", st(REVIEWED) == "Reviewed", st(REVIEWED))
    pg.reload(); pg.wait_for_selector(".card"); pg.wait_for_timeout(1000)
    chk("after reload: statuses persist", st(DRAFT) == "Reviewed" and st(REVIEWED) == "Reviewed" and st("ELG-018") == "Draft", f"{st(DRAFT)} {st(REVIEWED)} {st('ELG-018')}")
    chk("no page errors", not errs, str(errs[:3]))
print("FAILS", fails); sys.exit(1 if fails else 0)
