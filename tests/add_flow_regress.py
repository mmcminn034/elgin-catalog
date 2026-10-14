"""Add-on-phone regression: wizard at 390x844 -> saved (mock cloud records the normalized row) -> local analysis present,
AI status visible, sources normalized, private by default; out-of-area banner + provenance answer; existing finds don't false-trigger."""
import sys, json
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; O = "/workspace/elgin-catalog-previews/"
IMG = "/tmp/ec/images/ELG-016/01.jpg"; IMG2 = "/tmp/ec/images/ELG-015/06.jpg"; fails = []; errs = []
def chk(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name, info); ok or fails.append(name)
def walk(pg, kind, name, mat, feats, length, shot, tag):
    pg.goto(U + "#/add"); pg.wait_for_timeout(600)
    pg.check(f"input[name=category][value={kind}]"); pg.click("#next"); pg.wait_for_timeout(300)
    pg.set_input_files("[data-shot=front]", shot); pg.wait_for_timeout(700); pg.click("#next"); pg.wait_for_timeout(300)
    pg.screenshot(path=O + f"ux-after-{tag}-measure.png", full_page=True)
    pg.fill("[name=length_mm]", length); pg.click("#next"); pg.wait_for_timeout(300)
    pg.fill("[name=object_type]", name); pg.fill("[name=material]", mat); pg.fill("[name=key_features]", feats)
    pg.check("[name=landowner_permission]"); pg.screenshot(path=O + f"ux-after-{tag}-description.png", full_page=True)
    pg.click("#next"); pg.wait_for_timeout(700)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx.add_init_script("window.ROLLING_OAK_MOCK={user:{id:'u1',email:'mark@example.com'},online:true}")
    ctx.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctx.new_page(); pg.on("console", lambda m: m.type == "error" and errs.append(m.text)); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(U); pg.wait_for_selector(".card")
    # existing finds: who triggers the out-of-area check?
    flags = pg.evaluate("App.all.map(r => ({id: r.catalog_id, flag: Region.check(r).flag, answered: Region.answered(r), banner: !!Region.bannerHtml(r), why: Region.check(r).reasons.map(x => x.id + ':' + x.match)}))")
    for f in flags: print("  ", f)
    chk("no false out-of-area banner on ELG-001..018", not [f for f in flags if f["banner"]], [f["id"] for f in flags if f["banner"]])
    chk("ELG-017 has provenance, no nag", any(f["id"] == "ELG-017" and f["answered"] and not f["banner"] for f in flags))
    # 1) local rock, inches, no material
    walk(pg, "rock", "rock with rings", "", "concentric rings, white crystalline quartz centres, broken water-worn edges", "1.5 in", IMG2, "local")
    s1 = pg.evaluate("document.querySelector('#wizard').elements.suggestion_1.value"); chk("AI step auto-prefilled suggestion", bool(s1), s1)
    chk("confidence capped (no High option)", not pg.evaluate("[...document.querySelector('[name=confidence]').options].some(o=>/high/i.test(o.text))"))
    chk("no out-of-area banner for local rock", pg.locator("#wizRegion .oor").count() == 0)
    pg.screenshot(path=O + "ux-after-local-ai-step.png", full_page=True)
    pg.click("#next"); pg.wait_for_timeout(300); pg.click("#save"); pg.wait_for_timeout(1500)
    pg.screenshot(path=O + "ux-after-local-saved.png")
    pushed = pg.evaluate("window.ROLLING_OAK_MOCK.pushed || []"); new = pushed[-1] if pushed else {}
    print("  pushed row:", json.dumps({k: new.get(k) for k in ["catalog_id", "category", "length_mm", "suggestion_1", "confidence", "visibility", "weight_source", "length_source", "heat_treatment", "material"]}))
    chk("saved remotely (mock) with next free ID ELG-019", new.get("catalog_id") == "ELG-019")
    chk("inches converted to mm", new.get("length_mm") == "38", new.get("length_mm"))
    chk("sources normalized (no '')", all(new.get(k) in (None, "measured", "photo_estimate", "estimate") for k in ["length_source", "width_source", "thickness_source", "weight_source"]))
    chk("private by default", new.get("visibility") == "private")
    chk("analysis present on saved record", bool(new.get("suggestion_1")) and new.get("confidence") in ("Low", "Low-moderate", "Moderate"))
    body = pg.inner_text("#mBody"); chk("AI status visible on record", "AI photo review" in body)
    chk("synced toast", any("synced" in t for t in pg.locator("[role=status]").all_inner_texts()), pg.locator("[role=status]").all_inner_texts()[-2:])
    # 2) out-of-area: obsidian point
    pg.keyboard.press("Escape")
    walk(pg, "artifact", "obsidian point", "obsidian", "side-notched, glassy black volcanic glass, fresh unstained surface", "35", IMG, "oor")
    chk("out-of-area banner in wizard", pg.locator("#wizRegion .oor").count() == 1)
    pg.locator("#wizRegion").scroll_into_view_if_needed(); pg.screenshot(path=O + "ux-outofarea-wizard.png", full_page=True)
    pg.click("#wizRegion [data-prov=collection-open]"); pg.fill("#wizRegion [data-prov-place]", "Nevada"); pg.click("#wizRegion [data-prov=collection]"); pg.wait_for_timeout(300)
    pg.click("#next"); pg.wait_for_timeout(300); pg.click("#save"); pg.wait_for_timeout(1500)
    r = pg.evaluate("App.all.find(x => x.catalog_id === 'ELG-020')") or {}
    chk("provenance stored from answer", r.get("provenance_answer") == "collection" and "Nevada" in (r.get("provenance") or ""), r.get("provenance"))
    chk("no banner after answer", pg.locator("#mBody .oor").count() == 0)
    pg.screenshot(path=O + "ux-outofarea-record-answered.png")
    fb = pg.evaluate("Region.feedback()"); chk("answer stored as learning feedback", any(x["catalog_id"] in ("NEW", "ELG-020") and x["answer"] == "collection" for x in fb))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    card = pg.locator('.card[data-id="ELG-020"]')
    if card.count(): card.scroll_into_view_if_needed(); card.screenshot(path=O + "ux-outofarea-card-badge.png"); chk("collection badge on card", "From collection" in card.inner_text())
    # 3) record-level banner for an unanswered flagged find + answer from the record
    print('  patch:', pg.evaluate("App.patch('ELG-019', { key_features: 'basalt pebble, vesicular' }).then(()=>App.all.find(x=>x.catalog_id==='ELG-019').key_features).catch(e=>'ERR '+e.message)")); pg.wait_for_timeout(500)
    pg.evaluate("location.hash='#/catalog'"); pg.wait_for_timeout(300); pg.evaluate("location.hash='#/record/ELG-019'"); pg.wait_for_timeout(900)
    print("  dbg:", pg.evaluate("(() => { const r = App.all.find(x => x.catalog_id === 'ELG-019'); return { kf: r.key_features, ans: r.provenance_answer, acq: r.acquisition, chk: Region.check(r).reasons.map(x=>x.id), tab: document.querySelector('.tabs [aria-selected=true]')?.textContent }; })()"))
    chk("record banner shows for flagged unanswered find", pg.locator("#mBody .oor").count() == 1)
    pg.screenshot(path=O + "ux-outofarea-record-banner.png")
    pg.click("#mBody [data-prov=local]"); pg.wait_for_timeout(700)
    chk("'Found here' answer clears banner", pg.locator("#mBody .oor").count() == 0)
    # 4) public page shows state level only
    pg.evaluate("App.patch('ELG-020', { visibility: 'public', is_public: true })"); pg.wait_for_timeout(400)
    pg.evaluate("location.hash='#/find/ELG-020'"); pg.wait_for_timeout(1200); t = pg.inner_text("main")
    chk("public page: provenance at state level", "From a collection · Nevada" in t and "exact locality" not in t, t[:160].replace("\n", " | "))
    pg.screenshot(path=O + "ux-outofarea-public.png")
    b.close()
    # 5) signed out add -> visible warning + queued
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome'); ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    ctx.add_init_script("window.ROLLING_OAK_MOCK={user:null,online:false}"); ctx.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e))); pg.goto(U); pg.wait_for_selector(".card")
    walk(pg, "rock", "pebble", "", "smooth", "20", IMG2, "signedout"); pg.click("#next"); pg.wait_for_timeout(300); pg.click("#save"); pg.wait_for_timeout(1200)
    al = pg.locator("[role=alert]").all_inner_texts(); chk("signed-out save warns visibly", any("not signed in" in a for a in al), al)
    pg.screenshot(path=O + "ux-after-signedout-warning.png"); b.close()
print("ERRORS", errs); print("FAILS", fails)
