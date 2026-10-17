"""Shell polish regression: compact header (<=60px), no bottom nav, sidebar XOR hamburger, footer text,
and no ELG-/Elgin in visible public text or accessible names (signed out). Usage: python3 tests/polish_regress.py URL"""
import sys
from playwright.sync_api import sync_playwright
U = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/"; fails = []; errs = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for theme in ["dark", "light"]:
        for w, h in [(1280, 900), (390, 844)]:
            c = b.new_context(viewport={"width": w, "height": h}); c.add_init_script(f"try{{localStorage.setItem('elgin-theme','{theme}')}}catch(e){{}}"); pg = c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
            t = f"@{w} {theme}"
            for path in ["", "#/catalog", "#/discover"]:
                pg.goto(U + path); pg.wait_for_timeout(2500)
                txt = pg.inner_text("body"); acc = pg.evaluate("[...document.querySelectorAll('[aria-label],[alt],[title]')].filter(e=>e.offsetParent!==null).map(e=>[e.getAttribute('aria-label'),e.getAttribute('alt'),e.getAttribute('title')].join(' ')).join(' ')")
                chk(f"{t} '{path or '/'}' no ELG-/Elgin visible", "ELG-" not in txt and "Elgin" not in txt and "ELG-" not in acc)
            pg.goto(U); pg.wait_for_timeout(1500)
            hh = pg.evaluate("document.querySelector('.site-header').getBoundingClientRect().height"); chk(f"{t} header compact", hh <= 60, str(hh))
            chk(f"{t} no bottom nav", pg.locator(".bottom-nav").count() == 0)
            side, burger = pg.locator(".side-nav").is_visible(), pg.locator("#menuBtn").is_visible()
            chk(f"{t} sidebar xor hamburger", side != burger and (side if w > 900 else burger), f"side={side} burger={burger}")
            chk(f"{t} footer", "© 2026 PolForge, LLC" in pg.inner_text(".site-footer"))
            if w <= 900:
                pg.click("#menuBtn"); pg.wait_for_timeout(300)
                ic = pg.evaluate("[...document.querySelectorAll('#navMenu > a .si')].filter(e=>e.getBoundingClientRect().width>0).length"); chk(f"{t} drawer icons visible", ic >= 4, str(ic))
            c.close()
    chk("no page errors", not errs, str(errs[:3]))
print("FAILS", fails); sys.exit(1 if fails else 0)
