"""Catalog member roles (mock cloud): a VIEWER of Mark's catalog reads but can't edit; an EDITOR can edit. Run against the test copy."""
import json, sys
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8831/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/security/viewer/"
fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
ROWS = [{"catalog_id": "ELG-021", "object_type": "Scraper", "category": "artifact", "status": "Draft", "visibility": "private", "collection_id": "cRO", "_owner": "mark", "photos": []},
        {"catalog_id": "ELG-022", "object_type": "Biface", "category": "artifact", "status": "Draft", "visibility": "private", "collection_id": "cRO", "_owner": "mark", "photos": []}]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for role in ["viewer", "editor"]:
        mock = {"user": {"id": "wife", "email": "wife@example.com"}, "online": True, "adminUserId": "mark", "finds": ROWS, "collections": [{"id": "cRO", "name": "Rolling Oak", "role": role, "owner": "mark"}]}
        c = b.new_context(viewport={"width": 1280, "height": 900}); c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U + "#/catalog"); pg.wait_for_timeout(3500)
        ids = pg.evaluate("App.all.map(r => r.catalog_id)"); chk(f"[{role}] sees exactly the shared catalog's finds", sorted(ids) == ["ELG-021", "ELG-022"], ids)
        chk(f"[{role}] Access.canEdit", pg.evaluate("Access.canEdit(App.all[0])") == (role == "editor"))
        pg.goto(U + "#/record/ELG-021"); pg.wait_for_timeout(1500)
        editable = pg.locator("#mBody [data-act]:visible, #mBody [contenteditable=true], #mBody select:visible, #mBody .rv-acts button:visible").count()
        chk(f"[{role}] record edit controls {'shown' if role == 'editor' else 'hidden'}", (editable > 0) == (role == "editor"), editable)
        pg.screenshot(path=O + f"{role}-record.png"); pg.keyboard.press("Escape")
        r = pg.evaluate("App.patch('ELG-021', { object_type: 'Changed' }).then(() => 'ok').catch(e => 'refused')")
        chk(f"[{role}] save {'allowed' if role == 'editor' else 'refused'}", (r == "ok") == (role == "editor"), r)
        pg.goto(U + "#/review"); pg.wait_for_timeout(1200); t = pg.inner_text("#view-review")
        chk(f"[{role}] Review queue {'has' if role == 'editor' else 'excludes'} the shared finds", ("ELG-021" in t or "Scraper" in t) == (role == "editor")); pg.screenshot(path=O + f"{role}-review.png")
        chk(f"[{role}] no page errors", not errs, errs); c.close()
    b.close()
print("FAILS", fails)
