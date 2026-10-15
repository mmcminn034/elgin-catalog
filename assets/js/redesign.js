/* Rolling Oak redesign (preview): sidebar shell, Review queue, Reference Library, Settings hub, and the find review
   layout (hero photo + thumbnails, AI Analysis panel with earned confidence, structured fields, Reference Matches).
   Purely additive: every existing view, tab, control, filter, status and the disclaimer stay in place below. */
(() => {
  "use strict";
  const $ = s => document.querySelector(s), esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SIL = { artifact: '<path d="M32 4 C40 20 46 34 44 46 L38 50 L38 60 L26 60 L26 50 L20 46 C18 34 24 20 32 4Z"/>', fossil: '<path d="M32 8a24 24 0 1 0 24 24 18 18 0 0 0-18-18 12 12 0 0 0-12 12 7 7 0 0 0 7 7"/>', rock: '<path d="M12 40 L20 18 L38 10 L54 24 L52 46 L30 56Z"/>' };
  const sil = (k, label) => `<svg class="sil" viewBox="0 0 64 64" role="img" aria-label="${esc(label || "Type silhouette (placeholder)")}">${SIL[k] || SIL.artifact}</svg>`;
  const kindOf = r => window.App ? App.kindOf(r) : r.category;
  const srcName = e => { const s = (e.sources || [])[0] || {}; return /pidba/i.test(s.name) ? "PIDBA" : s.name || "Reference"; };

  /* ---------- review layout on the record Overview tab ---------- */
  function topScore(r) {
    if (!window.Analysis || !Analysis.rank) return null; const k = kindOf(r), rk = Analysis.rank(r, k); if (!rk.length) return null;
    return { x: rk[0], rk, sc: Analysis.scoreOf ? Analysis.scoreOf(r, rk[0], rk[1], k) : null };
  }
  function refMatches(r, t) {
    const pub = window.Analysis && Analysis.pub && Analysis.pub(); if (!pub || !window.Prompt) return [];
    return Prompt.rankReferences(r, pub.types, pub.meta.trait_patterns, { k: 6, region: Analysis.regionHint ? Analysis.regionHint(r) : {}, category: kindOf(r), hintNames: t ? t.rk.slice(0, 3).map(x => String(x.c.name).replace(/\s*\(.*$/, "")) : [] });
  }
  function reviewHtml(r) {
    const ps = window.App ? App.pics(r) : [], t = topScore(r), sc = t && t.sc, k = kindOf(r);
    const big = ps[0] ? `<button type="button" class="rv-main" data-lb="0" aria-label="Enlarge ${esc(ps[0].label)}"><img id="rvMainImg" src="${esc(ps[0].src || ps[0].thumb)}" alt="${esc(r.catalog_id)} ${esc(ps[0].label)}"></button>` : `<div class="rv-main rv-empty">${sil(k)}<p class="help">No photos yet.</p></div>`;
    const thumbs = ps.length > 1 ? `<div class="rv-thumbs" role="group" aria-label="Photo thumbnails">${ps.map((p, j) => `<button type="button" class="rv-th${j ? "" : " on"}" data-rvth="${j}" aria-label="Show ${esc(p.label)}" aria-pressed="${!j}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></button>`).join("")}</div>` : "";
    const word = sc ? `${sc.pct}% ${sc.band === "Low-moderate" ? "Low-moderate" : sc.band} Confidence` : "No match yet";
    const panel = `<section class="rv-ai" aria-labelledby="rvAiH"><h3 id="rvAiH">AI Analysis <span class="muted">rules engine · earned score</span></h3>
      ${sc ? `<div class="rv-conf rv-${sc.color}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sc.pct}" aria-label="Confidence ${sc.pct}%"><div class="rv-conf-top"><strong>${esc(word)}</strong></div><div class="rv-bar"><i style="width:${sc.pct}%"></i></div></div>` : '<p class="help">Add key features, measurements and photos to earn a score.</p>'}
      ${t ? `<p class="rv-type"><span class="muted">Suggested type</span><br><strong>${esc(t.x.c.name)}</strong>${t.x.c.period ? ` <span class="muted">· ${esc(t.x.c.period)}</span>` : ""}</p>` : ""}
      ${sc ? `<details class="why-score rv-why"><summary>Why this score</summary><ul>${sc.factors.map(f => `<li class="${f.sign === "+" ? "fplus" : "fminus"}"><strong>${f.sign}${f.pts}</strong> ${esc(f.label)}${f.source ? ` <a href="${esc(f.source.url)}" target="_blank" rel="noopener">${esc(f.source.name)}</a>` : ""}</li>`).join("")}</ul></details>` : ""}
      <div class="rv-acts"><button type="button" class="btn primary" data-rv="keep">✓ Keep</button><button type="button" class="btn" data-rv="correct">✎ Correct this</button><button type="button" class="btn" data-rv="measure">📏 Add measurement</button></div>
      <p class="help">${esc(window.Learn ? Learn.DISCLAIMER : "Research suggestions only, not identifications.")}</p></section>`;
    const stat = window.S5 ? S5.badge(r) : `<span class="badge">${esc(r.status || "Draft")}</span>`, mm = v => v ? esc(v) + " mm" : '<span class="muted">not recorded</span>';
    const vis = window.Learn && Learn.vis ? Learn.vis(r) : (r.is_public ? "public" : "private");
    const fields = `<section class="rv-fields" aria-label="Find details"><div class="rv-badges">${stat}<span class="loc-badge" title="Exact locations are never shown publicly">🔒 Location: ${esc(r.location_sharing && r.location_sharing !== "Private" ? r.location_sharing + " only" : "Private")}</span><span class="chip">${esc(vis)}</span></div>
      <dl class="rv-dl"><div><dt>Material</dt><dd>${esc(r.material) || '<span class="muted">not recorded</span>'}</dd></div><div><dt>Length</dt><dd>${mm(r.length_mm)}</dd></div><div><dt>Width</dt><dd>${mm(r.width_mm)}</dd></div><div><dt>Method</dt><dd>${esc(r.measure_method) || '<span class="muted">—</span>'}</dd></div>
      <div class="rv-notes"><dt>Notes</dt><dd>${esc(r.owner_observations || r.key_features) || '<span class="muted">No notes yet.</span>'}</dd></div></dl></section>`;
    const refs = refMatches(r, t);
    const row = `<section class="rv-refs" aria-labelledby="rvRefH"><h3 id="rvRefH">Reference Matches <span class="muted">published typology, not the find</span></h3>${refs.length ? `<div class="rv-ref-row">${refs.map(m => { const s = (m.entry.sources || [])[0] || {}; return `<article class="rv-ref">${sil(m.entry.category || k, m.entry.name + " silhouette placeholder")}<div><h4>${esc(m.entry.name)}</h4><p class="muted">${esc([m.entry.period, m.entry.dates].filter(Boolean).join(" · ") || m.entry.typology_system)}</p><p><span class="src-tag">${esc(srcName(m.entry))}</span> <span class="chip">match ${esc(m.score)}</span></p><p class="rv-ref-links">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Source page ↗</a>` : ""} <button type="button" class="btn ghost small" data-refd="${esc(m.entry.id)}">Details</button></p></div></article>`; }).join("")}</div>` : `<p class="help">${window.Analysis && Analysis.loadErrors && Analysis.loadErrors().length ? "⚠ Reference data failed to load; reload to retry." : "No published references match the recorded features yet."}</p>`}<p class="help">Images are never copied from sources; silhouettes are generic placeholders. Follow the source link to see published photos.</p></section>`;
    return `<div class="rv-layout" data-rv-for="${esc(r.catalog_id)}"><div class="rv-left">${big}${thumbs}${fields}</div>${panel}</div>${row}<h3 class="gal-h rv-more">Full record</h3>`;
  }
  function decorateModal() {
    const p = $("#mBody #panel-0"), r = window.App && App.current; if (!p || !r || p.querySelector(".rv-layout")) return;
    p.insertAdjacentHTML("afterbegin", reviewHtml(r)); $("#modal")?.classList.add("rv-wide");
  }
  document.addEventListener("click", e => {
    const th = e.target.closest("[data-rvth]"); if (th) { const r = App.current, ps = App.pics(r), j = +th.dataset.rvth, img = $("#rvMainImg"); if (img && ps[j]) { img.src = ps[j].src || ps[j].thumb; img.alt = `${r.catalog_id} ${ps[j].label}`; img.closest("[data-lb]").dataset.lb = j; }
      document.querySelectorAll("[data-rvth]").forEach(b => { const on = b === th; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); return; }
    const b = e.target.closest("[data-rv]"); if (!b) return; const a = b.dataset.rv;
    if (a === "measure") { $("#tab-1")?.click(); return; }
    const tgt = document.querySelector(`#panel-0 [data-corr=${a === "keep" ? "keep" : "open"}][data-f=type]`);
    if (tgt) { tgt.click(); if (a === "correct") setTimeout(() => (document.querySelector("#panel-0 [data-cf=type]") || tgt).scrollIntoView({ block: "center" }), 50); }
    else if (a === "correct") $("#tab-3")?.click(); else window.App && App.toast("Sign in as an editor to keep or correct suggestions.");
  });
  new MutationObserver(decorateModal).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- new views ---------- */
  function reviewQueue() {
    const host = $("#reviewBody"); if (!host || !window.App) return; const need = App.all.filter(r => window.S5 ? S5.needs(r) : r.status !== "Reviewed");
    const by = s => App.all.filter(r => (r.status || "Draft") === s).length;
    host.innerHTML = `<dl class="stats rv-stats"><div><dt>Still needs review</dt><dd>${need.length}</dd></div><div><dt>Reviewed</dt><dd>${by("Reviewed")}</dd></div><div><dt>Verified</dt><dd>${by("Verified")}</dd></div><div><dt>Total</dt><dd>${App.all.length}</dd></div></dl>
      ${need.length ? `<ul class="rq">${need.map(r => { const t = topScore(r), sc = t && t.sc, p = App.pics(r)[0]; return `<li><a class="rq-item" href="#/record/${esc(r.catalog_id)}">${p ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : sil(kindOf(r))}<span class="rq-t"><strong>${esc(r.catalog_id)}</strong> ${esc(r.object_type || "")}<span class="muted">${esc(App.KINDS[kindOf(r)].label)} · ${t ? esc(t.x.c.name) : "no match yet"}</span></span>${sc ? `<span class="rq-pct rv-${sc.color}">${sc.pct}%</span>` : ""}${window.S5 ? S5.badge(r) : ""}</a></li>`; }).join("")}</ul>` : '<p class="empty">Nothing waiting. Every find has been reviewed.</p>'}`;
  }
  let LIB = { q: "", region: "", source: "", period: "", page: 0 };
  function library() {
    const host = $("#libraryBody"); if (!host) return; const pub = window.Analysis && Analysis.pub && Analysis.pub();
    if (!pub) { host.innerHTML = Analysis && Analysis.loadErrors && Analysis.loadErrors().length ? '<p class="err" role="alert">⚠ Reference data failed to load. Reload to retry.</p>' : '<p class="help">Loading reference data…</p>'; setTimeout(library, 600); return; }
    const T = pub.types, uniq = a => [...new Set(a.filter(Boolean))].sort();
    const regions = uniq(T.flatMap(t => [t.continent, ...(t.admin1 || [])])), sources = uniq(T.flatMap(t => (t.sources || []).map(s => s.name))), periods = uniq(T.map(t => t.period).flatMap(p => String(p || "").split(" / ")));
    if (!host.querySelector("#libQ")) host.innerHTML = `<div class="toolbar" role="search"><label class="field grow"><span class="sr-only">Search references</span><input id="libQ" type="search" placeholder="Search type names and aliases…"></label>
      <label class="field"><span class="sr-only">Region</span><select id="libRegion"><option value="">All regions</option>${regions.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
      <label class="field"><span class="sr-only">Source</span><select id="libSource"><option value="">All sources</option>${sources.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
      <label class="field"><span class="sr-only">Period</span><select id="libPeriod"><option value="">All periods</option>${periods.map(x => `<option>${esc(x)}</option>`).join("")}</select></label></div><p class="count" id="libCount" aria-live="polite"></p><div class="lib-grid" id="libGrid"></div><div class="row lib-pg"><button type="button" class="btn" id="libPrev">← Previous</button><button type="button" class="btn" id="libNext">Next →</button></div>
      <p class="help">${esc(pub.types.length)} published reference summaries: facts and links only, with each entry's source, retrieval date and license. Texas types appear first. Not the owner's finds.</p>`;
    const set = () => { LIB = { q: $("#libQ").value.trim().toLowerCase(), region: $("#libRegion").value, source: $("#libSource").value, period: $("#libPeriod").value, page: 0 }; draw(); };
    ["#libQ", "#libRegion", "#libSource", "#libPeriod"].forEach(s => $(s).oninput = set); $("#libPrev").onclick = () => { LIB.page = Math.max(0, LIB.page - 1); draw(); }; $("#libNext").onclick = () => { LIB.page++; draw(); };
    function draw() {
      const L = T.filter(t => (!LIB.q || [t.name, ...(t.aliases || [])].some(n => String(n).toLowerCase().includes(LIB.q))) && (!LIB.region || t.continent === LIB.region || (t.admin1 || []).includes(LIB.region))
        && (!LIB.source || (t.sources || []).some(s => s.name === LIB.source)) && (!LIB.period || String(t.period || "").split(" / ").includes(LIB.period))).sort((a, b) => (b.texas - a.texas) || ((a.home_priority || 3) - (b.home_priority || 3)) || a.name.localeCompare(b.name));
      const N = 48, pages = Math.max(1, Math.ceil(L.length / N)); LIB.page = Math.min(LIB.page, pages - 1);
      $("#libCount").textContent = `Showing ${L.length ? LIB.page * N + 1 : 0}–${Math.min(L.length, (LIB.page + 1) * N)} of ${L.length} reference types`;
      $("#libGrid").innerHTML = L.slice(LIB.page * N, (LIB.page + 1) * N).map(t => `<article class="lib-card">${sil(t.category, t.name + " silhouette placeholder")}<div><h3>${esc(t.name)}</h3><p class="muted">${esc([t.period, t.dates].filter(Boolean).join(" · ") || t.typology_system)}</p>
        <p class="muted">${esc([t.continent, (t.admin1 || []).slice(0, 4).join(", ") + ((t.admin1 || []).length > 4 ? ` +${t.admin1.length - 4}` : "")].filter(Boolean).join(": "))}</p>${t.length_mm ? `<p class="chip">L ${t.length_mm[0]}–${t.length_mm[1]} mm</p>` : ""}
        <p class="lib-src">${(t.sources || []).slice(0, 2).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="src-tag" title="${esc(s.license)}">${esc(/pidba/i.test(s.name) ? "PIDBA" : s.name)} ↗</a>`).join(" ")} <button type="button" class="btn ghost small" data-refd="${esc(t.id)}">Details</button></p></div></article>`).join("") || '<p class="empty">No reference types match these filters.</p>';
      $("#libPrev").disabled = LIB.page === 0; $("#libNext").disabled = LIB.page >= pages - 1;
    }
    draw();
  }
  function settings() {
    const host = $("#settingsBody"); if (!host) return; const st = window.Cloud && Cloud.state ? Cloud.state() : {}, user = st && st.user, dark = document.documentElement.dataset.theme === "dark", S = window.Score ? Score.DEFAULTS : null;
    host.innerHTML = `<div class="set-grid">
      <section class="set-card"><h2>Account</h2><p>${user ? `Signed in as <strong>${esc(user.email || user.phone || "you")}</strong>` : "You're browsing signed out."}</p><div class="row"><button type="button" class="btn primary" data-set="auth">${user ? "Account & sign out" : "Sign in"}</button>${user ? '<a class="btn" href="#/profile">Edit profile</a><a class="btn" href="#/members">Collection members</a>' : ""}<a class="btn" href="#/pricing">Membership</a></div></section>
      <section class="set-card"><h2>Appearance</h2><label class="check"><input type="checkbox" id="setDark" ${dark ? "checked" : ""}> Dark mode</label><button type="button" class="btn" data-set="install">⤓ Add to home screen</button></section>
      <section class="set-card"><h2>Data &amp; privacy</h2><p class="help">🔒 Exact find locations live only in an owner-only table and are never shown publicly. Exports leave location out unless you choose otherwise in the catalog toolbar.</p><div class="row"><button type="button" class="btn" data-set="csv">Export CSV</button><button type="button" class="btn" data-set="json">Export JSON</button><a class="btn" href="#/labels">Print QR labels</a>${st && st.user ? '<a class="btn needs-editor" href="#/map">Private find map</a>' : ""}</div></section>
      <section class="set-card"><h2>Confidence scoring</h2>${S ? `<p class="help">Rules engine cap ${S.rulesCap}% · AI cap ${S.aiCap}% · Verified + references agree: ${S.verifiedMax}%. Bands: ${S.bands.map(([n, l]) => `${l} ≥${n}%`).join(", ")}.</p>` : ""}<p class="help">${esc(window.Learn ? Learn.DISCLAIMER : "")}</p><a class="btn" href="#/about">About &amp; methods</a></section>
      <section class="set-card"><h2>More</h2><ul class="links"><li><a href="#/discover">Discover public finds</a></li><li><a href="#/timeline">Deep time</a></li><li><a href="#/people">People &amp; land</a></li><li><a href="#/about">About, legal &amp; disclaimers</a></li><li><a href="#/library">Reference Library</a></li></ul></section></div>`;
    host.querySelector("#setDark").onchange = () => $("#themeToggle").click();
    host.onclick = e => { const b = e.target.closest("[data-set]"); if (!b) return; const a = b.dataset.set;
      if (a === "auth") $("#authBtn").click(); else if (a === "csv") $("#exportCsv").click(); else if (a === "json") $("#exportJson").click(); else if (a === "install") { const i = $("#installBtn"); if (i && !i.hidden) i.click(); else App.toast("Use your browser's menu: Add to Home Screen."); } };
  }
  function onRoute() { const v = (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1]; document.querySelectorAll(".side-nav a[data-route]").forEach(a => a.dataset.route === v || (v === "record" && a.dataset.route === "catalog") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    if (v === "review") reviewQueue(); if (v === "library") library(); if (v === "settings") settings(); document.body.classList.remove("side-open"); }
  addEventListener("hashchange", onRoute); addEventListener("load", () => setTimeout(onRoute, 300));
  document.addEventListener("click", e => { if (e.target.closest("#sideToggle")) { const o = document.body.classList.toggle("side-open"); $("#sideToggle").setAttribute("aria-expanded", o); } });
  window.Redesign = { reviewHtml, library, settings, reviewQueue, refMatches };
})();
