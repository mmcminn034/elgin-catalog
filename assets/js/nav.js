/* Header hamburger menu: all navigation lives here on every screen size. */
(() => {
  "use strict";
  const btn = document.getElementById("menuBtn"), menu = document.getElementById("navMenu"); if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll("a, button")].filter(el => !el.hidden && el.offsetParent !== null);
  const open = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-label", "Close menu"); const it = items(); (it.find(a => a.getAttribute("aria-current") === "page") || it[0])?.focus(); };
  const close = (refocus = true) => { if (menu.hidden) return; menu.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-label", "Menu"); if (refocus) btn.focus(); };
  btn.addEventListener("click", () => menu.hidden ? open() : close());
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); close(); } });
  menu.addEventListener("click", e => { if (e.target.closest("a")) close(false); });
  menu.addEventListener("keydown", e => { const it = items(), i = it.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); it[(i + 1) % it.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); it[(i - 1 + it.length) % it.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); it[0].focus(); } else if (e.key === "End") { e.preventDefault(); it[it.length - 1].focus(); }
    else if (e.key === "Tab" && ((e.shiftKey && i === 0) || (!e.shiftKey && i === it.length - 1))) close(false); });
  addEventListener("hashchange", () => close(false));
})();
