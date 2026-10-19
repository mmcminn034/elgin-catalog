"""Expert resources directory (migration 020): public, state + field filters, note, Texas kept, national + regional entries.
Usage: python3 tests/experts_directory_regress.py https://unearthedfinds.com/"""
import sys, re, json, urllib.request, secrets
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"; fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i if i != "" else ""); ok or fails.append(n)
cfg = urllib.request.urlopen(U + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1)
rows = json.load(urllib.request.urlopen(urllib.request.Request(SB + "/rest/v1/texas_resources?select=*&limit=1000", headers={"apikey": ANON, "Authorization": "Bearer " + ANON})))
st = {r["state"] for r in rows} - {"National", "Regional", "Texas"}
chk("[anon API] directory readable: 12 Texas + >= 15 more states", sum(r["state"] == "Texas" for r in rows) == 12 and len(st) >= 15, (len(rows), len(st)))
chk("every row has source URL + verified date + kind + region", all(r["source_url"].startswith("http") and r["last_verified"] and r["kind"] in ("organization", "public inquiry") and r["region"] for r in rows))
chk("national entries present", all(any(k in r["name"] for r in rows) for k in ("Society for American Archaeology", "Archaeological Institute of America", "Vertebrate Paleontology", "Paleontological Society", "National Association of State Archaeologists", "American Federation of Mineralogical", "projectilepoints.net")))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(service_workers="block").new_page(); pg.goto(U + "#/experts"); pg.wait_for_timeout(4500)
    t = pg.inner_text("#view-experts"); n_all = pg.locator("#dirList li").count()
    chk("[anon UI] note shown", "Public contacts only. We are expanding state by state. Exact find locations stay private." in t)
    chk("[anon UI] all entries listed", n_all == len(rows), (n_all, len(rows)))
    pg.select_option("#dirState", "Idaho"); pg.wait_for_timeout(500); ti = pg.inner_text("#dirList")
    chk("[anon UI] Idaho filter: Idaho + NFMS + national only", "Idaho State Historic Preservation" in ti and "Northwest Federation" in ti and "Society for American Archaeology" in ti and "Texas Historical" not in ti and "California" not in ti.split("National")[0])
    pg.select_option("#dirState", ""); pg.click("[data-dir-field=fossils]"); pg.wait_for_timeout(500)
    sp = pg.evaluate("[...document.querySelectorAll('#dirList li')].map(li => [...li.querySelectorAll('.chip.spec')].map(c => c.innerText))")
    chk("[anon UI] Fossils filter shows only fossil entries", sp and all("Fossils" in x for x in sp), len(sp))
    pg.select_option("#dirState", "Texas"); pg.click('[data-dir-field=""]'); pg.wait_for_timeout(500); tt = pg.inner_text("#dirList")
    chk("[anon UI] Texas filter keeps all 12 Texas entries + SCFMS", pg.locator("#dirList li[data-state=Texas]").count() == 12 and "South Central Federation" in tt)
    pg.screenshot(path="/workspace/site-improvements/experts-directory.png", full_page=True); b.close()
print("FAILS", fails); sys.exit(1 if fails else 0)
