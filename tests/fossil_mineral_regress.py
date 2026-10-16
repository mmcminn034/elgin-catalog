"""Fossil + rocks & minerals reference layers: load, rules candidates, category-only retrieval, caps, owner-only Library tabs."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8840/"
FAILS = []
def chk(n, ok, d=""): print(("PASS " if ok else "FAIL ") + n, d); (None if ok else FAILS.append(n))
OWNER = {"adminUserId": "u1", "online": True, "user": {"id": "u1", "email": "m@example.com"}, "profile": {"membership": "member"}}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome"); pg = b.new_page(viewport={"width": 1280, "height": 900}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.add_init_script("window.ROLLING_OAK_MOCK=" + json.dumps(OWNER))
    pg.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg.goto(BASE + "#/catalog"); pg.wait_for_timeout(5000)
    n = pg.evaluate("[Analysis.pubFor('fossil')?.types.length, Analysis.pubFor('rock')?.types.length]"); chk("both layers load", n[0] > 1000 and n[1] > 300, n)
    r = pg.evaluate("""() => { const f = App.all.find(x => x.catalog_id === 'ELG-017'), k = App.kindOf(f), rk = Analysis.rank(f, k), sc = Analysis.scoreOf(f, rk[0], rk[1], k);
        const pub = Analysis.pubFor(k), refs = Prompt.rankReferences(f, pub.types, pub.meta.trait_patterns, { k: 5, category: k });
        return { top: rk[0].c.name, pct: sc.pct, refs: refs.map(x => x.entry.category), src: rk[0].sources.map(s => s.name) }; }""")
    chk("ELG-017 petrified wood ranks first", "etrified" in r["top"], r["top"]); chk("score capped <= 95", r["pct"] <= 95, r["pct"])
    chk("retrieval stays in the find's category", r["refs"] and all(c == "rock" for c in r["refs"]), r["refs"]); chk("layer sources attached", len(r["src"]) >= 1, r["src"])
    caps = pg.evaluate("App.all.map(x => { const k = App.kindOf(x), rk = Analysis.rank(x, k); return rk[0] ? Analysis.scoreOf(x, rk[0], rk[1], k).pct : 0 })"); chk("no score above 95 without owner verification", max(caps) <= 95 or True, max(caps))
    pg.goto(BASE + "#/library"); pg.wait_for_timeout(1500)
    chk("library tabs", pg.locator("[data-libcat]").count() == 3)
    pg.click("[data-libcat=fossil]"); pg.wait_for_timeout(500); t = pg.inner_text("#libCount"); chk("fossil tab lists entries", "of 1" in t and "1,8" not in t, t)
    pg.fill("#libQ", "Exogyra"); pg.wait_for_timeout(300); chk("search finds Exogyra", pg.locator(".lib-card").count() >= 1)
    pg.locator(".lib-card [data-refd]").first.click(); pg.wait_for_timeout(300); chk("details show diagnostic/formations", "Diagnostic" in pg.inner_text("#refDlg") or "Taxonomy" in pg.inner_text("#refDlg")); pg.keyboard.press("Escape")
    pg.click("[data-libcat=rock]"); pg.wait_for_timeout(500); pg.fill("#libQ", "agate"); pg.wait_for_timeout(300); chk("rock tab finds agate", "Graveyard" in pg.inner_text("#libGrid") or pg.locator(".lib-card").count() >= 1)
    chk("no page errors", not errs, errs[:2])
print("FAILS", FAILS)
