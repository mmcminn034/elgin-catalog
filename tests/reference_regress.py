"""Reference layer + earned confidence regression (mocked cloud). Usage: python3 tests/reference_regress.py URL [screenshot_dir]"""
import sys, json, os
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; SS = sys.argv[2] if len(sys.argv) > 2 else ""; fails = []; errs = []
def aigo(pg):
    """AI pre-flight (2026-10-27): answer the required fields and press Run."""
    pg.wait_for_selector("#aiPre"); pg.wait_for_timeout(150)
    for n in ("material", "flaking"):
        if pg.locator(f"#aiPre [name={n}]").count() and not pg.locator(f"#aiPre [name={n}]").input_value(): pg.select_option(f"#aiPre [name={n}]", index=1)
    pg.click("#aiGo")
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
AI = {"candidates": [{"name": "Nolan", "confidence_pct": 99, "confidence": "High", "reasoning": "Beveled stem visible in photo 2.", "reference_ids": ["ppn-nolan"],
       "factors": [{"sign": "+", "reason": "Alternately beveled stem matches published Nolan description", "source": "projectilepoints.net"}, {"sign": "-", "reason": "Tip damage limits blade-shape comparison"}]},
      {"name": "Travis", "confidence_pct": 40, "reasoning": "Similar outline."}], "marks": [], "caveat": "Research suggestion only.", "reference_status": "ok", "external_references_used": [{"id": "ppn-nolan", "name": "Nolan", "source": "projectilepoints.net"}, {"id": "ppn-travis", "name": "Travis Stemmed", "source": "projectilepoints.net"}]}
OWNER = {"online": True, "user": {"id": "u1", "email": "mark@example.com"}, "profile": {"display_name": "Mark McMinn", "membership": "member"},
         "collections": [{"id": "c1", "slug": "rolling-oak", "name": "Rolling Oak", "role": "owner", "is_public": False}], "members": {"c1": {"members": [], "invites": []}}, "comments": [], "ai": AI}
def page(b, mock, block_ref=False):
    ctx = b.new_context(viewport={"width": 1280, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(mock)); pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    if block_ref: pg.route("**/data/reference/public-types.json*", lambda r: r.fulfill(status=503, body="down"))
    pg.goto(U); pg.wait_for_selector(".card"); pg.wait_for_timeout(1200); return ctx, pg
def openr(pg, id, tab=2):
    pg.goto(U + "#/record/" + id); pg.wait_for_selector("#modal:not([hidden])"); pg.wait_for_timeout(300); pg.click(f"#tab-{tab}"); pg.wait_for_timeout(500)
def shot(pg, name, sel):
    if SS: os.makedirs(SS, exist_ok=True); p = os.path.join(SS, name); pg.locator(sel).first.screenshot(path=p); print("shot", p)
def pct(pg): return pg.evaluate("[...document.querySelectorAll('#modal .pct')].map(e=>+e.getAttribute('aria-valuenow'))")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); ctx, pg = page(b, OWNER)
    chk("reference data loaded", pg.evaluate("!!(Analysis.pub() && Analysis.pub().types.length > 100)"), str(pg.evaluate("Analysis.pub() && Analysis.pub().types.length")))
    chk("no load errors", pg.evaluate("Analysis.loadErrors().length") == 0)
    openr(pg, "ELG-001"); ch = pg.locator("#modal .src-chip")
    chk("source chips present", ch.count() > 0, str(ch.count())); hrefs = [ch.nth(i).get_attribute("href") or "" for i in range(ch.count())]; chk("chips link out", all(h.startswith("http") or h.startswith("data/") for h in hrefs), str(hrefs))
    names = pg.evaluate("[...document.querySelectorAll('#modal .rank-card, #modal .src-chips')].map(e=>e.innerText)")
    chk("no duplicate chips within a suggestion", all(len(set(c.split("\n"))) == len(c.split("\n")) for c in pg.evaluate("[...document.querySelectorAll('#modal .src-chips')].map(e=>[...e.querySelectorAll('.src-chip')].map(a=>a.innerText).join('\\n'))") if c))
    ps = pct(pg); chk("percent bars 0-95 for rules", ps and all(0 <= x <= 95 for x in ps), str(ps))
    pg.locator("#modal details.why-score summary").first.click(); pg.wait_for_timeout(200)
    chk("why-score lists signed factors", pg.locator("#modal details.why-score[open] li").count() >= 2)
    shot(pg, "suggestions-with-source-chips.png", "#modal .modal-card, #modal")
    pg.locator("#modal [data-refd]").first.click(); pg.wait_for_timeout(300)
    chk("reference detail dialog", pg.locator("#refDlg[open]").count() == 1 and "Source" in pg.inner_text("#refDlg"), pg.inner_text("#refDlg")[:120].replace("\n", " "))
    shot(pg, "reference-entry-detail.png", "#refDlg"); pg.evaluate("document.getElementById('refDlg').close()"); pg.wait_for_timeout(200)
    # AI panel + prompt view
    pg.evaluate("window.__body=null; const o=Cloud.analyze; Cloud.analyze=async b=>{window.__body=b; return o(b)}")
    run = pg.locator("#aiRun:visible")
    if run.count():
        run.click(); aigo(pg); pg.wait_for_timeout(1200)
        txt = pg.inner_text("#aiBody"); chk("AI pct shown and capped at 95", "95%" in txt and "99%" not in txt)
        chk("external references listed", "Nolan, Travis Stemmed" in txt); chk("no reference error when ok", pg.locator("#aiBody .err").count() == 0)
        d = pg.locator("#aiBody details.ai-prompt"); chk("View AI prompt disclosure", d.count() == 1)
        if d.count():
            d.locator("summary").click(); pg.wait_for_timeout(200); pt = d.inner_text(); chk("prompt shows EXTERNAL REFERENCE lines", "EXTERNAL REFERENCE (published typology, not the find)" in pt)
            if SS: d.screenshot(path=os.path.join(SS, "ai-prompt-view.png")); print("shot ai-prompt-view.png")
        if SS: pg.locator("#aiBody .cands").screenshot(path=os.path.join(SS, "ai-candidates-pct.png"))
        pg.evaluate("window.ROLLING_OAK_MOCK.ai = Object.assign({}, window.ROLLING_OAK_MOCK.ai, {reference_status: 'unavailable: no reference rows'})"); pg.evaluate("document.getElementById('aiDlg').close()")
        pg.locator("#aiRun:visible").click(); aigo(pg); pg.wait_for_timeout(900); chk("reference outage visible in AI panel", "unavailable" in pg.inner_text("#aiBody .err") if pg.locator("#aiBody .err").count() else False)
        pg.evaluate("window.ROLLING_OAK_MOCK.ai = null; document.getElementById('aiDlg').close()"); pg.locator("#aiRun:visible").click(); aigo(pg); pg.wait_for_timeout(900)
        chk("AI failure visible (no silent failure)", pg.locator("#aiBody [role=alert]").count() >= 1 and ("AI analysis failed" in pg.inner_text("#aiBody") or "unavailable right now" in pg.inner_text("#aiBody")))
        chk("prompt view still offered after failure", pg.locator("#aiBody details.ai-prompt").count() == 1); pg.evaluate("document.getElementById('aiDlg').close()")
        body = pg.evaluate("window.__body"); chk("payload carries region_hint", bool(body and body.get("region_hint")))
        sz = len(json.dumps(body or {})); chk("payload is small (top candidates only, no full reference list)", body and sz < 20000 and len(body.get("kb", [])) <= 5 and len(body.get("examples", [])) <= 20, f"{sz} bytes, kb={len((body or {}).get('kb', []))}")
        if body: open("/tmp/elg001_ai_body.json", "w").write(json.dumps(body))
    else: chk("AI run button (member)", False)
    # high case: owner-Verified find agreeing with references
    pg.evaluate("(()=>{const r=App.all.find(x=>x.catalog_id==='ELG-001'); r.status='Verified';})()"); openr(pg, "ELG-001")
    amb = pct(pg); chk("ambiguous Verified pick (Nolan/Travis) never reaches 100", amb and max(amb) <= 95, str(amb))
    pg.evaluate("(()=>{const r=App.all.find(x=>x.catalog_id==='ELG-001'); r.suggestion_1='Nolan (Middle Archaic)';})()"); openr(pg, "ELG-001")
    hi = pct(pg); chk("Verified single pick + references agree -> 100 for that type only", hi and hi[0] == 100 and max(hi[1:]) <= 95, str(hi)); pg.locator("#modal details.why-score summary").first.click(); pg.wait_for_timeout(200)
    if SS: pg.locator("#modal .why-score").first.evaluate("e=>e.parentElement.scrollIntoView()"); pg.locator("#modal .why-score").first.locator("xpath=..").screenshot(path=os.path.join(SS, "confidence-high-case.png"))
    lows = {}
    for id in ["ELG-032", "ELG-003", "ELG-005", "ELG-020", "ELG-024", "ELG-030"]:
        openr(pg, id); lows[id] = pct(pg)
    print("pcts", lows); LOW = min(lows, key=lambda k: min(lows[k] or [100])); openr(pg, LOW); lo = pct(pg); chk("weak match shows low/red", lo and min(lo) < 40, str(lo))
    i = lo.index(min(lo)); pg.locator("#modal details.why-score").nth(i).locator("summary").click(); pg.wait_for_timeout(200)
    if SS: pg.locator("#modal .why-score").nth(i).locator("xpath=..").screenshot(path=os.path.join(SS, "confidence-low-case.png"))
    ctx.close()
    # visible error when reference data fails
    ctx, pg = page(b, OWNER, block_ref=True)
    chk("visible error banner when reference data fails", pg.locator("#refErr[role=alert]").count() == 1 and "reference" in pg.inner_text("#refErr").lower(), pg.inner_text("#refErr") if pg.locator("#refErr").count() else "")
    openr(pg, "ELG-001"); chk("rules still work without references", pg.locator("#modal .pct").count() > 0)
    ctx.close(); b.close()
chk("no page errors", not errs, "; ".join(errs[:3]))
print(f"{len(fails)} FAIL" if fails else "ALL PASS"); sys.exit(1 if fails else 0)
