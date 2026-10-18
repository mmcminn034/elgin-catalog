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
    const pub = window.Analysis && (Analysis.pubFor ? Analysis.pubFor(kindOf(r)) : Analysis.pub && Analysis.pub()); if (!pub || !window.Prompt) return [];
    return Prompt.rankReferences(r, pub.types, pub.meta.trait_patterns, { k: 6, region: Analysis.regionHint ? Analysis.regionHint(r) : {}, category: kindOf(r), hintNames: t ? t.rk.slice(0, 3).map(x => String(x.c.name).replace(/\s*\(.*$/, "")) : [] });
  }
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.2"/></svg>';
  const SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8zM18 13l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z"/></svg>';
  const rel = s => Math.max(0.01, Math.min(0.99, s / 12)).toFixed(2); /* relative match score: retrieval score / 12 (a strong name + trait + size + region match) */
  const whyText = sc => { const pos = sc.factors.filter(f => f.sign === "+" && !/^Starting point/.test(f.label)).sort((a, b) => b.pts - a.pts).slice(0, 4).map(f => f.label.replace(/^\d+ /, m => m).toLowerCase());
    const neg = sc.factors.filter(f => f.sign === "-" && !/^Capped/.test(f.label)).sort((a, b) => b.pts - a.pts).slice(0, 2).map(f => f.label.toLowerCase());
    return (pos.length ? (sc.pct >= 80 ? "Strong evidence: " : sc.pct >= 50 ? "Supporting evidence: " : "Limited evidence: ") + pos.join("; ") + "." : "Little evidence recorded yet.") + (neg.length ? " Held back by: " + neg.join("; ") + "." : ""); };
  function reviewHtml(r) {
    const ps = window.App ? App.pics(r) : [], t = topScore(r), sc = t && t.sc, k = kindOf(r), verified = r.status === "Verified";
    const big = ps[0] ? `<button type="button" class="rv-main" data-lb="0" aria-label="Enlarge ${esc(ps[0].label)}"><img id="rvMainImg" src="${esc(ps[0].src || ps[0].thumb)}" alt="${esc(r.catalog_id)} ${esc(ps[0].label)}"></button>` : `<div class="rv-main rv-empty">${sil(k)}<p class="help">No photos yet.</p></div>`;
    const thumbs = ps.length > 1 ? `<div class="rv-thumbs" role="group" aria-label="Photo thumbnails">${ps.map((p, j) => `<button type="button" class="rv-th${j ? "" : " on"}" data-rvth="${j}" aria-label="Show ${esc(p.label)}" aria-pressed="${!j}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></button>`).join("")}</div>` : "";
    const stat = window.S5 ? S5.badge(r) : `<span class="badge">${esc(r.status || "Draft")}</span>`, mm = v => v ? esc(v) + " mm" : '<span class="muted">not recorded</span>';
    const notes = String(r.owner_observations || r.key_features || ""), loc = r.location_sharing && r.location_sharing !== "Private" ? r.location_sharing + " only" : "Private";
    const main = `<section class="rv-card rv-left" aria-labelledby="rvTitle"><div class="rv-titlebar"><h3 id="rvTitle">${esc(r.title || (t && verified ? t.x.c.name + " · " + (r.object_type || "") : r.object_type || "Find"))}</h3>${verified ? `<span class="ver">${CHECK} Verified</span>` : ""}<button type="button" class="btn outline" data-rv="edit">✎ Edit find</button></div>
      ${big}${thumbs}
      <div class="rv-grid"><dl class="rv-f"><dt>Status</dt><dd>${stat}</dd></dl><dl class="rv-f"><dt>Material</dt><dd>${esc(r.material) || '<span class="muted">not recorded</span>'}</dd></dl>
      <dl class="rv-f"><dt>Length</dt><dd>${mm(r.length_mm)}</dd></dl><dl class="rv-f"><dt>Width</dt><dd>${mm(r.width_mm)}</dd></dl></div>
      <div class="rv-notes"><h4>Notes</h4><p>${esc(notes) || '<span class="muted">No notes yet.</span>'}</p><div class="rv-cc">${notes.length} / 500</div></div>
      <p class="rv-meta"><span class="loc-badge" title="Exact locations are never shown publicly">🔒 Location: ${esc(loc)}</span> <span class="chip">${esc(window.Learn && Learn.vis ? Learn.vis(r) : "")}</span> <span class="chip">${esc(r.measure_method || "Not measured")}</span></p></section>`;
    const sug = t ? t.rk.slice(0, 3) : [];
    const panel = `<section class="rv-card rv-ai" aria-labelledby="rvAiH"><h3 id="rvAiH">${SPARK} AI Analysis</h3>
      ${sc ? `<div class="rv-conf rv-${sc.color}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sc.pct}" aria-label="Confidence ${sc.pct}%"><span class="lab">Confidence Score</span><span class="big">${sc.pct}%</span><span class="band">${esc(sc.band)} Confidence ${SHIELD}</span><span class="bar"><i style="width:${sc.pct}%"></i></span></div>
      <div class="rv-why"><h4>Why this score:</h4><p>${esc(whyText(sc))}</p><details class="why-score"><summary>Show every factor (${sc.factors.length})</summary><ul>${sc.factors.map(f => `<li class="${f.sign === "+" ? "fplus" : "fminus"}"><strong>${f.sign}${f.pts}</strong> ${esc(f.label)}${f.source ? ` <a href="${esc(f.source.url)}" target="_blank" rel="noopener">${esc(f.source.name)}</a>` : ""}</li>`).join("")}</ul></details></div>` : '<p class="help">Add key features, measurements and photos to earn a score.</p>'}
      ${sug.length ? `<div class="rv-sugg"><h4>Suggested Type</h4><div class="chips">${sug.map((x, i) => `<span class="chip type"${i ? ' style="opacity:.8"' : ""}>${esc(x.c.name)}</span>`).join("")}</div></div>` : ""}
      <div class="rv-acts"><button type="button" class="btn green" data-rv="keep">✓ Keep</button><button type="button" class="btn outline" data-rv="correct">✎ Correct this</button><button type="button" class="btn outline" data-rv="measure">📏 Add Measurement</button></div>
      <p class="help">${esc(window.Learn ? Learn.DISCLAIMER : "Research suggestions only, not identifications.")}</p></section>`;
    const refs = refMatches(r, t), err = window.Analysis && Analysis.loadErrors && Analysis.loadErrors().length;
    const regionOf = e => (e.admin1 || []).find(a => a === (Analysis.regionHint ? Analysis.regionHint(r).admin1 : "")) || (e.admin1 || [])[0] || e.continent || "";
    const row = `<section class="rv-card rv-refs" aria-labelledby="rvRefH"><div class="rv-refs-h"><h3 id="rvRefH">Reference Matches</h3><span class="muted" title="Published typology, not the find">ⓘ published typology, not the find</span><a class="btn outline small needs-admin"${isAdmin() ? "" : " hidden"} href="#/library?q=${encodeURIComponent(t ? String(t.x.c.name).replace(/\s*\(.*$/, "") : "")}">View All Matches ↗</a></div>
      ${refs.length ? `<div class="rv-ref-row">${refs.slice(0, 4).map(m => { const s = (m.entry.sources || [])[0] || {}; return `<article class="rv-ref">${sil(m.entry.category || k, m.entry.name + " silhouette placeholder")}<div><h4>${esc(srcName(m.entry))}</h4><p>${esc(m.entry.name)}</p><p class="muted">${esc(regionOf(m.entry))}</p></div><span class="score-b" title="Relative match score">${rel(m.score)}</span><span class="rv-ref-links">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Source ↗</a> · ` : ""}<button type="button" class="btn ghost small" data-refd="${esc(m.entry.id)}">Details</button></span></article>`; }).join("")}</div>` : `<p class="${err ? "err" : "help"}" ${err ? 'role="alert"' : ""}>${err ? "⚠ Reference data failed to load; reload to retry." : "No published references match the recorded features yet."}</p>`}
      <p class="rv-foot">Reference datasets are sourced from public archaeological repositories. Silhouettes are placeholders; no source images are copied.</p></section>`;
    return `<div class="rv-layout" data-rv-for="${esc(r.catalog_id)}">${main}${panel}</div>${row}<h3 class="gal-h rv-more">Full record</h3>`;
  }
  function decorateModal() {
    const p = $("#mBody #panel-0"), r = window.App && App.current; if (!p || !r || p.querySelector(".rv-layout")) return;
    p.insertAdjacentHTML("afterbegin", reviewHtml(r)); $("#modal")?.classList.add("rv-wide"); topbar();
  }
  document.addEventListener("click", e => {
    const th = e.target.closest("[data-rvth]"); if (th) { const r = App.current, ps = App.pics(r), j = +th.dataset.rvth, img = $("#rvMainImg"); if (img && ps[j]) { img.src = ps[j].src || ps[j].thumb; img.alt = `${r.catalog_id} ${ps[j].label}`; img.closest("[data-lb]").dataset.lb = j; }
      document.querySelectorAll("[data-rvth]").forEach(b => { const on = b === th; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); return; }
    const b = e.target.closest("[data-rv]"); if (!b) return; const a = b.dataset.rv;
    if (a === "measure") { $("#tab-1")?.click(); return; }
    if (a === "edit") { $("#tab-3")?.click(); return; }
    const tgt = document.querySelector(`#panel-0 [data-corr=${a === "keep" ? "keep" : "open"}][data-f=type]`);
    if (tgt) { tgt.click(); if (a === "correct") setTimeout(() => (document.querySelector("#panel-0 [data-cf=type]") || tgt).scrollIntoView({ block: "center" }), 50); }
    else if (a === "correct") $("#tab-3")?.click(); else window.App && App.toast("Sign in as an editor to keep or correct suggestions.");
  });
  new MutationObserver(() => { decorateModal(); const h = document.querySelector(".site-header"); if (h) document.documentElement.style.setProperty("--tbh", h.offsetHeight + "px"); const tt = $("#tbTitle"); if (tt && !$("#modal").hidden !== (tt.textContent === "Find Review")) topbar(); }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- new views ---------- */
  function reviewQueue() {
    const host = $("#reviewBody"); if (!host || !window.App) return; const need = App.all.filter(r => (!window.Access || Access.canEdit(r)) && (window.S5 ? S5.needs(r) : r.status !== "Reviewed")); /* review = editing: owner/editor finds only */
    const by = s => App.all.filter(r => (r.status || "Draft") === s).length;
    host.innerHTML = `<dl class="stats rv-stats"><div><dt>Still needs review</dt><dd>${need.length}</dd></div><div><dt>Reviewed</dt><dd>${by("Reviewed")}</dd></div><div><dt>Verified</dt><dd>${by("Verified")}</dd></div><div><dt>Total</dt><dd>${App.all.length}</dd></div></dl>
      ${need.length ? `<ul class="rq">${need.map(r => { const t = topScore(r), sc = t && t.sc, p = App.pics(r)[0]; return `<li><a class="rq-item" href="#/record/${esc(r.catalog_id)}">${p ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : sil(kindOf(r))}<span class="rq-t"><strong>${esc(r.catalog_id)}</strong> ${esc(r.object_type || "")}<span class="muted">${esc(App.KINDS[kindOf(r)].label)} · ${t ? esc(t.x.c.name) : "no match yet"}</span></span>${sc ? `<span class="rq-pct rv-${sc.color}">${sc.pct}%</span>` : ""}${window.S5 ? S5.badge(r) : ""}</a></li>`; }).join("")}</ul>` : '<p class="empty">Nothing waiting. Every find has been reviewed.</p>'}`;
  }
  let LIB = { q: "", region: "", source: "", period: "", page: 0 };
  const hashQ = () => decodeURIComponent((location.hash.match(/[?&]q=([^&]*)/) || [, ""])[1]);

  /* Reference Library: owner/admin only (UI + route). Scoring keeps using the reference data for everyone. */
  const isAdmin = () => { const C = window.ROLLING_OAK_CLOUD || {}, st = window.Cloud && Cloud.state ? Cloud.state() : {}; return !!(st.user && st.user.id === (window.ROLLING_OAK_MOCK ? window.ROLLING_OAK_MOCK.adminUserId : C.adminUserId)); }; /* the mock id is the Playwright harness only */
  function adminGate() { const a = isAdmin(); document.querySelectorAll(".needs-admin").forEach(el => el.hidden = !a);
    if (/^#\/library/.test(location.hash) && !a && (!window.Cloud || !Cloud.isSettled || Cloud.isSettled())) { location.replace("#/catalog"); if (window.App && App.toast) App.toast("The Reference Library is only available to the collection owner."); return false; } return true; }
  function library() {
    if (!adminGate() || !isAdmin()) return;
    const host = $("#libraryBody"); if (!host) return; const cat = LIB.cat || "artifact", pub = window.Analysis && (Analysis.pubFor ? Analysis.pubFor(cat) : Analysis.pub && Analysis.pub());
    if (!pub) { host.innerHTML = Analysis && Analysis.loadErrors && Analysis.loadErrors().length ? '<p class="err" role="alert">⚠ Reference data failed to load. Reload to retry.</p>' : '<p class="help">Loading reference data…</p>'; setTimeout(library, 600); return; }
    const T = pub.types, uniq = a => [...new Set(a.filter(Boolean))].sort();
    const regions = uniq(T.flatMap(t => [t.continent, ...(t.admin1 || [])])), sources = uniq(T.flatMap(t => (t.sources || []).map(s => s.name))), periods = uniq(T.map(t => t.period).flatMap(p => String(p || "").split(" / ")));
    const CATS = [["artifact", "Artifacts"], ["fossil", "Fossils"], ["rock", "Rocks & Minerals"]];
    if (host.dataset.cat !== cat) { host.dataset.cat = cat; host.innerHTML = ""; }
    if (!host.querySelector("#libQ")) host.innerHTML = `<div class="lib-tabs" role="tablist" aria-label="Reference layer">${CATS.map(([k, l]) => `<button type="button" role="tab" class="lib-tab" data-libcat="${k}" aria-selected="${k === cat}" tabindex="${k === cat ? 0 : -1}">${l}</button>`).join("")}</div><div class="toolbar" role="search"><label class="field grow"><span class="sr-only">Search references</span><input id="libQ" type="search" placeholder="${cat === "artifact" ? "Search type names and aliases…" : cat === "fossil" ? "Search taxa, groups, formations…" : "Search rocks and minerals…"}"></label>
      <label class="field"><span class="sr-only">Region</span><select id="libRegion"><option value="">All regions</option>${regions.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
      <label class="field"><span class="sr-only">Source</span><select id="libSource"><option value="">All sources</option>${sources.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
      <label class="field"><span class="sr-only">Period</span><select id="libPeriod"><option value="">All periods</option>${periods.map(x => `<option>${esc(x)}</option>`).join("")}</select></label></div><p class="count" id="libCount" aria-live="polite"></p><div class="lib-grid" id="libGrid"></div><div class="row lib-pg"><button type="button" class="btn" id="libPrev">← Previous</button><button type="button" class="btn" id="libNext">Next →</button></div>
      <p class="help">${esc(pub.types.length)} published reference summaries: facts and links only, with each entry's source, retrieval date and license. Home-region types appear first. Not the owner's finds.</p>`;
    host.querySelectorAll("[data-libcat]").forEach(b => { b.onclick = () => { LIB = { q: "", region: "", source: "", period: "", page: 0, cat: b.dataset.libcat }; library(); host.querySelector(`[data-libcat=${b.dataset.libcat}]`)?.focus(); };
      b.onkeydown = e => { if (!/Arrow(Left|Right)/.test(e.key)) return; const i = CATS.findIndex(c => c[0] === cat), n = CATS[(i + (e.key === "ArrowRight" ? 1 : CATS.length - 1)) % CATS.length][0]; host.querySelector(`[data-libcat=${n}]`).click(); }; });
    const set = () => { LIB = { q: $("#libQ").value.trim().toLowerCase(), region: $("#libRegion").value, source: $("#libSource").value, period: $("#libPeriod").value, page: 0, cat }; draw(); };
    ["#libQ", "#libRegion", "#libSource", "#libPeriod"].forEach(s => $(s).oninput = set); $("#libPrev").onclick = () => { LIB.page = Math.max(0, LIB.page - 1); draw(); }; $("#libNext").onclick = () => { LIB.page++; draw(); };
    function draw() {
      const L = T.filter(t => (!LIB.q || [t.name, ...(t.aliases || []), ...(t.formations || []), ...Object.values(t.taxonomy || {})].some(n => String(n).toLowerCase().includes(LIB.q))) && (!LIB.region || t.continent === LIB.region || (t.admin1 || []).includes(LIB.region))
        && (!LIB.source || (t.sources || []).some(s => s.name === LIB.source)) && (!LIB.period || String(t.period || "").split(" / ").includes(LIB.period))).sort((a, b) => ((b.rules ? 1 : 0) - (a.rules ? 1 : 0)) || (b.texas - a.texas) || ((a.home_priority || 3) - (b.home_priority || 3)) || a.name.localeCompare(b.name));
      const N = 48, pages = Math.max(1, Math.ceil(L.length / N)); LIB.page = Math.min(LIB.page, pages - 1);
      $("#libCount").textContent = `Showing ${L.length ? LIB.page * N + 1 : 0}–${Math.min(L.length, (LIB.page + 1) * N)} of ${L.length} reference types`;
      $("#libGrid").innerHTML = L.slice(LIB.page * N, (LIB.page + 1) * N).map(t => `<article class="lib-card">${sil(t.category, t.name + " silhouette placeholder")}<div><h3>${esc(t.name)}</h3><p class="muted">${esc([t.period, t.dates].filter(Boolean).join(" · ") || t.typology_system)}</p>
        <p class="muted">${esc([t.continent, (t.admin1 || []).slice(0, 4).join(", ") + ((t.admin1 || []).length > 4 ? ` +${t.admin1.length - 4}` : "")].filter(Boolean).join(": "))}</p>${t.properties && t.properties.hardness ? `<p class="chip">Mohs ${esc(t.properties.hardness)}</p>` : ""}${t.genera ? "" : ""}${t.rules ? `<p class="chip">${t.category === "fossil" ? (t.fossil_kind === "pseudo" ? "Pseudofossil" : "Group") : "Rock / variety"}</p>` : ""}${t.length_mm ? `<p class="chip">L ${t.length_mm[0]}–${t.length_mm[1]} mm</p>` : ""}
        <p class="lib-src">${(t.sources || []).slice(0, 2).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="src-tag" title="${esc(s.license)}">${esc(/pidba/i.test(s.name) ? "PIDBA" : s.name)} ↗</a>`).join(" ")} <button type="button" class="btn ghost small" data-refd="${esc(t.id)}">Details</button></p></div></article>`).join("") || '<p class="empty">No reference types match these filters.</p>';
      $("#libPrev").disabled = LIB.page === 0; $("#libNext").disabled = LIB.page >= pages - 1;
    }
    const hq = hashQ(); if (hq && $("#libQ").value !== hq) { $("#libQ").value = hq; set(); return; }
    draw();
  }
  function settings() {
    const host = $("#settingsBody"); if (!host) return; const st = window.Cloud && Cloud.state ? Cloud.state() : {}, user = st && st.user, dark = document.documentElement.dataset.theme === "dark", S = window.Score ? Score.DEFAULTS : null;
    host.innerHTML = `<div class="set-grid">
      <section class="set-card"><h2>Account</h2><p>${user ? `Signed in as <strong>${esc(user.email || user.phone || "you")}</strong>` : "You're browsing signed out."}</p><div class="row"><button type="button" class="btn primary" data-set="auth">${user ? "Account & sign out" : "Sign in"}</button>${user ? '<a class="btn" href="#/profile">Edit profile</a><a class="btn" href="#/members">Collection members</a>' : ""}<a class="btn" href="#/pricing">Membership</a></div></section>
      <section class="set-card"><h2>Appearance</h2><label class="check"><input type="checkbox" id="setDark" ${dark ? "checked" : ""}> Dark mode</label><button type="button" class="btn" data-set="install">⤓ Add to home screen</button></section>
      <section class="set-card"><h2>Data &amp; privacy</h2><p class="help">🔒 Exact find locations live only in an owner-only table and are never shown publicly. Exports leave location out unless you choose otherwise in the catalog toolbar.</p><div class="row"><button type="button" class="btn" data-set="csv">Export CSV</button><button type="button" class="btn" data-set="json">Export JSON</button><a class="btn" href="#/labels">Print QR labels</a>${st && st.user ? '<a class="btn needs-editor" href="#/map">Private find map</a>' : ""}</div></section>
      <section class="set-card"><h2>Confidence scoring</h2>${S ? `<p class="help">Rules engine cap ${S.rulesCap}% · AI cap ${S.aiCap}% · Verified + references agree: ${S.verifiedMax}%. Bands: ${S.bands.map(([n, l]) => `${l} ≥${n}%`).join(", ")}.</p>` : ""}<p class="help">${esc(window.Learn ? Learn.DISCLAIMER : "")}</p><a class="btn" href="#/about">About &amp; methods</a></section>
      <section class="set-card"><h2>More</h2><ul class="links"><li><a href="#/discover">Discover public finds</a></li><li><a href="#/timeline">Deep time</a></li><li><a href="#/people">People &amp; land</a></li><li><a href="#/about">About, legal &amp; disclaimers</a></li>${isAdmin() ? '<li><a href="#/library">Reference Library</a></li>' : ""}</ul></section></div>`;
    host.querySelector("#setDark").onchange = () => $("#themeToggle").click();
    host.onclick = e => { const b = e.target.closest("[data-set]"); if (!b) return; const a = b.dataset.set;
      if (a === "auth") $("#authBtn").click(); else if (a === "csv") $("#exportCsv").click(); else if (a === "json") $("#exportJson").click(); else if (a === "install") { const i = $("#installBtn"); if (i && !i.hidden) i.click(); else App.toast("Use your browser's menu: Add to Home Screen."); } };
  }
  const TITLES = { home: "Welcome", catalog: "Catalog", review: "Review", library: "Reference Library", settings: "Settings", discover: "Discover", add: "Add a find", about: "About & methods", timeline: "Deep time", people: "People & land", map: "Find map", labels: "QR labels", profile: "Profile", members: "Members", pricing: "Membership", membership: "Membership", merch: "Merch", experts: "Experts", catalogs: "Your catalogs", admin: "Owner admin", p: "Shared find", c: "Collection", find: "Find" };
  function topbar() { const homeV = !document.getElementById("view-home")?.hidden, v = homeV ? "home" : (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1], cur = window.App && App.current, rec = v === "record" && cur;
    const tt = $("#tbTitle"), id = $("#tbId"); if (!tt) return; tt.textContent = rec ? "Find Review" : TITLES[v] || "Catalog"; id.hidden = !rec; if (rec) id.textContent = cur.catalog_id; }
  async function who() { const u = $("#tbUser"); if (!u || !window.Cloud) return; const st = Cloud.state(); if (!st.user) { u.hidden = true; return; }
    let p = {}, role = "Member"; try { p = (await (Cloud.profile ? Cloud.profile() : null)) || {}; p = p.data || p; } catch {} try { const c = await (Cloud.collections ? Cloud.collections() : null); const L = (c && (c.data || c)) || []; if (L[0] && L[0].role) role = L[0].role[0].toUpperCase() + L[0].role.slice(1); } catch {}
    const name = p.display_name || st.user.email || "You"; u.hidden = false; u.querySelector("strong").textContent = name; u.querySelector(".tb-who span").textContent = role;
    const av = u.querySelector(".tb-av"); if (p.avatar_url && /^https:/.test(p.avatar_url)) { av.style.backgroundImage = `url("${p.avatar_url}")`; av.textContent = ""; } else av.textContent = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(""); }
  addEventListener("load", () => { setTimeout(who, 900); if (window.Cloud && Cloud.on) Cloud.on(() => setTimeout(who, 50)); });
  function onRoute() { adminGate(); topbar(); const v = (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1]; document.querySelectorAll(".side-nav a[data-route]").forEach(a => a.dataset.route === v || (v === "record" && a.dataset.route === "catalog") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    if (v === "review") reviewQueue(); if (v === "library") library(); if (v === "settings") settings(); document.body.classList.remove("side-open"); }
  addEventListener("hashchange", onRoute); addEventListener("load", () => { if (window.Cloud && Cloud.on) Cloud.on(() => { adminGate(); if (/^#\/library/.test(location.hash)) library(); }); }); addEventListener("load", () => setTimeout(onRoute, 300));
  document.addEventListener("click", e => { if (e.target.closest("#sideToggle")) { const o = document.body.classList.toggle("side-open"); $("#sideToggle").setAttribute("aria-expanded", o); } });
  window.Redesign = { isAdmin, adminGate, reviewHtml, library, settings, reviewQueue, refMatches };
})();
