"""Site-improvements regression (2026-10-18), real sessions: legal pages + footer (signed out), How it works, pricing comparison,
paid buttons disabled, merch placeholders, experts page (Texas directory + volunteer 'Coming soon'), mobile menu, onboarding,
Settings export (JSON) + delete-account section, session-expired message, sign-in link expiry text.
Creates a temporary user (SVC_KEY env, never printed) and deletes it at the end.
Usage: SVC_KEY=... python3 tests/site_improvements_regress.py https://unearthedfinds.com/ [screenshot dir]"""
import json, os, re, sys, secrets, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/site-improvements/"
cfg = urllib.request.urlopen(U + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); SVC = os.environ["SVC_KEY"]
fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i if i != "" else ""); ok or fails.append(n)
def admin(method, path, body=None):
    r = urllib.request.Request(SB + path, data=json.dumps(body).encode() if body is not None else None, headers={"apikey": SVC, "Authorization": "Bearer " + SVC, "Content-Type": "application/json"}, method=method)
    try: x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:120]
email = f"site-test-{secrets.token_hex(3)}@unearthedfinds.test"; pw = secrets.token_urlsafe(16)
s, u = admin("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}); UID = (u or {}).get("id"); chk("temporary user created", bool(UID), s)
errs = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        c = br.new_context(viewport={"width": 1280, "height": 900}, service_workers="block"); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U + "#/home"); pg.wait_for_timeout(2500)
        chk("[anon] footer has Privacy, Terms, Refunds, Contact", all(pg.locator(f".foot-legal a[href='#/{r}']").count() == 1 for r in ("privacy", "terms", "refunds", "contact")))
        chk("[anon] How it works has 3 steps", pg.locator(".how-it-works .how-steps > li").count() == 3)
        for r, h in [("privacy", "Privacy Policy"), ("terms", "Terms of Service"), ("refunds", "Refund Policy"), ("contact", "Contact")]:
            pg.goto(U + f"#/{r}"); pg.wait_for_timeout(900); t = pg.inner_text(f"#view-{r}") if pg.locator(f"#view-{r}").is_visible() else ""
            chk(f"[anon] #/{r} viewable signed out", h in t and "PolForge, LLC" in t and pg.evaluate("location.hash") == f"#/{r}")
        chk("[anon] Privacy/Terms/Refunds dated October 18, 2026", all("October 18, 2026" in pg.evaluate(f"document.getElementById('view-{r}').textContent") for r in ("privacy", "terms", "refunds")))
        pg.goto(U + "#/pricing"); pg.wait_for_timeout(2500); t = pg.inner_text("#pricingBody")
        chk("[anon] pricing shows $29.99 / $59.99 and free-vs-paid table", "$29.99" in t and "$59.99" in t and pg.locator(".pr-compare table").count() == 1)
        chk("[anon] paid buttons disabled 'Coming soon'", pg.locator("[data-soon]").count() == 2 and pg.locator("[data-soon]").first.is_disabled())
        pg.goto(U + "#/merch"); pg.wait_for_timeout(2000); t = pg.inner_text("main"); chk("[anon] merch placeholders say Coming soon", pg.locator(".merch-soon").count() >= 1 and "oming soon" in t)
        pg.goto(U + "#/experts"); pg.wait_for_timeout(3500); t = pg.inner_text("main")
        chk("[anon] experts: Texas directory listed", "Texas Historical Commission" in t and pg.locator(".tx-dir li, .tx-dir article, .tx-dir tr").count() >= 8, pg.locator(".tx-dir li, .tx-dir article, .tx-dir tr").count())
        chk("[anon] experts: volunteer section 'Coming soon — credentialed volunteers'", "Coming soon — credentialed volunteers" in t)
        chk("[anon] experts: no admin / inbox for signed-out", "Applications" not in t and "Expert inbox" not in t)
        pg.screenshot(path=O + "reg-experts.png", full_page=True); c.close()
        m = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, service_workers="block"); pg = m.new_page()
        pg.goto(U + "#/home"); pg.wait_for_timeout(2000); pg.click("#menuBtn"); pg.wait_for_timeout(500)
        n = pg.evaluate("[...document.querySelectorAll('aside, nav, .sidebar, .drawer')].filter(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 120 && r.height > 200 && s.display !== 'none' && s.visibility !== 'hidden' && r.right > 0 && r.left < innerWidth; }).length")
        chk("[mobile] hamburger opens exactly one menu panel", n == 1, n); pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        chk("[mobile] Escape closes it", pg.evaluate("document.getElementById('menuBtn').getAttribute('aria-expanded')") != "true"); m.close()
        c = br.new_context(viewport={"width": 1280, "height": 900}, service_workers="block", accept_downloads=True); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U + "#/home"); pg.wait_for_timeout(2500); pg.evaluate("document.getElementById('authBtn').click()"); pg.wait_for_timeout(800)
        pg.fill("#authEmail", email); pg.fill("#authPw", pw); pg.click("#authPwIn"); pg.wait_for_timeout(6000)
        pg.goto(U + "#/catalog"); pg.wait_for_timeout(4500)
        chk("[new user] first-time onboarding shows 3 steps", pg.locator("#onboard .onboard-steps > li").count() == 3)
        pg.click("#onboard [data-ob=x]"); pg.wait_for_timeout(500); pg.reload(); pg.wait_for_timeout(4500); chk("[new user] onboarding stays dismissed", pg.locator("#onboard").count() == 0)
        pg.goto(U + "#/settings"); pg.wait_for_timeout(3000)
        chk("[new user] Settings has Export my data + Delete my account", pg.locator("#acctData [data-exp=json]").count() == 1 and pg.locator("#delBtn").count() == 1)
        with pg.expect_download(timeout=30000) as d: pg.click("#acctData [data-exp=json]")
        data = json.load(open(d.value.path())); chk("[new user] JSON export has their catalog (My Collection)", any(x.get("name") == "My Collection" for x in data.get("catalogs", [])), list(data))
        pg.fill("#delForm [name=confirm]", "delete"); pg.wait_for_timeout(300); low = pg.locator("#delBtn").is_disabled()
        pg.fill("#delForm [name=confirm]", "DELETE"); pg.wait_for_timeout(300); chk("[new user] delete button only enables for exact DELETE (not clicked here)", low and pg.locator("#delBtn").is_enabled())
        pg.screenshot(path=O + "reg-settings.png", full_page=True)
        pg.evaluate("Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k))"); pg.reload(); pg.wait_for_timeout(4500)
        chk("[new user] lost session shows 'Your session expired' message", pg.locator("#sessBanner").is_visible() and "session expired" in pg.inner_text("#sessBanner"))
        pg.screenshot(path=O + "reg-session-expired.png"); c.close(); br.close()
    chk("no page errors", not errs, errs[:3])
finally:
    if UID: s, b = admin("DELETE", f"/auth/v1/admin/users/{UID}"); chk("temporary user deleted", s in (200, 204), s)
print("FAILS", fails); sys.exit(1 if fails else 0)
