"""Review status regression: Review tab -> Status=Reviewed -> Save review must take the find out of Draft,
update card badge / filter / Reviewed count, survive a reload, and be pushed to the cloud row (mock) with status=Reviewed."""
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": True}], "members": {"c1": {"members": [], "invites": []}}, "comments": []}
IDS = sys.argv[2].split(",") if len(sys.argv) > 2 else ["ELG-020", "ELG-017"]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx = b.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(OWNER)); pg.add_init_script("window.confirm=()=>true")
    pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(800)
    st = lambda id: pg.evaluate(f"(App.all.find(x=>x.catalog_id==='{id}')||{{}}).status||'Draft'")
    for ID in IDS:
        kindsel = pg.evaluate(f"App.kindOf(App.all.find(x=>x.catalog_id==='{ID}'))")
        chk(f"{ID} starts Draft", st(ID) != "Reviewed", st(ID))
        pg.goto(U + "#/record/" + ID); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(400); pg.click("#tab-3"); pg.wait_for_timeout(400)
        pg.select_option("#reviewForm select[name=status]", "Reviewed"); pg.click("#reviewForm .wiz-nav .btn.primary"); pg.wait_for_timeout(1200)
        chk(f"{ID} Reviewed after save", st(ID) == "Reviewed", st(ID))
        pushed = pg.evaluate(f"(window.ROLLING_OAK_MOCK.pushed||[]).filter(x=>x.catalog_id==='{ID}').map(x=>x.status)")
        chk(f"{ID} cloud push carries status=Reviewed", "Reviewed" in pushed, str(pushed))
        pg.keyboard.press("Escape"); pg.goto(U + "#/catalog"); pg.wait_for_timeout(300)
        pg.evaluate(f"document.querySelector('.ctabs [data-kind={kindsel}], .ctabs [data-k={kindsel}]')?.click()"); pg.wait_for_timeout(400)
        badge = pg.evaluate(f"(()=>{{const c=[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('{ID}'));return c?c.querySelector('.badge')?.textContent:null}})()")
        chk(f"{ID} card badge Reviewed", badge and "Reviewed" in badge, str(badge))
        pg.reload(); pg.wait_for_selector(".card"); pg.wait_for_timeout(1200)
        chk(f"{ID} still Reviewed after reload", st(ID) == "Reviewed", st(ID))
    stats = pg.inner_text(".stats") if pg.locator(".stats").count() else ""
    chk("no page errors", not errs, str(errs[:3])); print("FAILS", fails); b.close()
