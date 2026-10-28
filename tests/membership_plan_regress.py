"""Mark's 10-case test plan for Membership v1, automated against the preview with mocks (no production writes).
Usage: python3 tests/membership_plan_regress.py http://localhost:8860/  [screenshot dir, default /workspace/membership/]"""
import sys, json, re, os
SEED = open(os.environ["EC_SEED"]).read() if os.environ.get("EC_SEED") else None  # optional full catalog fixture kept outside the repo
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8860/"; O = sys.argv[2] if len(sys.argv) > 2 else "/workspace/membership/"
IMG = "images/ELG-001/01.jpg"; fails = []; errs = []
UFRE = re.compile(r"UF-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}")
def aigo(pg):
    """AI pre-flight (2026-10-27): answer the required fields and press Run."""
    pg.wait_for_selector("#aiPre"); pg.wait_for_timeout(150)
    for n in ("material", "flaking"):
        if pg.locator(f"#aiPre [name={n}]").count() and not pg.locator(f"#aiPre [name={n}]").input_value(): pg.select_option(f"#aiPre [name={n}]", index=1)
    pg.click("#aiGo")
def chk(n, ok, info=""):
    print(("PASS " if ok else "FAIL ") + n, info if info != "" else ""); ok or fails.append(n)
def own(i, vis, pub=None, loc=None):
    r = {"catalog_id": f"FRE-00{i}", "_owner": "u2", "category": "artifact", "object_type": f"Test point {i}", "title": f"My find {i}", "material": "chert", "status": "Draft", "visibility": vis, "is_public": vis == "public",
         "photos": [{"path": "images/ELG-001/01.jpg", "thumb": "images/ELG-001/01_thumb.jpg", "label": "front"}]}
    if pub: r["public_id"] = pub
    if loc: r["find_location_private"] = loc
    return r
FREE = {"online": True, "user": {"id": "u2", "email": "free@example.com"}, "profile": {"display_name": "Free Collector", "membership": "free"}, "adminUserId": "u1",
        "collections": [{"id": "c2", "slug": "free-finds", "name": "My finds", "role": "owner", "is_public": False}], "members": {}}
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "free"}, "adminUserId": "u1",
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": True, "visibility": "public"}], "members": {},
         "ai": {"result": {"caveat": "AI-generated research possibilities.", "candidates": [{"name": "Gary", "confidence_pct": 72, "why": "Contracting stem and broad blade match Gary; measured length fits.", "why_not": "Base is worn.", "factors": [{"sign": "+", "reason": "Contracting stem"}]}], "marks": []}}}
ANNUAL = dict(FREE, user={"id": "u3", "email": "ann@example.com"}, profile={"display_name": "Annie", "membership": "annual", "membership_expires": "2099-01-01T00:00:00Z"},
              collections=[{"id": "c3", "slug": "ann", "name": "Annie's finds", "role": "owner", "is_public": False}])
def ctx(b, mock, w=1280, h=900, mobile=False, theme="dark"):
    c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile)
    c.add_init_script(f"try{{localStorage.setItem('elgin-theme','{theme}')}}catch(e){{}}")
    if mock is not None: c.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock))
    c.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    if SEED: c.route("**/data/catalog.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=SEED))  # test fixture (private data never ships)
    pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errs.append(m.text)); return c, pg
def walk(pg, name, obj, feats, loc, shot=IMG):
    pg.goto(U + "#/add"); pg.wait_for_timeout(700)
    pg.check("input[name=category][value=artifact]"); pg.click("#next"); pg.wait_for_timeout(300)
    pg.set_input_files("[data-shot=front]", shot); pg.wait_for_timeout(700); pg.click("#next"); pg.wait_for_timeout(300)
    pg.fill("[name=length_mm]", "52"); pg.click("#next"); pg.wait_for_timeout(300)
    pg.fill("#wizard [name=object_type]", obj); pg.fill("#wizard [name=material]", "chert"); pg.fill("#wizard [name=key_features]", feats)
    if loc: pg.fill("#wizard [name=find_location_private]", loc)
    pg.check("[name=landowner_permission]"); pg.click("#next"); pg.wait_for_timeout(700); pg.click("#next"); pg.wait_for_timeout(400)
    if name: pg.fill("#wizard [name=title]", name)
def shot(pg, n, full=False): pg.screenshot(path=O + n, full_page=full)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")

    # 1. sign-up / sign-in: email link and password
    c, pg = ctx(b, {"online": True, "user": None, "adminUserId": "u1", "accounts": {}})
    pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.click("#authBtn"); pg.wait_for_timeout(300)
    pg.fill("#authEmail", "new@example.com"); pg.click("#authMagic"); pg.wait_for_timeout(300)
    chk("1a email link: confirmation shown + link requested", "Check your email" in pg.inner_text("#authMsg") and pg.evaluate("ROLLING_OAK_MOCK.magic||[]") == ["new@example.com"])
    pg.fill("#authPw", "short"); pg.click("#authSignUp"); pg.wait_for_timeout(200); chk("1b sign-up rejects a short password", "8 characters" in pg.inner_text("#authMsg"))
    pg.fill("#authPw", "correct-horse-1"); pg.click("#authSignUp"); pg.wait_for_timeout(300); chk("1c sign-up with password", "Account created" in pg.inner_text("#authMsg"))
    pg.fill("#authPw", "wrong-password"); pg.click("#authPwIn"); pg.wait_for_timeout(300); chk("1d wrong password refused", "Invalid" in pg.inner_text("#authMsg"))
    pg.fill("#authPw", "correct-horse-1"); pg.click("#authPwIn"); pg.wait_for_timeout(500)
    chk("1e password sign-in", "Signed in" in pg.inner_text("#authMsg") and pg.evaluate("Cloud.state().user && Cloud.state().user.email") == "new@example.com")
    shot(pg, "t01-auth.png"); c.close()

    # 2. named catalogs (create + rename); owner keeps 'Rolling Oak'
    c, pg = ctx(b, FREE); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.goto(U + "#/catalogs"); pg.wait_for_selector(".cat-row"); pg.wait_for_timeout(500)
    pg.fill("#catNew [name=name]", "Brazos gravel bars"); pg.click("#catNew button"); pg.wait_for_selector(".cat-row:has-text('Brazos gravel bars') input[name=name]", timeout=5000)
    chk("2a catalog created", "Brazos gravel bars" in pg.inner_text("#catalogsBody"))
    row = pg.locator(".cat-row", has_text="Brazos gravel bars"); row.locator("input[name=name]").fill("Brazos bars"); row.locator(".cat-rename button").click(); pg.wait_for_timeout(600)
    chk("2b catalog renamed", "Brazos bars" in pg.inner_text("#catalogsBody") and "Brazos gravel bars" not in pg.inner_text(".cat-list"))
    shot(pg, "t02-catalogs.png", True); c.close()
    c, pg = ctx(b, OWNER); pg.goto(U + "#/catalogs"); pg.wait_for_selector(".cat-list"); chk("2c owner's catalog is 'Rolling Oak'", "Rolling Oak" in pg.inner_text(".cat-list")); c.close()

    # 3. add a find: photos, name, notes, private location, catalog
    c, pg = ctx(b, FREE); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card")
    walk(pg, "Creek-bed dart point", "dart point", "contracting stem, serrated edges", "30.123456, -97.654321 (±5 m)")
    pg.fill("#wizard [name=owner_observations]", "Found after rain on gravel bar."); 
    chk("3a step 5 has name, catalog, visibility", pg.locator("#wizard [name=title]").count() == 1 and pg.locator("#wizCatalog option").count() >= 1 and pg.locator("#wizVis").count() == 1)
    chk("3b catalog list uses my named catalog", "My finds" in pg.inner_text("#wizCatalog"))
    shot(pg, "t03-add-step5.png", True); pg.click("#save"); pg.wait_for_timeout(1500)
    pushed = pg.evaluate("ROLLING_OAK_MOCK.pushed||[]"); new = pushed[-1] if pushed else {}
    chk("3c saved with custom name", new.get("title") == "Creek-bed dart point", new.get("title"))
    chk("3d saved private by default, with catalog", new.get("visibility") == "private" and new.get("collection_id") == "c2", (new.get("visibility"), new.get("collection_id")))
    chk("3e notes saved", "gravel bar" in (new.get("owner_observations") or ""))
    chk("3f exact location never in the finds row", not any("30.123456" in json.dumps(v) for v in pushed) and "find_location_private" not in new)
    chk("3g name is the display title", pg.inner_text("#mTitle") == "Creek-bed dart point", pg.inner_text("#mTitle"))
    nid = new.get("catalog_id"); shot(pg, "t03-saved-record.png")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300); chk("3h catalog card shows the name", "Creek-bed dart point" in pg.inner_text(f'.card[data-id="{nid}"]'))
    c.close()

    # 4 + 5. AI ID with confidence + explanation; Keep / Correct stored (owner on a published find)
    c, pg = ctx(b, OWNER); pg.goto(U + "#/record/ELG-018"); pg.wait_for_selector(".rv-layout"); pg.wait_for_timeout(800)
    chk("4a review panel shows a confidence score + bar", pg.locator(".rv-conf .big").count() == 1 and pg.locator(".rv-conf .bar i").count() == 1, pg.inner_text(".rv-conf") if pg.locator(".rv-conf").count() else "")
    chk("4b 'Why this score' explanation", "Why this score" in pg.inner_text(".rv-ai") and len(pg.inner_text(".rv-why p")) > 20)
    chk("4c suggested type + Keep/Correct/Ask an Expert actions", pg.locator(".rv-sugg .chip").count() >= 1 and pg.locator("[data-rv=keep]").count() == 1 and pg.locator("[data-rv=correct]").count() == 1 and pg.locator("[data-m12=ask]").count() == 1)
    chk("4d reference matches row", pg.locator(".rv-refs").count() == 1)
    shot(pg, "t04-review.png")
    pg.click("#tab-2"); pg.wait_for_timeout(600); chk("4e AI analysis available on the free tier (signed in)", pg.locator("#aiRun").count() == 1)
    if pg.locator("#aiRun").count():
        pg.click("#aiRun"); aigo(pg); pg.wait_for_timeout(1200); t = pg.inner_text("#aiBody")
        chk("4f AI result shows % confidence and why", "72%" in t and "Why" in t and "Gary" in t); shot(pg, "t04-ai.png")
        pg.click("#aiDiscard"); pg.wait_for_timeout(300)
    pg.click("#tab-0"); pg.wait_for_timeout(500); n0 = len(pg.evaluate("ROLLING_OAK_MOCK.corrections||[]"))
    pg.click("[data-rv=keep]"); pg.wait_for_timeout(800); cr = pg.evaluate("ROLLING_OAK_MOCK.corrections||[]")
    chk("5a Keep is stored", len(cr) > n0 and cr[-1].get("catalog_id") == "ELG-018", cr[-1] if cr else None)
    pg.click("[data-rv=correct]"); pg.wait_for_timeout(500)
    inp = pg.locator("#panel-0 [data-cf=type] [data-cv]")
    if inp.count():
        if pg.evaluate("document.querySelector('#panel-0 [data-cf=type] [data-cv]').tagName") == "SELECT": inp.first.select_option(index=1)
        else: inp.first.fill("Agate (banded)")
        pg.locator("#panel-0 [data-cf=type] [data-cr]").first.fill("banding visible under light"); pg.locator("#panel-0 [data-corr=save][data-f=type]").first.click(); pg.wait_for_timeout(800)
    cr2 = pg.evaluate("ROLLING_OAK_MOCK.corrections||[]"); chk("5b Correct is stored with the new value", len(cr2) > len(cr) and not cr2[-1].get("kept") and cr2[-1].get("new_value") != cr2[-1].get("old_value"), cr2[-1] if cr2 else None)
    shot(pg, "t05-keep-correct.png"); c.close()

    # 6 + 7. UF id only when public; private items never show a public id or location
    c, pg = ctx(b, ANNUAL); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card")
    walk(pg, "Annie's scraper", "end scraper", "steep working edge", "30.555555, -97.111111"); pg.click("#save"); pg.wait_for_timeout(1500)
    rid = pg.evaluate("App.current && App.current.catalog_id"); r = pg.evaluate(f"App.all.find(x=>x.catalog_id==='{rid}')")
    chk("6a private item has no public id", not r.get("public_id") and not UFRE.search(pg.inner_text("#mBody")))
    chk("7a private item: no UF id anywhere in the DOM", not UFRE.search(pg.content()))
    shot(pg, "t06-private.png")
    sel = pg.locator("#mBody select[data-act=vis3]")
    chk("6b visibility control present", sel.count() >= 1)
    if sel.count():
        sel.first.select_option("public"); pg.wait_for_timeout(900)
    r = pg.evaluate(f"App.all.find(x=>x.catalog_id==='{rid}')"); uf = r.get("public_id") or ""
    chk("6c made public: UF id generated", bool(UFRE.fullmatch(uf)), uf)
    chk("6d UF id is not the internal number", rid not in uf and not uf.startswith("ELG"))
    pg.wait_for_timeout(400); chk("6e UF chip + copy link shown on the record", uf in pg.inner_text("#mBody") and pg.locator("[data-m12=copy]").count() == 1)
    shot(pg, "t06-public.png")
    pg.keyboard.press("Escape"); pg.goto(U + "#/p/" + uf); pg.wait_for_timeout(900); t = pg.inner_text("#sharedFind")
    chk("6f share page by UF id renders the find by name", "Annie's scraper" in t and uf in t, t[:120])
    h = pg.inner_html("#sharedFind"); chk("7b public page never shows the exact location or internal id", "30.555555" not in h and rid not in h and "General area only" in t)
    shot(pg, "t06-share-page.png", True)
    pg.goto(U + "#/find/" + rid); pg.wait_for_timeout(1200); chk("6g legacy #/find/<id> link redirects to the UF page", pg.evaluate("location.hash") == "#/p/" + uf, pg.evaluate("location.hash"))
    pg.goto(U + "#/record/" + rid); pg.wait_for_selector(".rv-layout"); pg.wait_for_timeout(500)
    pg.locator("#mBody select[data-act=vis3]").first.select_option("private"); pg.wait_for_timeout(800)
    r = pg.evaluate(f"App.all.find(x=>x.catalog_id==='{rid}')"); chk("6h member made it private again: public id hidden", not r.get("public_id"))
    pg.keyboard.press("Escape"); pg.goto(U + "#/p/" + uf); pg.wait_for_timeout(800); chk("6i old UF link stops resolving while private", "isn't public" in pg.inner_text("#sharedFind"))
    pg.goto(U + "#/record/" + rid); pg.wait_for_selector(".rv-layout"); pg.locator("#mBody select[data-act=vis3]").first.select_option("public"); pg.wait_for_timeout(800)
    r = pg.evaluate(f"App.all.find(x=>x.catalog_id==='{rid}')"); chk("6j public again: same UF id reused", r.get("public_id") == uf, r.get("public_id"))
    c.close()
    c, pg = ctx(b, None); pg.goto(U + "#/discover"); pg.wait_for_timeout(2500)
    chk("7c signed-out Discover shows no exact coordinates", not re.search(r"-?\d{1,2}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}", pg.inner_text("body"))); c.close()

    # 8. gates: free private limit, toggle lock, expert question limit
    m = dict(FREE, finds=[own(i, "private") for i in range(1, 6)] + [own(6, "public", "UF-K7M3")], privateBaseline=5)
    c, pg = ctx(b, m); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.wait_for_timeout(600)
    chk("8a five private items counted", pg.evaluate("Membership.privateCount()") == 5, pg.evaluate("Membership.privateCount()"))
    walk(pg, "Sixth find", "biface", "thinned, lenticular", "creek bank")
    chk("8b at the limit: Private option disabled, Public forced", pg.evaluate("document.querySelector('#wizVis option[value=private]').disabled") and pg.input_value("#wizVis") == "public")
    chk("8c clear warning before saving", "will be saved as PUBLIC" in pg.inner_text("#wizGate")); shot(pg, "t08-sixth-warning.png", True)
    pg.click("#save"); pg.wait_for_timeout(500); chk("8d confirmation dialog before saving", pg.locator("#memDlg[open]").count() == 1); shot(pg, "t08-sixth-dialog.png")
    pg.click("#memSavePublic"); pg.wait_for_timeout(1500); pushed = pg.evaluate("ROLLING_OAK_MOCK.pushed||[]"); new = pushed[-1] if pushed else {}
    chk("8e 6th item created public", new.get("visibility") == "public" and new.get("title") == "Sixth find", (new.get("visibility"), new.get("title")))
    chk("8f 6th item got a UF id; location not public", bool(UFRE.fullmatch(pg.evaluate("App.current && App.current.public_id") or "")) and "find_location_private" not in new)
    pg.keyboard.press("Escape"); pg.goto(U + "#/record/FRE-006"); pg.wait_for_selector(".rv-layout"); pg.wait_for_timeout(500)
    s3 = pg.locator("#mBody select[data-act=vis3]")
    chk("8g toggle lock: private options disabled on a public item", s3.count() >= 1 and pg.evaluate("[...document.querySelectorAll('#mBody select[data-act=vis3] option')].filter(o=>o.value!=='public').every(o=>o.disabled)"))
    chk("8h lock explained with a plans link", "can't switch a public item back to private" in pg.inner_text("#mBody")); shot(pg, "t08-toggle-lock.png")
    pg.evaluate("Learn && App.patch('FRE-006', {visibility:'private', is_public:false})"); pg.wait_for_timeout(500)
    chk("8i lock enforced in code (App.patch refused)", pg.evaluate("Learn.vis(App.all.find(x=>x.catalog_id==='FRE-006'))") == "public")
    res = pg.evaluate("Cloud.setFindVisibility('FRE-006','private')"); chk("8j lock enforced on the cloud write", bool(res.get("error")), res)
    # 2026-10-18: questions are asked from the user's OWN find (Ask an Expert in the find); Experts is no longer a general ask page
    def ask_on_find(pg, q):
        rid = pg.evaluate("(App.all.find(r => Access.canEdit(r)) || {}).catalog_id"); pg.goto(U + "#/record/" + rid); pg.wait_for_selector(".rv-layout"); pg.wait_for_timeout(400)
        pg.click("[data-m12=ask]"); pg.fill("#askDlgForm [name=q]", q); pg.click("#askSend"); pg.wait_for_timeout(800)
        msg = pg.inner_text("#askDlgMsg") if pg.locator("#askDlg[open]").count() else ""; pg.keyboard.press("Escape"); pg.goto(U + "#/home"); pg.wait_for_timeout(300); return msg
    pg.keyboard.press("Escape")
    for i in range(3): ask_on_find(pg, f"Is this a Gary point? question {i}")
    chk("8k 3 questions used this month", len(pg.evaluate("ROLLING_OAK_MOCK.m12.questions")) == 3, pg.evaluate("ROLLING_OAK_MOCK.m12.questions.length"))
    msg = ask_on_find(pg, "One more question please")
    chk("8l 4th question refused on the free plan", "3 expert questions a month" in msg, msg); shot(pg, "t08-expert-limit.png", True)
    pg.goto(U + "#/experts"); pg.wait_for_selector("#expertsBody h1"); chk("8n free user: Experts page shows only their questions + apply (no inbox, no general ask)", pg.locator("#askForm, .inbox").count() == 0 and "Your questions" in pg.inner_text("#expertsBody"))
    c.close()
    c, pg = ctx(b, ANNUAL); pg.goto(U + "#/home"); pg.wait_for_timeout(1200)
    for i in range(5): ask_on_find(pg, f"Member question {i}")
    q = pg.evaluate("ROLLING_OAK_MOCK.m12.questions"); chk("8m members: unlimited questions with priority", len(q) == 5 and all(x["priority"] > 0 for x in q), [(x["question"], x["priority"]) for x in q]); c.close()

    # experts: apply -> owner approves -> verified badge -> inbox answers (supports case 8 + the Experts spec)
    m = dict(FREE); c, pg = ctx(b, m); pg.goto(U + "#/experts"); pg.wait_for_selector("#expForm")
    pg.fill("#expForm [name=name]", "Dr. Flint"); pg.fill("#expForm [name=credentials]", "PhD, 20 years Texas lithics"); pg.fill("#expForm [name=specialties]", "Texas lithics, dart points"); pg.click("#expForm button"); pg.wait_for_timeout(700)
    chk("E1 expert application submitted (pending)", "pending" in pg.inner_text("#expertsBody")); shot(pg, "t-experts-apply.png", True)
    m12 = pg.evaluate("ROLLING_OAK_MOCK.m12"); c.close()
    om = dict(OWNER, m12=m12); c, pg = ctx(b, om); pg.goto(U + "#/admin"); pg.wait_for_selector("#grantForm")
    pg.wait_for_timeout(800); chk("E2 owner sees the approve/reject queue", "Dr. Flint" in pg.inner_text("#adminBody"), json.dumps(m12.get("experts"))[:200]); shot(pg, "t-admin.png", True)
    pg.click("[data-decide=approved]"); pg.wait_for_timeout(700); m12 = pg.evaluate("ROLLING_OAK_MOCK.m12"); chk("E3 approved", m12["experts"][0]["status"] == "approved")
    pg.fill("#grantForm [name=email]", "nobody@example.com"); pg.click("#grantForm button"); pg.wait_for_timeout(400); chk("E4 grant: unknown email reported", "No account" in pg.inner_text("#grantMsg"))
    pg.evaluate("ROLLING_OAK_MOCK.m12.users.push({id:'u9',email:'friend@example.com',membership:'free'})"); pg.fill("#grantForm [name=email]", "friend@example.com"); pg.select_option("#grantForm [name=plan]", "lifetime"); pg.click("#grantForm button"); pg.wait_for_timeout(400)
    chk("E5 owner grants Lifetime manually", pg.evaluate("ROLLING_OAK_MOCK.m12.users.find(u=>u.id==='u9').membership") == "lifetime")
    m12 = pg.evaluate("ROLLING_OAK_MOCK.m12"); m12["questions"].append({"id": "qx", "asker": "u3", "question": "Member Q about a scraper", "context": {"title": "Annie's scraper"}, "status": "open", "priority": 10, "created_at": "2026-10-16T10:00:00Z"})
    m12["questions"].append({"id": "qy", "asker": "u2", "question": "Free Q", "context": {}, "status": "open", "priority": 0, "created_at": "2026-10-16T09:00:00Z"}); c.close()
    em = dict(FREE, m12=m12); c, pg = ctx(b, em); pg.goto(U + "#/experts"); pg.wait_for_selector(".inbox")
    first = pg.locator(".inbox > li").first.inner_text(); chk("E6 verified expert inbox, members first", "Member Q" in first and "★ Member" in first)
    chk("E7 verified badge shown", "✓ Verified" in pg.inner_text("#expertsBody"))
    pg.locator(".inbox .ans-form textarea").first.fill("Looks like a classic end scraper."); pg.locator(".inbox .ans-form button").first.click(); pg.wait_for_timeout(700)
    chk("E8 expert answer stored; question closed", pg.evaluate("ROLLING_OAK_MOCK.m12.questions.find(q=>q.id==='qx').status") == "answered"); shot(pg, "t-experts-inbox.png", True); c.close()

    # pricing + merch
    c, pg = ctx(b, FREE); pg.goto(U + "#/membership"); pg.wait_for_selector(".tiers")
    t = pg.inner_text("#pricingBody"); chk("P1 three tiers, correct prices, no monthly plan", "$29.99" in t and "$59.99" in t and "/year" in t and "one-time" in t and "month" not in re.sub(r"questions a month|this month", "", t).lower().replace("monthly plan", ""), "")
    chk("P2 old $10 member plan gone", "$10" not in t and "Supporter" not in t)
    chk("P3 AI cap not advertised", "50" not in t and "Unlimited AI identifications" in t)
    chk("P4 paid buttons are disabled 'Coming soon' (Stripe not connected)", pg.locator("[data-soon=lifetime]").is_disabled() and "aren't available yet" in pg.inner_text("#pricingBody") and pg.evaluate("Billing.checkout('lifetime').then(x => x.error)") == "coming_soon")
    shot(pg, "t-pricing-dark.png", True); c.close()
    c, pg = ctx(b, FREE, theme="light"); pg.goto(U + "#/membership"); pg.wait_for_selector(".tiers"); shot(pg, "t-pricing-light.png", True); c.close()
    c, pg = ctx(b, FREE); pg.goto(U + "#/merch"); pg.wait_for_selector("#merchBody h1"); chk("M1 merch empty state", "Merch is on the way" in pg.inner_text("#merchBody") and pg.locator("#prodForm").count() == 0); shot(pg, "t-merch-empty.png", True); c.close()
    c, pg = ctx(b, OWNER); pg.goto(U + "#/merch"); pg.wait_for_selector("#prodForm")
    pg.fill("#prodForm [name=name]", "UnEarthed Field Tee"); pg.fill("#prodForm [name=price]", "28"); pg.fill("#prodForm [name=sizes]", "S, M, L"); pg.fill("#prodForm [name=colors]", "Clay, Sage"); pg.check("#prodForm [name=active]"); pg.click("#prodForm button"); pg.wait_for_timeout(700)
    pr = pg.evaluate("ROLLING_OAK_MOCK.m12.products"); chk("M2 owner adds a product with variants", len(pr) == 1 and pr[0]["price_cents"] == 2800 and len(pr[0]["variants"]) == 6, json.dumps(pr)[:300])
    chk("M3 ordering is coming soon", "Ordering coming soon" in pg.inner_text("#merchBody")); shot(pg, "t-merch-admin.png", True); c.close()

    # 9. nav desktop + mobile
    for who, mk in [("free", FREE), ("owner", OWNER)]:
        c, pg = ctx(b, mk); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.wait_for_timeout(700)
        side = pg.inner_text(".side-nav .side-main"); chk(f"9a desktop sidebar has Experts/Merch/Membership ({who})", all(x in side for x in ["Catalog", "Review", "Add Find", "Merch", "Membership", "Settings"]) and (("Experts" in side) == (who == "owner")))
        chk(f"9b owner admin link only for the owner ({who})", pg.locator('.side-nav a[data-route=admin]').is_visible() == (who == "owner"))
        chk(f"9c no hamburger on desktop ({who})", not pg.locator("#menuBtn").is_visible()); shot(pg, f"t09-desktop-{who}.png"); c.close()
    c, pg = ctx(b, FREE, 390, 844, True); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.wait_for_timeout(600)
    chk("9d mobile: hamburger only, no sidebar", pg.locator("#menuBtn").is_visible() and not pg.locator(".side-nav").is_visible())
    pg.click("#menuBtn"); pg.wait_for_timeout(400); d = pg.inner_text("#navMenu"); chk("9e mobile drawer has Merch/Membership, no Experts for regular users", all(x in d for x in ["Merch", "Membership"]) and "Experts" not in d)
    chk("9f admin hidden in the drawer for non-owners", not pg.locator('#navMenu a[data-route=admin]').is_visible()); shot(pg, "t09-mobile-drawer.png")
    pg.click('#navMenu a[data-route=merch]'); pg.wait_for_timeout(600); chk("9g drawer link navigates + closes", pg.evaluate("location.hash") == "#/merch" and not pg.locator("#navMenu").is_visible())
    pg.goto(U + "#/membership"); pg.wait_for_selector(".tiers"); shot(pg, "t09-mobile-pricing.png", True); c.close()

    # 10. homepage (signed out)
    for theme in ["dark", "light"]:
        c, pg = ctx(b, None, theme=theme); pg.goto(U); pg.wait_for_timeout(3000)
        chk(f"10a signed-out root shows Home ({theme})", pg.locator("#view-home").is_visible() and not pg.locator("#view-catalog").is_visible())
        t = pg.inner_text("body"); chk(f"10b hero + Explore finds, no ELG-/Elgin text ({theme})", "Explore" in t and "ELG-" not in t and "Elgin" not in t)
        chk(f"10c footer ({theme})", "© 2026 PolForge, LLC" in t); shot(pg, f"t10-home-{theme}.png"); c.close()
    c, pg = ctx(b, None, 390, 844, True); pg.goto(U); pg.wait_for_timeout(3000); shot(pg, "t10-home-mobile.png"); c.close()

    # lapse banner (Annual expired, grace period)
    lm = dict(ANNUAL, profile={"display_name": "Annie", "membership": "annual", "membership_expires": "2026-10-14T00:00:00Z"})
    c, pg = ctx(b, lm); pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.wait_for_selector("#lapseBanner", timeout=8000)
    chk("L1 lapse banner with grace days + choose-5 link", pg.locator("#lapseBanner").count() == 1 and "Choose which 5" in pg.inner_text("#lapseBanner"))
    chk("L2 expired Annual treated as Free", pg.evaluate("Membership.plan()") == "free"); shot(pg, "t-lapse-banner.png"); c.close()
    b.close()
real = [e for e in errs if "favicon" not in e]
chk("no page errors", not real, real[:5])
print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}"); sys.exit(1 if fails else 0)
