"""Landing/Home route regression (fresh profiles, no harness unless noted).
Signed out: no hash, '#/' and '#/home' show the dedicated landing (not the catalog grid); it has Sign in, Create account,
Explore finds (-> Discover) and the privacy note; logo links to #/home. Deep links (#/discover, #/find/ID, #/catalog) open directly.
Signed in (harness): no hash opens the catalog. Usage: python3 tests/landing_regress.py URL"""
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"}, "adminUserId": "u1",
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": False}], "members": {"c1": {"members": [], "invites": []}}, "comments": []}
def vis(pg, sel): return pg.locator(sel).first.is_visible() if pg.locator(sel).count() else False
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for w, h in [(1280, 900), (390, 844)]:
        for path in ["", "#/", "#/home"]:
            c = b.new_context(viewport={"width": w, "height": h}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(U + path); pg.wait_for_selector("#view-home .landing-word", state="visible", timeout=20000); pg.wait_for_timeout(2500)
            t = f"@{w} '{path or '(none)'}'"
            chk(f"landing shown {t}", vis(pg, "#view-home") and not vis(pg, "#view-catalog") and not vis(pg, "#grid"))
            chk(f"landing parts {t}", all(vis(pg, s) for s in ["[data-auth-open=signin]", "[data-auth-open=signup]", ".landing-explore a[href='#/discover']", "#view-home .privacy-note"]) and "Discover. Catalog. Preserve." in pg.locator("#view-home").text_content())
            if path == "":
                chk(f"logo links home {t}", pg.locator("a.brand, a.side-brand").first.get_attribute("href") == "#/home")
                pg.click(".landing-explore a"); pg.wait_for_timeout(1200); chk(f"Explore finds -> Discover {t}", vis(pg, "#view-discover"))
                pg.goto(U + "#/catalog"); pg.wait_for_timeout(1500); chk(f"#/catalog deep link {t}", vis(pg, "#grid") and not vis(pg, "#view-home"))
                pg.goto(U + "#/find/ELG-001"); pg.wait_for_timeout(2000); chk(f"#/find deep link {t}", vis(pg, "#view-find") and not vis(pg, "#view-home"))
                pg.goto(U + "share/ELG-002.html"); pg.wait_for_timeout(2500); chk(f"share link redirects to find {t}", "#/find/ELG-002" in pg.url and vis(pg, "#view-find"), pg.url)
                pg.goto(U + "#/discover"); pg.wait_for_timeout(1500); chk(f"#/discover deep link {t}", vis(pg, "#view-discover"))
            c.close()
        c = b.new_context(viewport={"width": w, "height": h}); c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(OWNER)); pg = c.new_page()
        c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
        pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(1500)
        chk(f"signed in, no hash -> catalog @{w}", vis(pg, "#grid") and not vis(pg, "#view-home"))
        chk(f"signed in logo -> catalog @{w}", pg.locator("a.brand, a.side-brand").first.get_attribute("href") == "#/catalog"); c.close()
    chk("no page errors", not errs, str(errs[:3]))
print("FAILS", fails); sys.exit(1 if fails else 0)
