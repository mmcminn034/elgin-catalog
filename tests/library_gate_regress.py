"""Reference Library is owner/admin only: hidden nav + route redirect when signed out or signed in as someone else; scoring still uses references."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8830/"
FAILS = []
def chk(n, ok, d=""): print(("PASS " if ok else "FAIL ") + n, d); (None if ok else FAILS.append(n))
CASES = {"signed out": None, "other user": {"adminUserId": "owner-1", "online": True, "user": {"id": "u2", "email": "x@example.com"}, "profile": {"membership": "free"}},
         "owner": {"adminUserId": "owner-1", "online": True, "user": {"id": "owner-1", "email": "m@example.com"}, "profile": {"membership": "member"}}}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for name, mock in CASES.items():
        for w in (1280, 390):
            ctx = b.new_context(viewport={"width": w, "height": 860}); pg = ctx.new_page()
            if mock: pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock))
            pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
            pg.goto(BASE + "#/library"); pg.wait_for_timeout(2500)
            admin = name == "owner"
            if w < 900: pg.click("#menuBtn"); pg.wait_for_timeout(200)
            vis = pg.locator("a[data-route=library]:visible").count() > 0
            chk(f"{name} @{w}: library nav {'shown' if admin else 'hidden'}", vis == admin)
            chk(f"{name} @{w}: route {'opens' if admin else 'redirects'}", ("#/library" in pg.url) == admin, pg.url.split("#")[-1])
            if w == 1280:
                pg.goto(BASE + "#/record/ELG-001"); pg.wait_for_timeout(2000)
                chk(f"{name}: confidence score still computed", pg.locator(".rv-conf").count() == 1 and pg.locator(".rv-ref").count() > 0)
            ctx.close()
print("FAILS", FAILS)
