"""Theme logo swap regression: toggling the theme swaps the visible logo image instantly (no reload) at every logo spot,
at 1280 and 390: home hero, sidebar (desktop), sign-in dialog, About page. The mobile top bar keeps the transparent circular icon,
so there we assert the icon has a transparent background and the bar itself turns light. Usage: python3 tests/theme_logo_regress.py URL"""
import sys
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
JS = """sel => { const r = document.querySelector(sel); if (!r) return null; const im = [...r.querySelectorAll('img')].find(i => i.offsetParent !== null && i.getBoundingClientRect().width > 0);
  return im ? (im.currentSrc || im.src).split('/').pop() : null; }"""
def src(pg, spot): return pg.evaluate(JS, f"[data-logo-spot={spot}]")
def theme(pg): return pg.evaluate("document.documentElement.dataset.theme")
def toggle(pg): pg.evaluate("document.getElementById('themeToggle').click()"); pg.wait_for_timeout(500)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for w, h in [(1280, 900), (390, 844)]:
        c = b.new_context(viewport={"width": w, "height": h}); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(U + "#/home"); pg.wait_for_selector("#view-home .landing", state="visible"); pg.wait_for_timeout(1500)
        chk(f"@{w} starts dark", theme(pg) == "dark")
        spots = ["hero"] + (["sidebar"] if w > 900 else [])
        d = {s: src(pg, s) for s in spots}; toggle(pg); l = {s: src(pg, s) for s in spots}
        chk(f"@{w} toggled to light without reload", theme(pg) == "light")
        for s in spots: chk(f"@{w} {s} logo swaps on toggle", d[s] and l[s] and d[s] != l[s] and "light" in l[s], f"{d[s]} -> {l[s]}")
        if w <= 900:
            t = src(pg, "topbar"); bg = pg.evaluate("getComputedStyle(document.querySelector('.site-header')).backgroundColor")
            alpha = pg.evaluate("""() => new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); res(x.getImageData(1, 1, 1, 1).data[3]); }; i.src = document.querySelector('[data-logo-spot=topbar] img').currentSrc; })""")
            chk(f"@{w} topbar icon transparent corner (no box)", alpha == 0, str(alpha)); chk(f"@{w} topbar light in light mode", bg in ("rgb(251, 247, 238)",), bg)
        pg.click("#authBtn"); pg.wait_for_timeout(500); sl = src(pg, "signin"); toggle(pg) if False else None
        pg.evaluate("document.getElementById('authDlg').close()"); toggle(pg); pg.click("#authBtn"); pg.wait_for_timeout(500); sd = src(pg, "signin")
        chk(f"@{w} sign-in logo swaps", sl and sd and sl != sd and "light" in sl, f"light={sl} dark={sd}"); pg.evaluate("document.getElementById('authDlg').close()")
        pg.goto(U + "#/about"); pg.wait_for_timeout(800); ad = src(pg, "about"); toggle(pg); al = src(pg, "about")
        chk(f"@{w} about logo swaps", ad and al and ad != al and "light" in al, f"{ad} -> {al}")
        pg.reload(); pg.wait_for_timeout(1500); chk(f"@{w} light persists on load", theme(pg) == "light" and "light" in (src(pg, "about") or ""), src(pg, "about"))
        pg.goto(U + "#/home"); pg.wait_for_timeout(800); chk(f"@{w} hero light on load", "light" in (src(pg, "hero") or ""), src(pg, "hero"))
        c.close()
    chk("no page errors", not errs, str(errs[:3]))
print("FAILS", fails); sys.exit(1 if fails else 0)
