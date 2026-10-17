/* UI rebuild shell: signed-in/public state on <body>, landing auth buttons, mobile bottom nav "More",
   and the PUBLIC display sanitizer. In public views (signed out, or Discover / shared find pages) ELG- catalog IDs
   are shown as the find's name instead; IDs stay in data, URLs and the owner's own views. "Elgin" place text
   is softened in rendered text only (stored provenance is unchanged; form inputs are never touched). */
(() => {
  "use strict";
  const body = document.body, ID_RE = /\bELG-\d{3,}\b/g;
  const signedIn = () => !!(window.Cloud && Cloud.state && Cloud.state().user);
  const route = () => (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1];
  const PUBLIC_ROUTES = new Set(["discover", "find"]);
  const nameOf = id => { const r = window.App && App.all && App.all.find(x => x.catalog_id === id); return (r && (r.title || r.object_type || r.suggestion_1)) || "Find"; };
  const ELGIN = [[/\s*\(Elgin area\)/g, ""], [/\bthe Elgin property\b/g, "the property"], [/\bnot an Elgin surface find\b/g, "not a local surface find"], [/\bElgin\b/g, "local"]];
  const fixText = (t, ids) => { let o = t; if (ids) o = o.replace(ID_RE, m => nameOf(m)); if (o.includes("Elgin")) ELGIN.forEach(([a, b]) => o = o.replace(a, b)); return o; };
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "NOSCRIPT"]);
  function scope() { // which subtrees are public right now
    if (!signedIn()) return [body];
    return [...document.querySelectorAll("#view-discover, #view-find")].filter(el => !el.hidden);
  }
  function clean(root, ids) {
    if (!root || root.closest && root.closest("[contenteditable], form")) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => n.nodeType === 1 ? (SKIP.has(n.tagName) || n.tagName === "FORM" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = w.nextNode())) { const v = n.nodeValue; if ((ids && ID_RE.test(v)) || v.includes("Elgin")) { ID_RE.lastIndex = 0; const f = fixText(v, ids); if (f !== v) n.nodeValue = f; } ID_RE.lastIndex = 0; }
    if (ids) root.querySelectorAll && root.querySelectorAll("[aria-label],[alt],[title]").forEach(el => ["aria-label", "alt", "title"].forEach(a => { const v = el.getAttribute(a); if (v && ID_RE.test(v)) el.setAttribute(a, v.replace(ID_RE, m => nameOf(m))); ID_RE.lastIndex = 0; }));
  }
  let busy = false;
  function run() { if (busy) return; busy = true; try {
      const pub = !signedIn(); body.classList.toggle("is-public", pub); body.classList.toggle("signed-in", !pub); body.classList.toggle("public-route", PUBLIC_ROUTES.has(route()));
      document.querySelectorAll("[data-public-only]").forEach(el => el.hidden = !pub); document.querySelectorAll("[data-owner-only]").forEach(el => el.hidden = pub);
      document.querySelectorAll("a.side-brand, a.brand").forEach(a => a.setAttribute("href", pub ? "#/home" : "#/catalog")); // logo goes Home when signed out
      scope().forEach(r => clean(r, true));
      if (!pub) document.querySelectorAll("#main, #modal, .site-header").forEach(r => clean(r, false)); // Elgin text only, owner views keep IDs
    } finally { busy = false; } }
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(run, 30); };
  new MutationObserver(later).observe(body, { childList: true, subtree: true, characterData: true });
  addEventListener("hashchange", later);
  const boot = () => { run(); if (window.Cloud && Cloud.on) try { Cloud.on(later); } catch {} };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  let k = 0; const iv = setInterval(() => { run(); if (++k > 20) clearInterval(iv); }, 500);
  /* Landing buttons open the existing sign-in dialog. */
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-auth-open]"); if (a) { const b = document.getElementById("authBtn"); if (b) b.click(); if (a.dataset.authOpen === "signup") setTimeout(() => { const pw = document.getElementById("authPw"), su = document.getElementById("authSignUp"); (document.getElementById("authEmail") || pw)?.focus(); su && su.classList.add("pulse"); }, 60); }
    const m = e.target.closest("[data-open-menu]"); if (m) { e.stopPropagation(); document.getElementById("menuBtn")?.click(); }
  });
  /* Bottom nav: mark the current page. */
  const mark = () => document.querySelectorAll(".bottom-nav a[data-route]").forEach(a => a.dataset.route === route() ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  addEventListener("hashchange", mark); mark();
  window.Shell = { run, signedIn, nameOf };
})();
