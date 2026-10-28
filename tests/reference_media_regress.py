"""Reference sources sample (migration 019) + AI similar-reference thumbnails with credits (AI mocked; no OpenAI calls).
API (real sessions, SVC_KEY env never printed): table owner-only, RPC signed-in only, rows carry source/license/URL/attribution,
4,042 reference_types rows untouched. UI (mocked cloud): thumbnails only for candidates >= 40%, each credited and linked; About lists sources.
Usage: SVC_KEY=... python3 tests/reference_media_regress.py <test-copy URL with full catalog> [live URL for config]"""
import json, os, re, sys, secrets, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8831/"; CU = sys.argv[2] if len(sys.argv) > 2 else U
cfg = urllib.request.urlopen(CU + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1); SVC = os.environ["SVC_KEY"]
fails, errs = [], []
def aigo(pg):
    """AI pre-flight (2026-10-27): answer the required fields and press Run."""
    pg.wait_for_selector("#aiPre"); pg.wait_for_timeout(150)
    for n in ("material", "flaking"):
        if pg.locator(f"#aiPre [name={n}]").count() and not pg.locator(f"#aiPre [name={n}]").input_value(): pg.select_option(f"#aiPre [name={n}]", index=1)
    pg.click("#aiGo")
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i if i != "" else ""); ok or fails.append(n)
def call(method, path, body=None, tok=None, key=ANON, extra=None):
    h = {"apikey": key, "Authorization": "Bearer " + (tok or key), "Content-Type": "application/json", "Prefer": "return=representation,count=exact"}; h.update(extra or {})
    r = urllib.request.Request(SB + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None), x.headers.get("Content-Range")
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t), None
        except Exception: return e.code, t.decode()[:120], None
s, b, cr = call("GET", "/rest/v1/reference_media?select=id&limit=1", key=SVC); n = int((cr or "/0").split("/")[-1]); chk("reference_media sample loaded (>= 100 rows)", n >= 100, n)
s, b, cr = call("GET", "/rest/v1/reference_types?select=id&limit=1", key=SVC); chk("reference_types still 4,042 rows", (cr or "").endswith("/4042"), cr)
s, b, _ = call("GET", "/rest/v1/reference_media?select=*&source_url=is.null&limit=1", key=SVC); chk("every row has a source URL", b == [], b)
s, b, _ = call("GET", "/rest/v1/reference_media?select=id,license,attribution&or=(license.is.null,attribution.is.null)&limit=1", key=SVC); chk("every row has license + attribution", b == [], b)
s, b, _ = call("GET", "/rest/v1/reference_media?select=license&limit=500", key=SVC); bad = {x["license"] for x in b} - set(); ok = all(re.match(r"^(Public domain|CC0|CC BY(-SA)? [0-9.]+)$", x["license"]) for x in b); chk("only PD / CC0 / CC BY / CC BY-SA licenses", ok, sorted({x["license"] for x in b}))
s, b, _ = call("GET", "/rest/v1/reference_media?select=id&limit=3"); chk("[anon] can't read the table", s >= 400 or b == [], s)
s, b, _ = call("POST", "/rest/v1/rpc/similar_reference_media", {"p_names": ["Clovis point"]}); chk("[anon] RPC refused", s >= 400, s)
email = f"ref-test-{secrets.token_hex(3)}@unearthedfinds.test"; pw = secrets.token_urlsafe(16)
s, u, _ = call("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}, key=SVC); UID = (u or {}).get("id")
try:
    s, t, _ = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw}); TOK = t["access_token"]
    s, b, _ = call("GET", "/rest/v1/reference_media?select=id&limit=3", tok=TOK); chk("[other user] can't read the table directly (owner-only rule)", s >= 400 or b == [], s)
    s, b, _ = call("POST", "/rest/v1/reference_media", {"id": "x", "source": "x", "kind": "fossil", "title": "x", "source_url": "x", "license": "x", "attribution": "x"}, tok=TOK); chk("[other user] can't write", s >= 400, s)
    s, b, _ = call("POST", "/rest/v1/rpc/similar_reference_media", {"p_names": ["Folsom point"], "p_kind": "artifact", "p_limit": 3}, tok=TOK)
    chk("[signed in] RPC returns credited Folsom matches", s == 200 and len(b) == 3 and all(x["matched"] == "folsom" and x["thumb_url"] and x["license"] and x["attribution"] and x["source_url"] for x in b), (s, [x.get("title") for x in b] if isinstance(b, list) else b))
    s, b, _ = call("POST", "/rest/v1/rpc/similar_reference_media", {"p_names": ["Exogyra oyster"], "p_limit": 50}, tok=TOK); chk("[signed in] RPC caps results at 12", s == 200 and 0 < len(b) <= 12, len(b) if isinstance(b, list) else b)
finally:
    if UID: call("DELETE", f"/auth/v1/admin/users/{UID}", key=SVC)
AI = {"candidates": [{"name": "Clovis point", "confidence_pct": 72, "why": "Fluted base."}, {"name": "Folsom point", "confidence_pct": 45, "why": "Full-length flute."}, {"name": "Exogyra (oyster)", "confidence_pct": 20, "why": "Unlikely."}],
      "marks": [], "caveat": "Research suggestion only.", "reference_status": "ok"}
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "adminUserId": "u1", "profile": {"display_name": "Mark", "membership": "lifetime"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": False}], "members": {"c1": {"members": [], "invites": []}}, "comments": [], "ai": AI}
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 1000}, service_workers="block"); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(OWNER)); pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg.route("**/upload.wikimedia.org/**", lambda r: r.fulfill(status=200, content_type="image/gif", body=b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"))
    pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(1200)
    pg.goto(U + "#/record/ELG-001"); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(400); pg.click("#tab-2"); pg.wait_for_timeout(500)
    run = pg.locator("#aiRun:visible"); chk("AI run button present (mocked AI)", run.count() > 0)
    if run.count():
        run.click(); aigo(pg); pg.wait_for_timeout(2500)
        th = lambda k: pg.locator(f'#aiBody [data-ref-cand="{k}"] .ref-thumbs li')
        chk("72% candidate shows 2 credited Clovis thumbnails (1-2 max)", th(0).count() == 2 and all("clovis" in th(0).nth(i).inner_text().lower() for i in range(2)), th(0).count())
        chk("45% candidate shows thumbnails (moderate)", th(1).count() >= 1 and "folsom" in th(1).first.inner_text().lower(), th(1).count())
        chk("20% candidate shows none (low confidence)", th(2).count() == 0, th(2).count())
        cr = pg.locator("#aiBody .ref-credit").first.inner_text(); chk("credit line has author, license and source", "Wikimedia Commons" in cr and re.search(r"CC|Public domain", cr), cr)
        hrefs = pg.evaluate("[...document.querySelectorAll('#aiBody .ref-thumbs a')].map(a => a.href)"); chk("thumbnails link to their source pages", hrefs and all(h.startswith("https://commons.wikimedia.org/") or "creativecommons.org" in h for h in hrefs), hrefs[:3])
        pg.locator("#aiBody").screenshot(path="/workspace/site-improvements/ai-reference-thumbs.png")
    pg2 = br.new_context(service_workers="block").new_page(); pg2.goto(U + "#/about"); pg2.wait_for_timeout(2500); t = pg2.inner_text("#view-about")
    chk("About lists Reference Sources with credits", "Reference Sources" in t and all(x in t for x in ("Wikimedia Commons", "Paleobiology Database", "PIDBA", "RRUFF", "Geological Survey", "Puget Sound Knappers")))
    chk("no page errors", not errs, errs[:3]); br.close()
print("FAILS", fails); sys.exit(1 if fails else 0)
