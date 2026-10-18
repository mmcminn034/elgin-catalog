"""Plan guard regression (urgent fix 2026-10-18): a client can never put an account on Annual or Lifetime.
Real sessions against the live project. Creates a temporary user via the admin API (SVC_KEY env, never printed) whose signup
metadata claims a paid plan, then tries every client route to a paid plan (profile insert/update/upsert, RPCs, auth metadata,
?plan= URL, the Pricing buttons). Mark's account is only read. The temporary user is deleted at the end.
Usage: SVC_KEY=... python3 tests/plan_guard_regress.py https://unearthedfinds.com/ [screenshot dir]"""
import json, os, re, sys, secrets, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/security/"
MARK = "a4779d71-ff10-4c11-864d-c79f83214b00"
cfg = urllib.request.urlopen(U + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1); SVC = os.environ["SVC_KEY"]
fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i if i != "" else ""); ok or fails.append(n)
def call(method, path, body=None, tok=None, key=ANON, extra=None):
    h = {"apikey": key, "Authorization": "Bearer " + (tok or key), "Content-Type": "application/json", "Prefer": "return=representation"}; h.update(extra or {})
    r = urllib.request.Request(SB + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode()[:120]
def prof(uid): s, b = call("GET", f"/rest/v1/profiles?select=membership,membership_expires,is_admin,stripe_customer_id&id=eq.{uid}", key=SVC); return b[0] if b else None
FREE = lambda p: bool(p) and p["membership"] == "free" and not p["membership_expires"] and not p["is_admin"] and not p["stripe_customer_id"]
mark0 = prof(MARK); chk("Mark's account is Lifetime + admin (read only)", mark0 and mark0["membership"] == "lifetime" and mark0["is_admin"], mark0)
email = f"plan-test-{secrets.token_hex(3)}@unearthedfinds.test"; pw = secrets.token_urlsafe(16)
paid_meta = {"display_name": "Plan test (temporary)", "plan": "lifetime", "membership": "lifetime", "tier": "annual", "is_admin": True}
s, u = call("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": paid_meta}, key=SVC)
UID = u.get("id"); chk("temporary user created with paid-plan signup metadata", s in (200, 201) and UID, s)
try:
    chk("new profile defaults to Free despite plan/tier/membership metadata", FREE(prof(UID)), prof(UID))
    s, t = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw}); TOK = t["access_token"]
    tries = [("PATCH membership=lifetime", "PATCH", f"/rest/v1/profiles?id=eq.{UID}", {"membership": "lifetime"}),
             ("PATCH membership=annual + expiry", "PATCH", f"/rest/v1/profiles?id=eq.{UID}", {"membership": "annual", "membership_expires": "2099-01-01T00:00:00Z"}),
             ("PATCH is_admin=true", "PATCH", f"/rest/v1/profiles?id=eq.{UID}", {"is_admin": True}),
             ("PATCH stripe_customer_id", "PATCH", f"/rest/v1/profiles?id=eq.{UID}", {"stripe_customer_id": "cus_fake"}),
             ("upsert profile with lifetime", "POST", "/rest/v1/profiles?on_conflict=id", {"id": UID, "display_name": "x", "membership": "lifetime"}),
             ("rpc set_membership", "POST", "/rest/v1/rpc/set_membership", {"p_user": UID, "p_status": "lifetime", "p_expires": None}),
             ("rpc admin_grant_plan", "POST", "/rest/v1/rpc/admin_grant_plan", {"p_user": UID, "p_plan": "lifetime"}),
             ("rpc apply_membership_lapses", "POST", "/rest/v1/rpc/apply_membership_lapses", {})]
    for n, m, path, body in tries:
        ex = {"Prefer": "resolution=merge-duplicates,return=representation"} if "upsert" in n else None
        s, b = call(m, path, body, tok=TOK, extra=ex); chk(f"[client] {n} refused and plan still Free", FREE(prof(UID)), (s, str(b)[:90]))
    for n, tok in [("anon", None), ("other user", TOK)]:
        s, b = call("PATCH", f"/rest/v1/profiles?id=eq.{MARK}", {"membership": "free"}, tok=tok); chk(f"[{n}] can't change Mark's plan", prof(MARK) == mark0, s)
        s, b = call("POST", "/rest/v1/rpc/admin_grant_plan", {"p_user": MARK, "p_plan": "free"}, tok=tok); chk(f"[{n}] admin_grant_plan refused", s >= 400 and prof(MARK) == mark0, s)
    s, b = call("PUT", "/auth/v1/user", {"data": {"plan": "lifetime", "membership": "lifetime", "tier": "lifetime"}}, tok=TOK); chk("[client] editing own auth metadata to a paid plan has no effect", FREE(prof(UID)), s)
    with sync_playwright() as p:
        br = p.chromium.launch()
        for who in ("anon", "free user"):
            c = br.new_context(viewport={"width": 1280, "height": 900}, service_workers="block"); pg = c.new_page()
            if who == "free user":
                pg.goto(U + "#/home"); pg.wait_for_timeout(2500); pg.evaluate("document.getElementById('authBtn').click()"); pg.wait_for_timeout(800)
                pg.fill("#authEmail", email); pg.fill("#authPw", pw); pg.click("#authPwIn"); pg.wait_for_timeout(6000)
            pg.goto(U + "?plan=lifetime&tier=annual#/pricing"); pg.wait_for_timeout(4000)
            paid = pg.locator("#pricingBody .tier[data-plan=annual] button, #pricingBody .tier[data-plan=lifetime] button")
            chk(f"[{who} UI] Annual + Lifetime buttons are disabled 'Coming soon'", paid.count() == 2 and all(paid.nth(i).is_disabled() and "Coming soon" in paid.nth(i).inner_text() for i in range(2)))
            chk(f"[{who} UI] clear 'paid plans aren't available yet' message", "Paid plans aren't available yet" in pg.inner_text("#pricingBody"))
            pg.evaluate("document.querySelectorAll('#pricingBody .tier[data-plan=lifetime] button, #pricingBody .tier[data-plan=annual] button').forEach(b => { b.disabled = false; b.click(); })"); pg.wait_for_timeout(1200)
            chk(f"[{who} UI] forcing a paid button never opens sign-up", not pg.evaluate("document.getElementById('authDlg').open"))
            r = pg.evaluate("window.Billing ? Billing.checkout('lifetime').then(x => x.error) : 'none'"); chk(f"[{who} UI] Billing.checkout('lifetime') says coming soon", r == "coming_soon", r)
            if who == "free user":
                chk("[free user UI] plan shows Free (current), not Annual/Lifetime", pg.evaluate("Membership.plan()") == "free" and pg.locator("#pricingBody .tier.current").get_attribute("data-plan") == "free")
            pg.screenshot(path=O + f"plan-guard-{who.replace(' ', '-')}.png"); c.close()
        br.close()
    chk("temporary user still Free after every attempt", FREE(prof(UID)), prof(UID))
finally:
    if UID: s, b = call("DELETE", f"/auth/v1/admin/users/{UID}", key=SVC); chk("temporary user deleted", s in (200, 204), s)
    chk("Mark's account unchanged", prof(MARK) == mark0, prof(MARK))
print("FAILURES:", fails if fails else "none"); sys.exit(1 if fails else 0)
