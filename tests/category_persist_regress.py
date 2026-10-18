import os
import json, sys
from playwright.sync_api import sync_playwright
U=sys.argv[1] if len(sys.argv)>1 else "http://localhost:8765/"; TAG=sys.argv[2] if len(sys.argv)>2 else "after"
O=f"/workspace/elgin-catalog-previews/s3-category-{TAG}-"; errs=[]; fails=[]
# Fixture: ELG-007 in its pre-2026-10-16 state (an artifact pebble with a recategorize suggestion). The live data moved it to Rocks in the re-review.
seed=json.load(open(os.environ.get("EC_SEED") or os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","data","catalog.json")))  # EC_SEED: full fixture kept outside the repo
for _r in seed:
    if _r["catalog_id"]=="ELG-007": _r.update(category="artifact", object_type="Pebble", suggestion_1="Natural creek pebble", category_note="", category_history=[]); _r.pop("category_kept",None)
def route_seed(ctx): ctx.route("**/data/catalog.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(seed)))
def cloud_rows(cat="artifact", hist=None):
    out=[]
    for r in seed:
        x={k:v for k,v in r.items() if k not in("photos","private_location")}; x["photos"]=[]; x["owner"]=None; x["is_public"]=True; x["annotations"]={}
        x.setdefault("category_history",[])
        if r["catalog_id"]=="ELG-007": x["category"]=cat; x["category_history"]=hist if hist is not None else []
        out.append(x)
    return out
def route_cloud(ctx, rows):
    def h(route):
        u=route.request.url
        if "/rest/v1/finds" in u: return route.fulfill(status=200, content_type="application/json", body=json.dumps(rows))
        route.fulfill(status=200, content_type="application/json", body="[]")
    ctx.route("**/*.supabase.co/**", h)
def cat_of(pg): return pg.evaluate("""() => { const c=document.querySelector('.card[data-id="ELG-007"]'); return document.querySelector('.ctab[aria-selected=true]').textContent.trim() + ' | ' + (c?'visible':'not in tab'); }""")
def kind(pg):
    pg.evaluate("document.querySelector('.card[data-id=\"ELG-007\"]')?.click() || (location.hash='#/record/ELG-007')"); pg.wait_for_timeout(500)
    t=pg.inner_text("#mBody"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    return "Rocks" if "Collection\nRocks" in t or "Collection\tRocks" in t else ("Artifacts" if "Artifacts" in t.split("Collection",1)[-1][:40] else t.split("Collection",1)[-1][:40])
def chk(name, got, want):
    print(f"{name}: {got}"); (got==want) or fails.append(f"{name}: got {got!r} want {want!r}")
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx=b.new_context(viewport={"width":1280,"height":900}); pg=ctx.new_page()
    pg.on("console", lambda m: m.type=="error" and errs.append(m.text)); pg.on("pageerror", lambda e: errs.append(str(e)))
    # Phase 1: signed-in but cloud sync off (mock) -> move must WARN visibly, not silently stay local
    ctx.add_init_script("window.ROLLING_OAK_MOCK={user:{id:'u1',email:'mark@example.com'},online:false}")
    ctx.route("**/*.supabase.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body="[]")); route_seed(ctx)
    pg.goto(U + "#/catalog"); pg.wait_for_selector(".card"); pg.evaluate("document.querySelector('.card[data-id=\"ELG-007\"]').click()"); pg.wait_for_timeout(400)
    pg.screenshot(path=O+"1-banner.png")
    pg.click("[data-recat=move]"); pg.wait_for_timeout(700)
    pg.screenshot(path=O+"2-after-move-toast.png")
    warn=pg.locator("[role=alert]").all_inner_texts(); print("warning toast:", warn)
    if TAG=="after" and not any("device only" in w for w in warn): fails.append("no visible sync warning")
    pg.keyboard.press("Escape"); chk("after move", kind(pg), "Rocks")
    pg.reload(); pg.wait_for_selector(".card"); chk("after reload", kind(pg), "Rocks")
    pend=pg.evaluate("localStorage.getItem('ro-pending-sync')"); print("pending queue:", pend)
    if TAG=="after" and "ELG-007" not in (pend or ""): fails.append("not queued for retry")
    pg.close(); ctx.close()
    # Phase 2: keep IndexedDB (same profile), now a REAL cloud pull returns stale artifact rows + seed refresh + SW update
    ctx2=b.new_context(viewport={"width":1280,"height":900}); pg=ctx2.new_page()
    pg.on("console", lambda m: m.type=="error" and errs.append(m.text)); pg.on("pageerror", lambda e: errs.append(str(e)))
    route_cloud(ctx2, cloud_rows("artifact")); route_seed(ctx2)
    pg.goto(U + "#/catalog"); pg.wait_for_selector(".card")
    # move with real (unauthenticated) client, then reload with stale cloud data
    pg.evaluate("document.querySelector('.card[data-id=\"ELG-007\"]').click()"); pg.wait_for_timeout(400); pg.click("[data-recat=move]"); pg.wait_for_timeout(600); pg.keyboard.press("Escape")
    pg.reload(); pg.wait_for_selector(".card"); chk("stale cloud pull", kind(pg), "Rocks")
    pg.evaluate("fetch('data/catalog.json',{cache:'reload'})"); pg.wait_for_timeout(300)
    pg.evaluate("navigator.serviceWorker && navigator.serviceWorker.getRegistration().then(r=>r&&r.update())"); pg.wait_for_timeout(800)
    pg.evaluate("caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x))))"); pg.reload(); pg.wait_for_selector(".card")
    chk("seed refresh + SW update + reload", kind(pg), "Rocks")
    pg.evaluate("location.hash='#/catalog'"); pg.wait_for_timeout(300)
    pg.evaluate("[...document.querySelectorAll('.ctab')].find(t=>/Rocks/.test(t.textContent))?.click()"); pg.wait_for_timeout(400)
    pg.locator("#browse").scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=O+"3-rocks-tab-after-cloud-seed-sw.png")
    pg.close(); ctx2.close()
    # Phase 3: another device has an OLD full local copy (artifact) but the cloud has the newer Rocks decision -> Rocks
    ctx3=b.new_context(viewport={"width":1280,"height":900}); pg=ctx3.new_page()
    pg.on("console", lambda m: m.type=="error" and errs.append(m.text)); pg.on("pageerror", lambda e: errs.append(str(e)))
    route_cloud(ctx3, cloud_rows("rock", [{"from":"artifact","to":"rock","date":"2026-10-13","ts":"2026-10-13T14:00:00.000Z","reason":"owner confirmed"}]))
    pg.goto(U + "#/catalog"); pg.wait_for_selector(".card")
    pg.evaluate("""() => new Promise(res => { const q = indexedDB.open('elgin-catalog'); q.onsuccess = () => { const db = q.result; const st = db.objectStoreNames[0]; const t = db.transaction(st,'readwrite');
      t.objectStore(st).put({catalog_id:'ELG-007', category:'artifact', object_type:'Pebble', notes:'old edit', category_history:[]}); t.oncomplete = () => res(); }; })""")
    pg.reload(); pg.wait_for_selector(".card"); chk("stale local copy vs newer cloud", kind(pg), "Rocks")
    print("ERRORS", errs); print("FAILS", fails); b.close()
