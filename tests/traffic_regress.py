"""Traffic reporting (migration 028) browser regression: logger on app routes + static /reference/ pages, privacy rules,
owner exclusion, sign-up attribution and the admin Traffic section. No production writes (Supabase is routed to a stub).
Usage: python3 tests/traffic_regress.py [URL]   (serve the repo with python3 -m http.server)"""
import sys, json, glob, os
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8843/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, "" if ok else i); ok or fails.append(n)
REC = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "reference", "r", "*.html")))[0]; REC_NAME = os.path.basename(REC)
TRAFFIC = {"generated_at": "2026-11-13T17:00:00Z", "days": 30,
  "today": {"visits": 12, "visitors": 5}, "week": {"visits": 80, "visitors": 31, "funnel": {"visitors": 31, "try_visitors": 6, "guest_finds": 2, "signups": 1}, "top_pages": [{"path": "/reference/", "views": 20, "visitors": 9}]},
  "month": {"visits": 200, "visitors": 77, "funnel": {"visitors": 77, "try_visitors": 12, "guest_finds": 4, "signups": 2},
    "top_pages": [{"path": "/reference/r/", "views": 90, "visitors": 40}, {"path": "/#/try", "views": 15, "visitors": 12}],
    "top_referrers": [{"domain": "reddit.com", "visits": 40, "visitors": 30}, {"domain": "news.ycombinator.com", "visits": 10, "visitors": 9}],
    "campaigns": [{"source": "reddit", "medium": "social", "campaign": "launch", "visits": 35, "visitors": 28}],
    "top_records": [{"id": "ypm:ant-231217", "title": "11 projectile points", "kind": "artifact", "views": 14}],
    "signups_by_source": [{"source": "reddit / launch", "signups": 1}, {"source": "direct / unknown", "signups": 1}],
    "devices": {"mobile": 120, "desktop": 80}, "countries": [{"cc": "US", "visits": 190}]},
  "series": [{"day": f"2026-10-{d:02d}" if d <= 31 else f"2026-11-{d-31:02d}", "visits": d % 7, "visitors": d % 4} for d in range(15, 45)]}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    def ctx(mock=None, dnt=False, dev=False, rpc404=False):
        c = b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block"); calls = []
        if mock is not None: c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock))
        if dev: c.add_init_script("try{localStorage.setItem('uf-track-dev','1')}catch(e){}")
        if dnt: c.add_init_script("Object.defineProperty(Navigator.prototype,'doNotTrack',{get:()=>'1'})")
        def cap(r):
            u = r.request.url
            if "/rpc/track_view" in u or "/rpc/traffic_signup_source" in u:
                calls.append((u.split("/rpc/")[1], json.loads(r.request.post_data or "{}"), r.request.headers))
                return r.fulfill(status=404 if rpc404 else 204, body="")
            r.fulfill(status=200, content_type="application/json", body="[]")
        c.route("**/*.supabase.co/**", cap); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e))); return c, pg, calls
    mv = lambda pg: [x for x in (pg.evaluate("(window.ROLLING_OAK_MOCK||{}).traffic||[]") or [])]
    # ---- static SEO pages: real network call (dev flag), utm + referrer domain + record id ----
    c, pg, calls = ctx(dev=True)
    pg.goto(U + "reference/r/" + REC_NAME + "?utm_source=Reddit&utm_medium=social&utm_campaign=launch", referer="https://www.reddit.com/r/FossilHunting/comments/xyz?ref=1"); pg.wait_for_timeout(1500)
    tv = [x for x in calls if x[0] == "track_view"]
    chk("static record page logs one view", len(tv) == 1, calls)
    body = tv[0][1] if tv else {}
    chk("static: path collapsed + record id from meta", body.get("p_path", "").endswith("/reference/r/") and ":" in (body.get("p_rec") or ""), body)
    chk("static: utm sent, referrer reduced to domain", body.get("p_src") == "Reddit" and body.get("p_camp") == "launch" and body.get("p_ref") == "reddit.com", body)
    chk("static: only the public key, no cookies/credentials", tv and "apikey" in tv[0][2] and "authorization" not in tv[0][2] and "cookie" not in tv[0][2], tv[0][2] if tv else "")
    src = json.loads(pg.evaluate("localStorage.getItem('uf-src')") or "{}"); chk("landing source kept on device for sign-up attribution", src.get("s") == "Reddit" and src.get("r") == "reddit.com", src)
    chk("no cookies set", c.cookies() == [], c.cookies())
    pg.goto(U + "reference/"); pg.wait_for_timeout(1200); tv = [x for x in calls if x[0] == "track_view"]
    chk("static index page logs, no utm on later page", len(tv) == 2 and tv[1][1].get("p_path", "").endswith("/reference/") and "p_src" not in tv[1][1], tv[-1][1] if tv else "")
    c.close()
    # ---- not on non-production hosts without the dev flag ----
    c, pg, calls = ctx(); pg.goto(U + "reference/"); pg.wait_for_timeout(1200); chk("dev/test hosts don't log by default", not calls, calls); c.close()
    # ---- missing RPC (028 not applied): one quiet attempt per session ----
    c, pg, calls = ctx(dev=True, rpc404=True); pg.goto(U + "reference/"); pg.wait_for_timeout(1000); pg.goto(U + "reference/artifacts.html"); pg.wait_for_timeout(1000)
    chk("028 missing: stops after the first 404 this session", len(calls) == 1, calls); c.close()
    # ---- DNT ----
    c, pg, calls = ctx(dev=True, dnt=True); pg.goto(U + "reference/?utm_source=x"); pg.wait_for_timeout(1200)
    chk("Do Not Track: nothing sent, nothing stored", not calls and pg.evaluate("localStorage.getItem('uf-src')") is None, calls); c.close()
    # ---- app routes (mock) ----
    c, pg, _ = ctx({"online": True, "user": None}); pg.goto(U + "?utm_source=hn&utm_campaign=launch#/"); pg.wait_for_timeout(3500); land = [x[1] for x in mv(pg) if x[0] == "track_view"]
    chk("app: home landing with utm", land and land[0]["p_path"] == "/" and land[0].get("p_src") == "hn" and land[0].get("p_camp") == "launch", land[:1])
    pg.goto(U + "#/try"); pg.wait_for_timeout(500); pg.goto(U + "#/try/new"); pg.wait_for_timeout(500); pg.goto(U + "#/discover/ELG-009"); pg.wait_for_timeout(500)
    pg.goto(U + "#/reference/ypm%3Aant-231217"); pg.wait_for_timeout(800); pg.goto(U + "#access_token=SECRETTOKEN&type=magiclink"); pg.wait_for_timeout(800)
    v = [x[1] for x in mv(pg) if x[0] == "track_view"]; paths = [x["p_path"] for x in v]
    chk("app: Try it free routes logged", "/#/try" in paths and "/#/try/new" in paths, paths)
    chk("app: deep app segments dropped (no find ids)", "/#/discover" in paths and not any("ELG-009" in x for x in paths), paths)
    chk("app: reference record view carries record id", any(x["p_path"] == "/#/reference/record" and x.get("p_rec") == "ypm:ant-231217" for x in v), v)
    chk("app: magic-link token never sent", "SECRETTOKEN" not in json.dumps(v), paths)
    chk("app: no duplicate consecutive views", all(paths[i] != paths[i + 1] or v[i].get("p_rec") != v[i + 1].get("p_rec") for i in range(len(paths) - 1)), paths)
    c.close()
    # ---- refcatalog card click (history.replaceState, no hashchange) is still counted ----
    # ---- owner is never counted, on the app or the static pages ----
    OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "adminUserId": "u1", "profile": {"display_name": "Mark", "membership": "lifetime"}, "collections": [], "members": {}, "comments": [],
             "admin": {"stats": {"users": 2, "since_last_visit": {}, "plans": {}, "prefs": {}}, "series": [], "traffic": TRAFFIC}}
    c, pg, calls = ctx(OWNER, dev=True); pg.goto(U); pg.wait_for_timeout(3500); pg.goto(U + "#/discover"); pg.wait_for_timeout(500)
    chk("owner's app visits not logged", not [x for x in mv(pg) if x[0] == "track_view"], mv(pg))
    chk("owner flag remembered on this device", pg.evaluate("localStorage.getItem('uf-owner')") == "1")
    pg.goto(U + "reference/"); pg.wait_for_timeout(1200); chk("owner's static-page visits not logged", not calls, calls)
    # ---- admin Traffic section ----
    pg.goto(U); pg.wait_for_timeout(2500); pg.goto(U + "#/admin"); pg.wait_for_selector("#admTraffic .adm-tile", timeout=20000); t = pg.inner_text("#admTraffic")
    chk("Traffic: today / 7 / 30 day tiles", pg.locator("#admTraffic .adm-tile").count() == 3 and "12 / 5" in t and "80 / 31" in t and "200 / 77" in t, t[:300])
    chk("Traffic: daily charts (visits + visitors)", pg.locator("#admTraffic .adm-chart").count() == 2)
    chk("Traffic: funnel visit → try → guest find → sign-up", pg.locator("#admFunnel li").count() == 4 and "opened Try it free" in t and "signed up" in t, pg.inner_text("#admFunnel"))
    chk("Traffic: top pages / referrers / campaigns / records / sign-ups by source", all(pg.locator(s).count() == 1 for s in ("#admTopPages", "#admTopRefs", "#admCampaigns", "#admTopRecords", "#admSignupSrc"))
        and "reddit.com" in t and "11 projectile points" in t and "reddit / launch" in t and "Reference record (search page)" in t, t)
    pg.click("[data-twin=week]"); pg.wait_for_timeout(200); t2 = pg.inner_text("#admTraffic"); chk("Traffic: 7-day toggle", "last 7 days" in t2 and "Reference Catalog (search page)" in t2, t2[:200])
    pg.locator("#admTraffic").screenshot(path="/tmp/traffic_admin.png")
    c.close()
    om = json.loads(json.dumps(OWNER)); om["admin"].pop("traffic")
    c, pg, _ = ctx(om); pg.goto(U); pg.wait_for_timeout(2500); pg.goto(U + "#/admin"); pg.wait_for_selector("#admTrafficPending", timeout=20000)
    chk("Traffic: friendly note while 028 is pending; rest of dashboard intact", "update 028" in pg.inner_text("#admTrafficPending") and pg.locator("#admDash .adm-tile").count() >= 6); c.close()
    # ---- non-admin never sees Traffic ----
    FREE = {"online": True, "user": {"id": "u2", "email": "f@example.com"}, "adminUserId": "u1", "profile": {"display_name": "F", "membership": "free"}, "collections": [], "members": {}, "comments": [], "admin": {"refuse": True, "traffic": TRAFFIC}}
    c, pg, _ = ctx(FREE); pg.goto(U); pg.wait_for_timeout(2500); pg.goto(U + "#/admin"); pg.wait_for_timeout(2000)
    chk("free user: no Traffic section", pg.locator("#admTraffic").count() == 0); c.close()
    # ---- sign-up attribution: new signed-in user with a stored landing source sends it once ----
    NEWU = {"online": True, "user": {"id": "u9", "email": "n@example.com"}, "adminUserId": "u1", "profile": {"display_name": "N", "membership": "free"}, "collections": [], "members": {}, "comments": []}
    c, pg, _ = ctx(NEWU); c.add_init_script("try{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('uf-src', JSON.stringify({s:'reddit',m:'social',c:'launch',r:'reddit.com',t:Date.now()}))}}catch(e){}")
    pg.goto(U); pg.wait_for_timeout(3500); s1 = [x for x in mv(pg) if x[0] == "traffic_signup_source"]
    chk("sign-up source sent for a signed-in account", len(s1) == 1 and s1[0][1]["p_src"] == "reddit" and s1[0][1]["p_ref"] == "reddit.com", s1)
    pg.reload(); pg.wait_for_timeout(3000); chk("…and only once per account", not [x for x in mv(pg) if x[0] == "traffic_signup_source"]); c.close()
    b.close()
chk("no page errors", not errs, errs[:5])
print(f"{len(fails)} FAILED: {fails}" if fails else "ALL PASS"); sys.exit(1 if fails else 0)
