"""Learn page + AI pre-flight + natural-rock candidate regression (mocked cloud, no AI spend). Usage: python3 tests/learn_matching_regress.py URL"""
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8831/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
AI = {"candidates": [{"name": "Nolan", "confidence_pct": 55, "why": "stem", "why_not": ""}, {"name": "Natural rock / geofact (not an artifact)", "confidence_pct": 30, "why": "x", "why_not": ""}], "marks": [], "caveat": "Research suggestion only.", "reference_status": "ok",
      "artifact_likelihood": {"verdict": "possible_artifact", "confidence_pct": 60, "evidence_for": ["Flake scars follow one another"], "evidence_against": ["Very few scars"]},
      "diagnostic_checklist": [{"feature": "Bifacial flaking", "status": "present", "photo_index": 0, "note": "both faces"}, {"feature": "Ground base", "status": "not_visible", "photo_index": None, "note": ""}],
      "photo_quality": {"usable": True, "issues": ["Back face is shadowed"], "retake": ["Retake the back face in side light"], "views_seen": ["front"]},
      "calibration_notes": ["Nolan: Only one photo was given (capped at 50%)"], "reference_images_used": [{"id": "wc:1", "title": "Caliche", "license": "CC BY-SA 4.0", "source_url": "https://commons.wikimedia.org/wiki/File:x.jpg"}]}
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": False}], "members": {"c1": {"members": [], "invites": []}}, "comments": [], "ai": AI, "cached": False}
def page(b, mock, anon=False):
    ctx = b.new_context(viewport={"width": 1280, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    return ctx, pg
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    # ---- Learn page, signed out ----
    ctx, pg = page(b, {"online": True, "user": None}); pg.goto(U + "#/learn"); pg.wait_for_selector("#learnBody h1", timeout=15000); pg.wait_for_timeout(500)
    chk("Learn page is public (signed out)", pg.locator("#view-learn:not([hidden])").count() == 1 and "artifact" in pg.inner_text("#learnBody").lower())
    chk("guide has the 'Is it an artifact?' checks + look-alikes", pg.locator(".lg-checks li").count() >= 12, str(pg.locator(".lg-checks li").count()))
    chk("photo guide lists 6 shots", pg.locator(".lg-shots li").count() == 6)
    chk("disclaimer present", "not an identification" in pg.inner_text("#learnBody").lower() or "Nothing here is an identification" in pg.inner_text("#learnBody"))
    pg.click('[data-lg-tab="types"]'); pg.wait_for_selector("#lgTypes li"); n = pg.locator("#lgTypes > li").count(); chk("29 point types", n == 29, str(n))
    pg.fill("#lgQ", "pedernales"); pg.wait_for_timeout(200); vis = pg.locator("#lgTypes > li:visible").count(); chk("search filters types", 1 <= vis < 6, str(vis))
    pg.locator("#lgTypes > li:visible summary").first.click(); t = pg.locator("#lgTypes > li:visible details").first.inner_text()
    chk("type card: diagnostic features, confusable, link-only sources", "Diagnostic features" in t and "Easily confused" in t and "link-only" in t, t[:80].replace("\n", " "))
    pg.click('[data-lg-tab="fossils"]'); pg.wait_for_selector(".lg-type"); chk("fossils & minerals tab populated", pg.locator(".lg-type").count() >= 20, str(pg.locator(".lg-type").count()))
    pg.click('[data-lg-tab="gallery"]'); pg.wait_for_selector("#lgGal li"); g = pg.locator("#lgGal li").count(); chk("gallery shows 250+ credited photos", g >= 250, str(g))
    chk("every gallery photo has a license and source link", pg.evaluate("[...document.querySelectorAll('#lgGal li')].every(li => /CC|Public domain/i.test(li.innerText) && li.querySelector('a[href^=http]'))"))
    pg.click('[data-lg-kind="mineral"]'); pg.wait_for_timeout(200); chk("gallery kind filter", 0 < pg.locator("#lgGal li:visible").count() < g)
    pg.click('[data-lg-tab="sources"]'); pg.wait_for_selector(".lg-src li"); chk("sources tab marks link-only sources", pg.locator(".lg-src .chip").count() >= 8 and "Colorado" not in pg.inner_text("#learnBody"))
    pg.goto(U + "#/learn/types"); pg.wait_for_selector("#lgTypes li:visible"); chk("deep link to a tab", pg.locator('[data-lg-tab="types"][aria-selected="true"]').count() == 1)
    chk("Learn linked from the Explore nav", pg.locator('a[data-route="learn"]').count() >= 2)
    ctx.close()
    # ---- natural rock candidate in the rules engine ----
    ctx, pg = page(b, OWNER); pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(1200)
    r = pg.evaluate("""() => { const base = { catalog_id: 'T-1', category: 'artifact', object_type: 'rock', material: 'sandstone' };
      const nat = Analysis.rank({ ...base, key_features: 'water-worn rounded cobble, rough sandstone surface, no flake scars, no retouch, caliche crust, unworked' }, 'artifact');
      const art = Analysis.rank({ ...base, material: 'chert', object_type: 'point', key_features: 'stemmed dart point, bifacial flaking, beveled stem, serrated edges, retouch, notch' }, 'artifact');
      return { nat: nat.slice(0, 3).map(x => x.c.name), art: art.slice(0, 3).map(x => x.c.name), natHtml: Analysis.render({ ...base, key_features: 'water-worn rounded cobble, no flake scars, no retouch, caliche crust, unworked' }, 'artifact').includes('natural rock') }; }""")
    chk("natural cobble ranks the natural-rock type first", r["nat"] and "Natural rock" in r["nat"][0], str(r["nat"]))
    chk("a bifacial stemmed point does NOT rank natural rock first", r["art"] and "Natural rock" not in r["art"][0], str(r["art"]))
    chk("analysis panel warns when natural rock is the top possibility", r["natHtml"])
    # ---- AI pre-flight ----
    pg.evaluate("window.__body=null; const o=Cloud.analyze; Cloud.analyze=async b=>{window.__body=b; return o(b)}")
    pg.goto(U + "#/record/ELG-001"); pg.wait_for_selector("#modal:not([hidden])"); pg.click("#tab-2"); pg.wait_for_timeout(500)
    run = pg.locator("#aiRun:visible"); chk("AI button present", run.count() > 0)
    if run.count():
        run.click(); pg.wait_for_selector("#aiPre", timeout=5000)
        chk("pre-flight shows capture guidance", pg.locator(".ai-pre-shots li").count() == 6 and pg.locator('#aiPre a[href="#/learn"]').count() >= 1)
        chk("required fields are marked", pg.locator("#aiPre select[required]").count() >= 2)
        pg.select_option("#aiPre [name=material]", ""); pg.select_option("#aiPre [name=flaking]", ""); pg.click("#aiGo"); pg.wait_for_timeout(300)
        chk("blocks the run until required fields are answered", pg.locator("#aiPreErr:visible").count() == 1 and pg.evaluate("window.__body") is None, pg.inner_text("#aiPreErr"))
        pg.select_option("#aiPre [name=material]", "chert"); pg.select_option("#aiPre [name=flaking]", "unknown"); pg.fill("#aiPre [name=length_mm]", "47"); pg.click("#aiGo"); pg.wait_for_selector("#aiBody .cands", timeout=8000); pg.wait_for_timeout(500)
        body = pg.evaluate("window.__body"); a = body.get("attrs", {}) if body else {}
        chk("attributes go to the AI request", a.get("material") == "chert" and a.get("flaking") == "unknown" and a.get("length_mm") == 47, json.dumps(a))
        chk("no location fields in the request", not any(k in json.dumps(body).lower() for k in ["latitude", "longitude", "find_location_private", "gps"]))
        txt = pg.inner_text("#aiBody")
        chk("shows 'is it worked at all?' verdict + evidence", "Is it worked at all?" in txt and "Possibly worked" in txt and "Flake scars follow" in txt)
        chk("shows photo quality + retake advice", "Photo quality" in txt and "Retake the back face" in txt)
        chk("shows diagnostic checklist", pg.locator("#aiBody .ai-dc tbody tr").count() == 2)
        chk("shows calibration note", "capped at 50%" in txt); chk("credits reference images", "CC BY-SA 4.0" in txt and "Caliche" in txt)
        pg.evaluate("window.ROLLING_OAK_MOCK.feedback = []")
        pg.click("#aiAccept"); pg.wait_for_timeout(600)
        fb = pg.evaluate("window.ROLLING_OAK_MOCK.feedback || []")
        chk("Keep records a labeled feedback row with meta", len(fb) >= 1 and fb[-1].get("meta", {}).get("kept") is True and fb[-1]["meta"].get("attrs", {}).get("material") == "chert", json.dumps(fb[-1])[:200] if fb else "none")
        chk("saved attributes are remembered for next time", pg.evaluate("JSON.parse(localStorage.getItem('ro-ai-attrs')||'{}')['ELG-001']?.material") == "chert")
        # cancel path
        pg.goto(U + "#/record/ELG-001"); pg.wait_for_selector("#modal:not([hidden])"); pg.click("#tab-2"); pg.wait_for_timeout(400); pg.locator("#aiRun:visible").click(); pg.wait_for_selector("#aiPre")
        chk("pre-flight prefilled from saved answers", pg.input_value("#aiPre [name=material]") == "chert"); pg.click("#aiPreCancel"); pg.wait_for_timeout(300)
        chk("cancel closes without calling the AI", pg.locator("#aiDlg[open]").count() == 0)
    ctx.close(); b.close()
real = [e for e in errs if "Failed to load resource" not in e]; chk("no page errors", not real, str(real[:3]))
print("FAILS", fails); sys.exit(1 if fails else 0)
