"""Security regression with REAL sessions against the live project (no data of Mark's is changed).
Creates a temporary second user through the Supabase admin API (SVC_KEY env, never printed), proves that signed-out
visitors and another account can't read or change Mark's private data (API + UI), then deletes the user.
Usage: SVC_KEY=... python3 tests/security_regress.py https://unearthedfinds.com/ [screenshot dir]"""
import json, os, re, sys, secrets, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/security/"
MARK = "a4779d71-ff10-4c11-864d-c79f83214b00"; PRIVATE_ID = "ELG-018"; PUBLIC_ID = "ELG-001"
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
denied = lambda s, b: s >= 400 or b == [] or b is None
email = f"sec-test-{secrets.token_hex(3)}@unearthedfinds.test"; pw = secrets.token_urlsafe(16)
s, u = call("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": {"display_name": "Security test (temporary)"}}, key=SVC)
UID = u.get("id"); chk("temporary second user created via admin API", s in (200, 201) and UID, s)
try:
    s, t = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw}); TOK = t["access_token"]
    for who, tok in [("anon", None), ("other user", TOK)]:
        s, b = call("GET", f"/rest/v1/finds?select=catalog_id&owner=eq.{MARK}", tok=tok); chk(f"[{who}] can't read Mark's finds rows", s == 200 and b == [], (s, len(b) if isinstance(b, list) else b))
        s, b = call("GET", f"/rest/v1/finds?select=catalog_id&catalog_id=eq.{PRIVATE_ID}", tok=tok); chk(f"[{who}] private find invisible", b == [], b)
        s, b = call("GET", f"/rest/v1/photos?select=catalog_id&catalog_id=eq.{PRIVATE_ID}", tok=tok); chk(f"[{who}] private find photos rows invisible", b == [], b)
        s, b = call("GET", "/rest/v1/find_locations?select=*", tok=tok); chk(f"[{who}] no exact locations", denied(s, b), s)
        s, b = call("GET", "/rest/v1/discover_finds?select=catalog_id,public_id", tok=tok); chk(f"[{who}] Discover lists the public finds (read-only)", s == 200 and len(b) >= 4 and all(x["public_id"] for x in b), len(b) if isinstance(b, list) else b)
        s, b = call("GET", f"/rest/v1/photos?select=catalog_id&catalog_id=eq.{PUBLIC_ID}", tok=tok); chk(f"[{who}] public find photos visible", s == 200 and len(b) > 0, len(b) if isinstance(b, list) else b)
        s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{PUBLIC_ID}", {"object_type": "HACKED"}, tok=tok); chk(f"[{who}] can't edit a public find of Mark's", denied(s, b), (s, b))
        s, b = call("PATCH", f"/rest/v1/finds?catalog_id=eq.{PRIVATE_ID}", {"object_type": "HACKED"}, tok=tok); chk(f"[{who}] can't edit a private find of Mark's", denied(s, b), (s, b))
        s, b = call("DELETE", f"/rest/v1/finds?catalog_id=eq.{PUBLIC_ID}", tok=tok); chk(f"[{who}] can't delete Mark's find", denied(s, b), (s, b))
        s, b = call("DELETE", f"/rest/v1/photos?catalog_id=eq.{PUBLIC_ID}", tok=tok); chk(f"[{who}] can't delete Mark's photos", denied(s, b), (s, b))
        s, b = call("POST", "/rest/v1/photos", {"catalog_id": PUBLIC_ID, "sort": 99, "repo_path": "x.jpg", "is_public": True}, tok=tok); chk(f"[{who}] can't add photos to Mark's find", s >= 400, s)
        s, b = call("POST", "/rest/v1/find_locations", {"catalog_id": PRIVATE_ID, "lat": 1, "lon": 1}, tok=tok); chk(f"[{who}] can't write locations", s >= 400, s)
        s, b = call("POST", "/rest/v1/corrections", {"catalog_id": PUBLIC_ID, "field": "type", "old_value": "a", "new_value": "b"}, tok=tok); chk(f"[{who}] can't add corrections", s >= 400, s)
        s, b = call("POST", "/rest/v1/verified_examples", {"catalog_id": PUBLIC_ID, "owner": UID, "category": "artifact", "confirmed_type": "X"}, tok=tok); chk(f"[{who}] can't add verified examples", s >= 400, s)
        s, b = call("GET", f"/rest/v1/profiles?select=*&id=eq.{MARK}", tok=tok); chk(f"[{who}] can't read Mark's profile row", denied(s, b), s)
        s, b = call("POST", "/rest/v1/rpc/plan_of", {"u": MARK}, tok=tok); chk(f"[{who}] can't look up Mark's plan", s >= 400, s)
        s, b = call("POST", f"/storage/v1/object/sign/find-photos-private/{MARK}/ELG-017/00.jpg", {"expiresIn": 60}, tok=tok); chk(f"[{who}] can't sign a private photo URL", s >= 400, s)
        s, b = call("POST", f"/storage/v1/object/list/find-photos-private", {"prefix": MARK, "limit": 5}, tok=tok); chk(f"[{who}] can't list private photos", s >= 400 or b == [], (s, b if not isinstance(b, list) else len(b)))
        s, b = call("POST", f"/storage/v1/object/list/find-photos", {"prefix": MARK, "limit": 5}, tok=tok); chk(f"[{who}] can't list the public bucket", s >= 400 or b == [], (s, b if not isinstance(b, list) else len(b)))
    r = urllib.request.Request(SB + f"/storage/v1/object/public/find-photos/{MARK}/ELG-017/00.jpg")
    try: code = urllib.request.urlopen(r).status
    except urllib.error.HTTPError as e: code = e.code
    chk("old public-bucket URL of a private photo is gone", code >= 400, code)
    s, b = call("POST", f"/storage/v1/object/find-photos-private/{UID}/{PRIVATE_ID}/x.jpg", None, tok=TOK, extra={"Content-Type": "image/jpeg"}); chk("other user can't upload into Mark's find folder", s >= 400, s)
    s, b = call("GET", "/rest/v1/collections?select=name,owner", tok=TOK); chk("other user sees only their own catalog (My Collection), never Rolling Oak", isinstance(b, list) and [x["name"] for x in b] == ["My Collection"], b)
    # UI: signed-out visitor + other user
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        c = br.new_context(viewport={"width": 1280, "height": 900}, service_workers="block"); pg = c.new_page()
        pg.goto(U + "#/home"); pg.wait_for_timeout(2500)
        # simulate a visitor whose browser was seeded/edited by an older version: an edit copy of Mark's private find
        pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('elgin-catalog', 1); r.onupgradeneeded = () => r.result.createObjectStore('finds', { keyPath: 'catalog_id' });
            r.onsuccess = () => { const tx = r.result.transaction('finds', 'readwrite'); tx.objectStore('finds').put({ catalog_id: 'ELG-018', object_type: 'Banded chalcedony fragment', status: 'Draft' }); tx.oncomplete = res; }; })""")
        pg.reload(); pg.wait_for_timeout(4000)
        vis = lambda sel: pg.locator(sel).count() > 0 and pg.locator(sel).first.is_visible()
        hidden = [r for r in ["catalog", "review", "add", "settings", "experts", "catalogs"] if vis(f'aside a[data-route="{r}"], .side a[data-route="{r}"]')]
        chk("[anon UI] no Catalog/Review/Add/Settings/Experts/New catalog in the nav", not hidden and not vis("a.add-cta"), hidden)
        left = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('elgin-catalog', 1); r.onsuccess = () => { const q = r.result.transaction('finds').objectStore('finds').getAll(); q.onsuccess = () => res(q.result.map(x => x.catalog_id)); }; })""")
        chk("[anon UI] old seeded copy of Mark's find removed from this browser", "ELG-018" not in left, left)
        chk("[anon UI] no finds in the app's catalog data", pg.evaluate("App.all.length") == 0, pg.evaluate("App.all.map(x=>x.catalog_id)"))
        for route in ["#/catalog", "#/review", "#/add", "#/settings", "#/record/ELG-001", "#/admin", "#/catalogs"]:
            pg.goto(U + route); pg.wait_for_timeout(1800); h = pg.evaluate("location.hash"); body = pg.inner_text("main")
            chk(f"[anon UI] {route} not available (back to Home)", h in ("#/home", "") and "Banded" not in body and not vis("#modal:not([hidden]) form"), h)
        pg.screenshot(path=O + "anon-home-nav.png")
        pg.goto(U + "#/discover"); pg.wait_for_timeout(4000); n = pg.locator("#view-discover a.dcard").count(); chk("[anon UI] Discover shows the public finds", n >= 4, n); pg.screenshot(path=O + "anon-discover.png")
        pg.goto(U + "#/p/UF-HZEB"); pg.wait_for_timeout(4000); t = pg.inner_text("#view-p"); chk("[anon UI] public UF page readable, no edit controls", "Stemmed dart point" in t and pg.locator("#view-p form, #view-p [data-s5-status]").count() == 0); pg.screenshot(path=O + "anon-uf-page.png")
        pg.goto(U + f"#/find/{PRIVATE_ID}"); pg.wait_for_timeout(3500); t = pg.inner_text("#view-find"); chk("[anon UI] private find: lock screen only", "isn't public" in t and "chalcedony" not in t.lower()); pg.screenshot(path=O + "anon-private-lock.png")
        c.close()
        c = br.new_context(viewport={"width": 1280, "height": 900}, service_workers="block"); pg = c.new_page()
        pg.goto(U + "#/home"); pg.wait_for_timeout(2500); pg.evaluate("document.getElementById('authBtn').click()"); pg.wait_for_timeout(800)
        pg.fill("#authEmail", email); pg.fill("#authPw", pw); pg.click("#authPwIn"); pg.wait_for_timeout(6000)
        pg.goto(U + "#/catalog"); pg.wait_for_timeout(5000)
        ids = pg.evaluate("App.all.map(x => x.catalog_id)"); chk("[other user UI] none of Mark's finds in Catalog/Review data", not any(i.startswith("ELG-") for i in ids), ids)
        chk("[other user UI] catalog switcher shows My Collection, not Rolling Oak", "My Collection" in pg.inner_text("#catSwitch") and "Rolling Oak" not in pg.inner_text("#catSwitch"), pg.inner_text("#catSwitch"))
        chk("[other user UI] New catalog button visible", vis("[data-newcat-btn]") and vis('a[data-newcat]'))
        chk("[other user UI] Experts not in the nav", not vis('a[data-route="experts"]'))
        pg.screenshot(path=O + "other-user-catalog.png")
        pg.goto(U + "#/review"); pg.wait_for_timeout(2500); chk("[other user UI] Review has none of Mark's finds", "ELG-0" not in pg.inner_text("#view-review")); pg.screenshot(path=O + "other-user-review.png")
        pg.goto(U + f"#/record/{PUBLIC_ID}"); pg.wait_for_timeout(2500); chk("[other user UI] can't open Mark's find for editing", not vis("#modal:not([hidden]) .rv-layout"))
        r = pg.evaluate(f"App.patch('{PUBLIC_ID}', {{ object_type: 'HACK' }}).then(() => 'ok').catch(e => 'refused: ' + e.message)"); chk("[other user UI] App.patch on Mark's find refused", r.startswith("refused"), r)
        pg.click("[data-newcat-btn]"); pg.wait_for_timeout(500); pg.fill("#newCatForm [name=name]", "Creek finds test"); pg.click("#newCatForm button.primary"); pg.wait_for_timeout(2500)
        chk("[other user UI] New catalog created and selected", "Creek finds test" in pg.inner_text("#catSwitch"), pg.inner_text("#catSwitch")); pg.screenshot(path=O + "other-user-new-catalog.png")
        c.close(); br.close()
finally:
    if UID:
        s, b = call("DELETE", f"/auth/v1/admin/users/{UID}", key=SVC); chk("temporary user deleted", s in (200, 204), s)
print("FAILS", fails)
