"""Batch 4: admin dashboard RPCs + analytics events (021), pay dig sites + kits (022), editor guard (023), free 5-private limit end to end,
membership contact note, print view, share link. API uses real temp accounts (deleted at the end; SVC_KEY never printed); UI uses the mocked cloud.
Usage: SVC_KEY=... python3 tests/batch4_regress.py <site URL> [config URL]"""
import json, os, re, sys, secrets, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8830/"; CU = sys.argv[2] if len(sys.argv) > 2 else U
cfg = urllib.request.urlopen(CU + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1); SVC = os.environ["SVC_KEY"]
fails, errs = [], []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i if i != "" else ""); ok or fails.append(n)
def call(method, path, body=None, tok=None, key=ANON, extra=None):
    h = {"apikey": key, "Authorization": "Bearer " + (tok or key), "Content-Type": "application/json", "Prefer": "return=representation"}; h.update(extra or {})
    r = urllib.request.Request(SB + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode()[:160]
def mkuser(domain="unearthedfinds.test"):
    email = f"b4-test-{secrets.token_hex(3)}@{domain}"; pw = secrets.token_urlsafe(16)
    s, u = call("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}, key=SVC)
    s, t = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw}); return u["id"], t["access_token"], email
UIDS = []
try:
    s, b = call("POST", "/rest/v1/rpc/admin_stats", {}); chk("[anon] admin_stats refused", s >= 400, s)
    s, b = call("POST", "/rest/v1/rpc/report_daily", {}); chk("[anon] report_daily refused", s >= 400, s)
    A, TA, EA = mkuser("example.com"); UIDS.append(A); B, TB, EB = mkuser(); UIDS.append(B)  # A: non-test domain so analytics events are recorded (removed at the end)
    s, b = call("POST", "/rest/v1/rpc/admin_stats", {}, tok=TA); chk("[free user] admin_stats refused (server side)", s >= 400, s)
    s, b = call("POST", "/rest/v1/rpc/admin_daily_series", {"p_days": 7}, tok=TA); chk("[free user] admin_daily_series refused", s >= 400, s)
    s, b = call("POST", "/rest/v1/rpc/report_daily", {}, tok=TA); chk("[free user] report_daily refused", s >= 400, s)
    s, b = call("GET", "/rest/v1/analytics_events?select=id&limit=1", tok=TA); chk("[free user] analytics_events unreadable", s >= 400 or b == [], s)
    s, b = call("GET", f"/rest/v1/analytics_events?select=kind&user_id=eq.{A}", key=SVC); chk("signup event recorded server side", any(x["kind"] == "signup" for x in b or []), b)
    s, b = call("GET", f"/rest/v1/analytics_events?select=kind&user_id=eq.{B}", key=SVC); chk("@unearthedfinds.test accounts excluded from analytics", b == [], b)
    # free 5-private limit end to end
    ids = []
    for i in range(5):
        s, b = call("POST", "/rest/v1/finds", {"owner": A, "visibility": "private", "object_type": f"test private {i}"}, tok=TA); ids.append((b or [{}])[0].get("catalog_id")) if s < 300 else None
    chk("[free] 5 private finds allowed", len([x for x in ids if x]) == 5, ids)
    s, b = call("POST", "/rest/v1/finds", {"owner": A, "visibility": "private", "object_type": "test 6th private"}, tok=TA); chk("[free] 6th private refused by the server", s >= 400 and "free_private_limit" in json.dumps(b), (s, b))
    s, b = call("POST", "/rest/v1/finds", {"owner": A, "visibility": "public", "object_type": "test 6th public"}, tok=TA); six = (b or [{}])[0].get("catalog_id") if s < 300 else None; chk("[free] 6th as public allowed", bool(six), (s, b))
    s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{six}", {"visibility": "private"}, tok=TA); chk("[free] public -> private refused", s >= 400 and "toggle_locked" in json.dumps(b), (s, b))
    s, b = call("GET", f"/rest/v1/analytics_events?select=kind&user_id=eq.{A}&kind=eq.find_added", key=SVC); chk("find_added events recorded (6)", len(b or []) == 6, len(b or []))
    s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{ids[0]}", {"visibility": "public"}, tok=TA)
    s, b = call("GET", f"/rest/v1/analytics_events?select=kind,meta&user_id=eq.{A}&kind=eq.visibility_change", key=SVC); chk("visibility change event recorded", len(b or []) == 1 and b[0]["meta"]["to"] == "public", b)
    # editor guard
    s, f = call("GET", f"/rest/v1/finds?select=collection_id&catalog_id=eq.{ids[1]}", key=SVC); cid = f[0]["collection_id"]
    if not cid:
        s, c = call("GET", f"/rest/v1/collections?select=id&owner=eq.{A}&limit=1", key=SVC); cid = c[0]["id"]; call("PATCH", f"/rest/v1/finds?owner=eq.{A}", {"collection_id": cid}, key=SVC)
    call("POST", "/rest/v1/collection_members", {"collection_id": cid, "user_id": B, "role": "editor"}, key=SVC)
    call("PATCH", f"/rest/v1/finds?catalog_id=eq.{ids[1]}", {"visibility": "editors"}, key=SVC)  # shared with catalog editors (still private)
    s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{ids[1]}", {"material": "chert (editor edit)"}, tok=TB); chk("[editor] can edit find details", s < 300 and b and b[0]["material"] == "chert (editor edit)", (s, b))
    s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{ids[1]}", {"visibility": "public"}, tok=TB); chk("[editor] can't change visibility (owner only)", s >= 400 and "owner_only" in json.dumps(b), (s, b))
    s, b = call("DELETE", f"/rest/v1/finds?catalog_id=eq.{ids[1]}", tok=TB); s2, left = call("GET", f"/rest/v1/finds?select=catalog_id&catalog_id=eq.{ids[1]}", key=SVC); chk("[editor] can't delete", left and len(left) == 1, (s, b))
    s, b = call("POST", "/rest/v1/find_locations", {"catalog_id": ids[1], "owner": B, "location": "x"}, tok=TB); chk("[editor] can't write locations", s >= 400, s)
    # admin (temp admin flag; removed with the account)
    call("PATCH", f"/rest/v1/profiles?id=eq.{A}", {"is_admin": True}, key=SVC)
    s, st = call("POST", "/rest/v1/rpc/admin_stats", {}, tok=TA); keys = {"signups_week", "recent_signups", "finds_today", "public", "private", "plans", "recent_grants", "ai_total", "questions_total", "errors_week", "since_last_visit"}
    chk("[admin] admin_stats returns the dashboard data", s == 200 and keys <= set(st or {}), (s, sorted(set(keys) - set(st or {})) if isinstance(st, dict) else st))
    chk("[admin] recent signups include emails", s == 200 and any(x["email"] == EA for x in st["recent_signups"]))
    s, se = call("POST", "/rest/v1/rpc/admin_daily_series", {"p_days": 30}, tok=TA); chk("[admin] daily series: 30 days", s == 200 and len(se) == 30 and se[-1]["finds"] >= 6, (s, se[-1] if isinstance(se, list) and se else se))
    s, b = call("POST", "/rest/v1/rpc/admin_mark_seen", {}, tok=TA); s2, b2 = call("POST", "/rest/v1/rpc/admin_set_prefs", {"p_daily": False, "p_signups": True}, tok=TA)
    s3, st2 = call("POST", "/rest/v1/rpc/admin_stats", {}, tok=TA); chk("[admin] prefs + last visit stored in the DB", s < 300 and s2 < 300 and st2["prefs"]["notify_daily_report"] is False and st2["prefs"]["last_seen_at"], st2.get("prefs") if isinstance(st2, dict) else st2)
    s, b = call("POST", "/rest/v1/rpc/report_daily", {}, tok=TA); chk("[admin JWT] report_daily still service-only", s >= 400, s)
    s, b = call("POST", "/rest/v1/rpc/log_client_error", {"p_msg": "batch4 test error", "p_where": "test"}, tok=TB); chk("client error logging accepted", s < 300, s)
    # pay dig + kits
    s, pd = call("GET", "/rest/v1/pay_dig_sites?select=*"); chk("[anon] pay dig sites readable (>= 25)", s == 200 and len(pd) >= 25, len(pd) if isinstance(pd, list) else pd)
    chk("pay dig rows: town-level area, source URL, verified date, fee rule", all(x["area"] and x["source_url"].startswith("http") and x["last_verified"] and (x["fee_note"] == "See operator site" or x["fee_note"].endswith("(per operator site, checked Oct 2026)")) for x in pd))
    s, b = call("POST", "/rest/v1/pay_dig_sites", {"slug": "x-test", "name": "x", "state": "X", "area": "x", "type": "Mixed", "url": "https://x", "source_url": "https://x"}, tok=TB); chk("[user] can't add pay dig sites", s >= 400, s)
    s, b = call("PATCH", "/rest/v1/pay_dig_sites?slug=eq.crater-of-diamonds", {"name": "hacked"}, tok=TB); chk("[user] can't edit pay dig sites", s >= 400 or b == [], (s, b))
    s, k = call("GET", "/rest/v1/products?select=name,price_cents,coming_soon&category=eq.kits", key=SVC); chk("4 Complete Kits stored as coming soon", len(k) == 4 and all(x["coming_soon"] for x in k), k)
finally:
    for u in UIDS: call("DELETE", f"/auth/v1/admin/users/{u}", key=SVC)
    call("DELETE", "/rest/v1/analytics_events?meta->>msg=eq.batch4%20test%20error", key=SVC)
    for u in UIDS: call("DELETE", f"/rest/v1/analytics_events?user_id=eq.{u}", key=SVC)  # test accounts don't count in the owner's stats
STATS = {"generated_at": "2026-10-18T22:00:00Z", "last_visit": "2026-10-17T15:00:00Z", "users": 2, "signups_today": 1, "signups_week": 1, "recent_signups": [{"email": "new.person@example.com", "created_at": "2026-10-18T14:00:00Z", "plan": "free"}],
         "finds_total": 35, "finds_today": 2, "finds_week": 5, "public": 14, "private": 21, "vis_changes_week": 1, "plans": {"free": 1, "lifetime": 1}, "recent_grants": [{"email": "new.person@example.com", "plan": "annual", "created_at": "2026-10-18T15:00:00Z", "note": "manual grant"}],
         "ai_today": 3, "ai_week": 9, "ai_total": 40, "questions_total": 2, "questions_open": 1, "questions_week": 1, "errors_week": 0, "recent_errors": [], "since_last_visit": {"signups": 1, "finds": 2, "questions": 0, "errors": 0}, "prefs": {"notify_daily_report": True, "notify_new_signups": True}}
SER = [{"day": f"2026-10-{d:02d}", "signups": d % 3 == 0, "finds": d % 4, "ai": d % 5, "questions": 0, "vis_changes": 0, "errors": 0} for d in range(1, 19)]
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "adminUserId": "u1", "profile": {"display_name": "Mark", "membership": "lifetime"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": True, "visibility": "public"}], "members": {"c1": {"members": [], "invites": []}}, "comments": [], "admin": {"stats": STATS, "series": SER}}
FREE = {"online": True, "user": {"id": "u2", "email": "f@example.com"}, "adminUserId": "u1", "profile": {"display_name": "F", "membership": "free"}, "collections": [], "members": {}, "comments": [], "admin": {"refuse": True}}
with sync_playwright() as p:
    br = p.chromium.launch()
    def page(mock=None, w=1280):
        ctx = br.new_context(viewport={"width": w, "height": 1000}, service_workers="block"); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        if mock: pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
        return pg
    pg = page(); pg.goto(U + "#/paydig"); pg.wait_for_selector("#pdList li", timeout=20000); pg.wait_for_timeout(800); t = pg.inner_text("#view-paydig"); n = pg.locator("#pdList li").count()
    chk("[anon] Pay Dig page: disclaimer", "Fees, hours, and rules change. Always confirm with the operator before visiting. UnEarthed Finds does not operate these sites." in t)
    chk("[anon] Pay Dig page lists >= 25 sites", n >= 25, n)
    pg.select_option("#pdState", "Wyoming"); pg.wait_for_timeout(300); chk("state filter (Wyoming)", pg.locator("#pdList li").count() == pg.locator("#pdList li[data-state=Wyoming]").count() >= 4)
    pg.select_option("#pdState", ""); pg.click('[data-pd-type="Fossils"]'); pg.wait_for_timeout(300); chk("type filter (Fossils)", 0 < pg.locator("#pdList li").count() == pg.locator('#pdList li[data-type="Fossils"]').count() < n)
    pg.click('[data-pd-type=""]'); pg.wait_for_timeout(300); pg.screenshot(path="/workspace/site-improvements/paydig.png", full_page=True)
    chk("nav: Pay dig sites link under Explore", pg.locator('a[href="#/paydig"]').count() >= 1)
    pg.goto(U + "#/merch"); pg.wait_for_selector("#merchKits .merch-card", timeout=20000); pg.wait_for_timeout(600); kt = pg.inner_text("#merchKits")
    chk("[anon] Complete Kits: 4 coming-soon kits", pg.locator("#merchKits .merch-card").count() == 4 and all(x in kt for x in ("Rockhounding Starter Kit", "Archaeology / Artifact Field Kit", "Fossil Prep / Cleaning Kit", "Kids Discovery Kit")) and kt.count("Coming soon") >= 4)
    chk("kits: note, no prices, no checkout buttons", "Kits will be assembled or drop-shipped later." in kt and "$" not in kt and pg.locator("#merchKits button").count() == 0)
    chk("shirts & hats still shown", pg.locator("#merchApparel").count() == 1 and "Trucker Hat" in pg.inner_text("#merchBody"))
    pg.locator("#merchBody").screenshot(path="/workspace/site-improvements/merch-kits.png")
    pg.goto(U + "#/membership"); pg.wait_for_timeout(2500); a = pg.locator("#prContact")
    chk("[anon] membership: 'Contact us to upgrade while Stripe is being set up' links to Contact", a.count() == 1 and a.get_attribute("href") == "#/contact" and "Contact us to upgrade while Stripe is being set up" in a.inner_text())
    chk("paid buttons still disabled", pg.locator("[data-soon]").count() >= 2 and all(pg.locator("[data-soon]").nth(i).is_disabled() for i in range(pg.locator("[data-soon]").count())))
    pg.context.close()
    pg = page(OWNER); pg.goto(U); pg.wait_for_timeout(2500); pg.goto(U + "#/admin"); pg.wait_for_selector("#admDash .adm-tile", timeout=20000); pg.wait_for_timeout(800); t = pg.inner_text("#admDash")
    chk("[owner] dashboard tiles + 6 charts", pg.locator("#admDash .adm-tile").count() == 7 and pg.locator("#admDash .adm-chart").count() == 6)
    chk("[owner] new-since-last-visit notice", "New since your last visit" in t and "1 new signup" in t and "2 new finds" in t)
    chk("[owner] recent signups with email + grants", "new.person@example.com" in pg.inner_text("#admSignups") and "annual" in pg.inner_text("#admGrants"))
    chk("[owner] Grant plan control present", pg.locator("#grantForm").count() == 1)
    chk("[owner] pay dig manager present", pg.locator("#pdAdmin [data-pd-edit]").count() >= 25)
    pg.click("#admPrefs button"); pg.wait_for_timeout(300); chk("[owner] prefs save calls admin_set_prefs", "admin_set_prefs" in json.dumps(pg.evaluate("window.ROLLING_OAK_MOCK.admin.calls || []")))
    pg.screenshot(path="/workspace/site-improvements/admin-dashboard.png", full_page=True)
    pg.goto(U + "#/catalogs"); pg.wait_for_selector("[data-print]", timeout=20000)
    with pg.context.expect_page() as pp: pg.click("[data-print]")
    pw_ = pp.value; pw_.wait_for_load_state(); pt = pw_.inner_text("body"); chk("[owner] print view lists finds, no locations", pw_.locator("tbody tr").count() >= 1 and "exact find locations are not included" in pt and not re.search(r"\d+\.\d{4,}", pt), pw_.locator("tbody tr").count())
    pw_.screenshot(path="/workspace/site-improvements/print-view.png"); pw_.close()
    chk("[owner] Share public catalog + Invite collaborator controls", pg.locator("[data-sharecat]").count() == 1 and pg.locator('.cat-actions a[href="#/members"]').count() == 1)
    pg.context.close()
    pg = page(FREE); pg.goto(U); pg.wait_for_timeout(2000); pg.goto(U + "#/admin"); pg.wait_for_timeout(2000); t = pg.inner_text("#view-admin") if pg.locator("#view-admin").is_visible() else ""
    chk("[free user] no dashboard", pg.locator("#admDash .adm-tile").count() == 0 and "new.person" not in t)
    chk("no page errors", not errs, errs[:3]); br.close()
print("FAILS", fails); sys.exit(1 if fails else 0)
