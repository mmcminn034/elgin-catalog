/* Rolling Oak Catalog — static app. Seed data: data/catalog.json. User additions/edits: IndexedDB (browser only). */
(() => {
  "use strict";
  const COLS = ["catalog_id","category","object_type","geologic_period","formation","preservation","hardness","luster","streak","material","color","length_mm","width_mm","thickness_mm","weight_g","measure_method","condition","key_features","suggestion_1","suggestion_2","suggestion_3","confidence","owner_observations","open_questions","date_found","context_notes","location_sharing","status","category_history"];
  const PRIVATE = "find_location_private";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let seed = [], local = [], all = [];

  /* ---------- IndexedDB ---------- */
  const DB = { db: null,
    open() { return new Promise((res, rej) => { const r = indexedDB.open("elgin-catalog", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("finds", { keyPath: "catalog_id" });
      r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
    tx(mode) { return this.db.transaction("finds", mode).objectStore("finds"); },
    all() { return new Promise((res, rej) => { const r = this.tx("readonly").getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    put(o) { return new Promise((res, rej) => { const r = this.tx("readwrite").put(o); r.onsuccess = res; r.onerror = () => rej(r.error); }); },
    del(id) { return new Promise((res, rej) => { const r = this.tx("readwrite").delete(id); r.onsuccess = res; r.onerror = () => rej(r.error); }); }
  };

  /* ---------- cloud sync hooks (no-ops when signed out or offline) ---------- */
  const _put = DB.put.bind(DB), _del = DB.del.bind(DB);
  /* Edits that could not reach the cloud are remembered and retried, never silently dropped. */
  const PEND = "ro-pending-sync";
  const pending = () => { try { return JSON.parse(localStorage.getItem(PEND) || "[]"); } catch { return []; } };
  const setPending = ids => { try { localStorage.setItem(PEND, JSON.stringify([...new Set(ids)])); } catch {} };
  const syncWarn = m => toast(m, { warn: true, ms: 9000 });
  async function pushOne(rec, snap) {
    const res = await Cloud.pushFind(rec, snap, marksFor), id = rec.catalog_id;
    if (res.ok) { setPending(pending().filter(x => x !== id));
      { local = await DB.all(); const lo = local.find(x => x.catalog_id === id); if (lo && (lo.created_local && !lo.synced || res.photos)) { const o = { ...lo, synced: true }; if (res.photos) o.photos = (lo.photos || []).map((p, i) => res.photos[i] ? { ...p, src: undefined, path: res.photos[i], thumb: res.photos[i] } : p); await _put(o); local = await DB.all(); refresh(); } }
      if (res.cloudCategory) { // the cloud had a newer category decision: adopt it locally instead of fighting it
        const o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }), ...res.cloudCategory }; await _put(o); local = await DB.all(); refresh(); }
      return true; }
    setPending([...pending(), id]); syncWarn(`⚠ ${id} saved on this device only. Cloud sync failed: ${res.msg}. It will retry next time.`); return false;
  }
  DB.put = async o => { o.saved_ts = new Date().toISOString(); const prev = all.find(x => x.catalog_id === o.catalog_id), snap = prev ? { ...prev } : null; await _put(o);
    if (!window.Cloud) return;
    if (!Cloud.state().user) { if (Cloud.state().available && o.created_local) { setPending([...pending(), o.catalog_id]); syncWarn(`⚠ ${o.catalog_id} is saved on this device only: you're not signed in. Sign in (☰ menu → Sign in) and it will upload automatically.`); } return; }
    // Push exactly what was saved (merged over the current view), not whatever `all` holds 80 ms later.
    const rec = { ...(prev || {}), ...o }; delete rec._src;
    const st = Cloud.state();
    if (!st.online) { setPending([...pending(), o.catalog_id]); return syncWarn(`⚠ ${o.catalog_id} saved on this device only. Cloud sync is off (${st.reason || "cloud not reachable"}). It will retry next time.`); }
    if (await pushOne(rec, snap)) toast(`☁ ${o.catalog_id} synced`); };
  /* A find created on this device whose ID was later taken by the shared catalog (seed/cloud) gets the next free ID instead of overwriting it. */
  async function renumberCollisions() { const ids = new Set(seed.map(r => r.catalog_id)); const moved = [];
    const me = window.Cloud && Cloud.state().user ? Cloud.state().user.id : null;
    for (const r of local.filter(x => x.created_local && !x.synced && ids.has(x.catalog_id))) {
      const s = seed.find(x => x.catalog_id === r.catalog_id); if (s && me && s._owner === me) continue; // our own find came back from the cloud
      const max = Math.max(0, ...[...ids, ...local.map(x => x.catalog_id)].map(id => +((/ELG-(\d+)/.exec(id) || [])[1] || 0))), nid = "ELG-" + String(max + 1).padStart(3, "0");
      await _del(r.catalog_id); await _put({ ...r, catalog_id: nid, renumbered_from: r.catalog_id }); ids.add(nid); moved.push(`${r.catalog_id} → ${nid}`); setPending([...pending().filter(x => x !== r.catalog_id), nid]); local = await DB.all(); }
    if (moved.length) setTimeout(() => toast(`Your new find was renumbered because that ID is now used by the shared catalog: ${moved.join(", ")}`, { warn: true, ms: 9000 }), 600); }
  async function retryPending() { const ids = pending(); if (!ids.length || !window.Cloud || !Cloud.state().user || !Cloud.state().online) return;
    let ok = 0; for (const id of ids) { const r = all.find(x => x.catalog_id === id); if (!r) { setPending(pending().filter(x => x !== id)); continue; } const rec = { ...r }; delete rec._src; if (await pushOne(rec, null)) ok++; }
    if (ok) toast(`☁ ${ok} earlier change${ok > 1 ? "s" : ""} synced`); }
  DB.del = async id => { const r = all.find(x => x.catalog_id === id); await _del(id); if (r && r._src === "local" && window.Cloud) Cloud.deleteFind(id); };
  const CAT_KEYS = ["category", "category_kept", "category_note", "category_history"];
  const stamp = h => (window.Cloud && Cloud.catStamp) ? Cloud.catStamp(h) : (Array.isArray(h) && h.length ? String(h[h.length - 1].ts || h[h.length - 1].date || "") + "#" + String(h.length).padStart(4, "0") : "");
  const decision = (from, to, reason) => ({ from, to, date: new Date().toLocaleDateString("en-CA"), ts: new Date().toISOString(), reason });
  const conflicts = new Map();
  function merge() {
    const m = new Map(seed.map(r => [r.catalog_id, { ...r, _src: "seed" }]));
    local.map(r => (r.category && !KINDS[String(r.category).toLowerCase()]) ? { ...r, object_type: r.object_type || r.category, category: "artifact" } : r).forEach(r => {
      const base = m.get(r.catalog_id) || {};
      // A canonical seed record (e.g. re-entered after a failed upload) beats any older local copy with the same ID; the local copy stays in IndexedDB, flagged.
      if (base.canonical_ts && !(r.saved_ts > base.canonical_ts)) { conflicts.set(r.catalog_id, r); return; }
      const out = { ...base, ...r, _src: m.has(r.catalog_id) ? "edited" : "local" };
      // Owner category decisions: whichever side (cloud/seed vs this device) decided most recently wins, so a stale copy never undoes a move.
      if (stamp(base.category_history) > stamp(r.category_history)) CAT_KEYS.forEach(k => { if (k in base) out[k] = base[k]; else delete out[k]; });
      m.set(r.catalog_id, out); });
    all = [...m.values()].sort((a, b) => a.catalog_id.localeCompare(b.catalog_id, undefined, { numeric: true }));
  }
  const KINDS = {
    artifact: { label: "Artifacts", one: "artifact", icon: "◆", empty: "", guide: "Rank 1–3 possible types (e.g. Central Texas dart or arrow point types). Note base/stem shape, notching, grinding, flaking pattern and heat treatment." },
    fossil: { label: "Fossils", one: "fossil", icon: "🐚", empty: "Central Texas sits on Cretaceous limestones and marls, so ammonites, echinoids (sea urchins), oysters like Exogyra and Ilymatogyra, and clams are common surface fossils.",
      guide: "Rank 1–3 possible taxa (e.g. ammonite genus, echinoid, Exogyra oyster) with reasoning: shape, ribbing, suture pattern, coiling. Add a likely geologic period/formation only as a hypothesis." },
    rock: { label: "Rocks & Minerals", one: "rock or mineral", icon: "💎", empty: "Log chert, flint, quartzite, calcite, pyrite nodules, geodes and more. Simple field tests (hardness, luster, streak) do most of the work.",
      guide: "Rank 1–3 possible rock/mineral types. Chert vs flint: both microcrystalline quartz; ‘flint’ is often used for dark nodular chert. Quartzite is granular/sugary, with fractures cutting through grains. Hardness ~7 scratches glass." } };
  const kindOf = r => { const c = String(r.category || "").toLowerCase(); return KINDS[c] ? c : "artifact"; };
  let kind = "artifact";
  /* ---------- auto-categorization: simple, transparent keyword rules ---------- */
  const RULES = [
    { kind: "rock", re: /\b(unworked|natural|no flake scars|pebble|nodule|geode|concretion|cobble)\b/i },
    { kind: "fossil", re: /\b(ammonite|fossil\w*|echinoid|oyster|exogyra|gastropod|crinoid|petrified)\b/i },
    { kind: "artifact", re: /\b(flake|biface|point|scraper|core|knapped|worked|hammerstone)\b/i }];
  const KIND_FIELDS = { fossil: ["geologic_period", "formation", "preservation"], rock: ["hardness", "luster", "streak"] };
  function suggestKind(r) {
    const scan = (where, t) => { t = String(t || ""); const hits = RULES.map(x => ({ x, m: x.re.exec(t) })).filter(h => h.m).sort((p, q) => p.m.index - q.m.index); // earliest keyword wins
      return hits.length ? { kind: hits[0].x.kind, reason: `“${hits[0].m[0].toLowerCase()}” in ${where}` } : null; };
    return scan("top-ranked suggestion", r.suggestion_1) || scan("object type", r.object_type) || scan("key features / notes", [r.key_features, r.owner_observations, r.context_notes].join(" "));
  }
  function recatBanner(r, cur, kept) { const s = suggestKind(r); if (!s || s.kind === cur || kept === cur) return "";
    return `<div class="recat" role="status"><div><strong>Analysis suggests this belongs in ${esc(KINDS[s.kind].label)}.</strong><br><span>Rule match: ${esc(s.reason)}. Currently filed under ${esc(KINDS[cur].label)}. Nothing moves unless you choose Move.</span></div><div class="recat-btns"><button type="button" class="btn primary" data-recat="move" data-to="${s.kind}" data-reason="${esc(s.reason)}">Move to ${esc(KINDS[s.kind].label)}</button><button type="button" class="btn" data-recat="keep">Keep in ${esc(KINDS[cur].label)}</button></div></div>`; }
  const histHtml = h => (h || []).length ? `<ul class="hist">${h.map(x => `<li>${esc(x.date)}: ${x.from === x.to ? "kept in " + esc(KINDS[x.to]?.label || x.to) : esc(KINDS[x.from]?.label || x.from) + " → " + esc(KINDS[x.to]?.label || x.to)} <span class="muted">(${esc(x.reason)})</span></li>`).join("")}</ul>` : "";
  const histText = h => Array.isArray(h) ? h.map(x => `${x.date}: ${x.from} -> ${x.to} (${x.reason})`).join("; ") : (h || "");
  const kindRows = r => { const k = kindOf(r); return k === "fossil" ? [["Geologic period", r.geologic_period], ["Formation", r.formation], ["Preservation", r.preservation]] : k === "rock" ? [["Hardness (Mohs)", r.hardness], ["Luster", r.luster], ["Streak", r.streak]] : []; };
  const nextId = () => "ELG-" + String(Math.max(0, ...[...all, ...seed, ...local].map(r => +((/ELG-(\d+)/.exec(r.catalog_id) || [])[1] || 0)), ...(typeof pending === "function" ? pending() : []).map(id => +((/ELG-(\d+)/.exec(id) || [])[1] || 0))) + 1).padStart(3, "0");

  /* ---------- helpers ---------- */
  // Optional provenance/acquisition: marks pieces that are not local field finds (e.g. brought from another state).
  const provBadge = r => (r.provenance || r.acquisition) && r.provenance_answer !== "local" ? `<span class="prov-badge" title="${esc(r.acquisition || r.provenance)}">From collection · ${esc(String(r.provenance || r.acquisition).split(" (")[0])}</span>` : "";
  function confScore(c = "") { c = c.toLowerCase();
    if (c.includes("high")) return 90; if (c.startsWith("moderate-low") || c.startsWith("low-moderate") || c.startsWith("low to moderate")) return 45;
    if (c.startsWith("moderate")) return 65; if (c.startsWith("low")) return 25; return 0; }
  const confBucket = c => { const s = confScore(c); return s >= 80 ? "high" : s >= 45 ? "moderate" : s > 0 ? "low" : ""; };
  const isMeasured = r => /^measured/i.test(r.measure_method || "") && r.length_mm;
  const size = r => { const p = [["L", r.length_mm], ["W", r.width_mm], ["T", r.thickness_mm]].filter(x => x[1]);
    return p.length ? p.map(x => `${x[0]} ${esc(x[1])}`).join(" × ") + " mm" + (window.S2 ? S2.sizeTag(r) : "") : "<em>not measured</em>"; };
  const pics = r => (r.photos || []).map(p => ({ src: p.path || p.src, thumb: p.thumb || p.path || p.src, view: p.view || p.tag || "", label: p.label || (p.view || p.tag || "photo") }));
  const ERAS = [
    { id: "Paleoindian", dates: "~11,500–8,800 BC", text: "The earliest well-documented people in Central Texas hunted and gathered across a cooler late Ice Age landscape. Sites such as Gault, near Florence, are among the most studied in North America." },
    { id: "Early Archaic", dates: "~8,800–6,000 BC", text: "As the climate warmed, people relied more on a wide range of plants and smaller game, and moved within regional territories. Dart points with stems and notches become common." },
    { id: "Middle Archaic", dates: "~6,000–2,500 BC", text: "Populations grew, and burned-rock middens (earth-oven cooking features) became widespread. Long, narrow stemmed dart points are typical of parts of this period." },
    { id: "Late Archaic", dates: "~2,500 BC–AD 700", text: "A long period with many dart point styles, including barbed and corner-notched forms. Cemeteries and wide trade networks are documented in the region." },
    { id: "Late Prehistoric", dates: "~AD 700–1600", text: "The bow and arrow arrived, bringing small arrow points. Later in this period, some groups also made pottery and hunted bison when herds moved into the region." },
    { id: "Historic", dates: "~AD 1600–present", text: "Spanish, Mexican and Anglo-American colonization brought profound disruption. Indigenous nations, including the Tonkawa, continue today." }];
  const eraOf = r => { if (kindOf(r) === "fossil") return r.geologic_period ? (GEO.find(g => r.geologic_period.includes(g.id)) || {}).id || "Undetermined" : "Undetermined"; if (kindOf(r) === "rock") return "Undetermined"; if (r.era && r.era !== "Undetermined") return r.era; const t = (r.suggestion_1 || "") + " " + (r.era || ""); const e = ERAS.find(x => t.includes(x.id)); return r.era === "Undetermined" ? "Undetermined" : (e ? e.id : "Undetermined"); };
  const GEO = [
    { id: "Quaternary", dates: "~2.6 million years ago–present", text: "Ice Age and modern river terraces. Gravels along Central Texas creeks carry reworked older rocks and fossils, plus Pleistocene mammal bones in places." },
    { id: "Paleogene", dates: "~66–23 million years ago", text: "East of the Balcones zone, Paleocene–Eocene sands and clays (e.g. the Midway and Wilcox groups near Elgin) hold marine shells, petrified wood and lignite." },
    { id: "Cretaceous", dates: "~145–66 million years ago", text: "Shallow seas covered Central Texas. Limestones, chalks and marls (e.g. the Austin Chalk, Taylor and Navarro groups) yield ammonites, echinoids, Exogyra oysters, clams and shark teeth." }];
  let tlMode = "human";
  function renderTimeline() {
    $$(".tl-toggle button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === tlMode));
    $("#tl-h").textContent = tlMode === "human" ? "13,000 years in Central Texas" : "Geologic deep time beneath Central Texas";
    $("#tlLede").hidden = tlMode !== "human"; $("#tlLedeGeo").hidden = tlMode === "human";
    const pool = all.filter(r => tlMode === "human" ? kindOf(r) === "artifact" : kindOf(r) === "fossil"), list = tlMode === "human" ? ERAS : GEO;
    const chip = (r, t = true) => { const p = pics(r)[0]; return `<button class="tl-find" data-id="${esc(r.catalog_id)}">${p ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : ""}<span><strong>${esc(r.catalog_id)}</strong><br><span class="muted">${esc(r.object_type)}</span>${t ? '<br><span class="tent">Tentative</span>' : ""}</span></button>`; };
    $("#timeline").innerHTML = list.map(e => { const fs = pool.filter(r => eraOf(r) === e.id); return `<li class="tl-item"><div class="tl-dot" aria-hidden="true"></div><div class="tl-body"><h2>${e.id}</h2><p class="tl-dates">${e.dates}</p><p>${e.text}</p>${fs.length ? `<div class="tl-finds">${fs.map(chip).join("")}</div>` : ""}</div></li>`; }).join("");
    $("#undetermined").innerHTML = pool.filter(r => eraOf(r) === "Undetermined").map(r => chip(r, false)).join("") || '<p class="help">Nothing here yet.</p>';
  }
  document.addEventListener("click", e => { const t = e.target.closest(".tl-toggle button"); if (t) { tlMode = t.dataset.mode; renderTimeline(); }
  });
  document.addEventListener("click", e => { const b = e.target.closest(".tl-find"); if (b) openModal(b.dataset.id); });
  $(".ctabs").addEventListener("click", e => { const b = e.target.closest(".ctab"); if (b) setKind(b.dataset.kind); });
  $(".ctabs").addEventListener("keydown", e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return; const ks = Object.keys(KINDS), n = ks[(ks.indexOf(kind) + d + 3) % 3]; setKind(n); $(`.ctab[data-kind=${n}]`).focus(); });
  function setKind(k) { kind = k; $("#fCat").value = ""; renderStats(); renderGrid(); }
  const suggestions = r => [r.suggestion_1, r.suggestion_2, r.suggestion_3].filter(Boolean);
  const meter = c => `<div class="meter" aria-label="Confidence: ${esc(c || "not set")}"><span>Confidence</span><span class="bar"><i style="width:${confScore(c)}%"></i></span><span class="chip">${esc(c || "—")}</span></div>`;

  /* ---------- catalog view ---------- */
  function renderStats() {
    const ks = inKind(); $$(".ctab").forEach(b => { const n = all.filter(r => kindOf(r) === b.dataset.kind).length; b.setAttribute("aria-selected", b.dataset.kind === kind); b.tabIndex = b.dataset.kind === kind ? 0 : -1; b.querySelector(".n").textContent = n; });
    const s = [[KINDS[kind].label, ks.length], ["Reviewed", ks.filter(r => r.status === "Reviewed" || r.status === "Verified").length], ["Drafts", ks.filter(r => r.status !== "Reviewed" && r.status !== "Verified").length], ...(window.S5 ? [["⚑ Needs review", ks.filter(S5.needs).length]] : []), ["Measured", ks.filter(isMeasured).length]];
    $("#stats").innerHTML = s.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(""); if (window.S5) S5.toolbar();
    const cats = [...new Set(ks.map(r => r.object_type).filter(Boolean))].sort(), fc = $("#fCat"), v = fc.value;
    fc.innerHTML = '<option value="">All types</option>' + cats.map(c => `<option>${esc(c)}</option>`).join(""); fc.value = cats.includes(v) ? v : "";
    $("#catList").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  }
  const inKind = () => all.filter(r => kindOf(r) === kind);
  function filtered() {
    const q = $("#q").value.trim().toLowerCase(), st = $("#fStatus").value, ca = $("#fCat").value, co = $("#fConf").value;
    return inKind().filter(r => (!st || (st === "_needs" ? (window.S5 ? S5.needs(r) : r.status !== "Reviewed") : (r.status || "Draft") === st)) && (!ca || r.object_type === ca) && (!co || confBucket(r.confidence) === co)
      && (!q || COLS.some(c => String(r[c] || "").toLowerCase().includes(q))));
  }
  function renderGrid() {
    const rows = filtered();
    $("#count").textContent = `Showing ${rows.length} of ${inKind().length} ${KINDS[kind].label.toLowerCase()}`;
    $("#grid").innerHTML = rows.length ? rows.map(r => `
      <button class="card${window.S5 && S5.needs(r) ? " needs" : ""}" data-id="${esc(r.catalog_id)}" aria-label="Open ${esc(r.catalog_id)} ${esc(r.object_type)}">
        ${pics(r)[0] ? `<div class="card-img"><img src="${esc(pics(r)[0].thumb)}" alt="" loading="lazy"><span class="cid-big">${esc(r.catalog_id)}</span><span class="pcount">📷 ${pics(r).length}</span>${provBadge(r)}${window.Learn && Learn.verified(r) ? '<span class="vbadge card-v">✓ Verified</span>' : ""}${window.Learn && Learn.vis(r) !== "public" ? `<span class="vis-chip">${Learn.vis(r) === "private" ? "🔒 Private" : "👥 Editors"}</span>` : ""}</div>` : `<div class="card-img none"><span class="cid-big">${esc(r.catalog_id)}</span><span class="nophoto">No photo yet</span></div>`}
        <div class="card-top"><span class="era ${eraOf(r) === "Undetermined" ? "und" : ""}">${kindOf(r) === "rock" ? esc(KINDS.rock.label) : eraOf(r) === "Undetermined" ? (kindOf(r) === "fossil" ? "Period undetermined" : "Era undetermined") : esc(eraOf(r)) + " · tentative"}</span><span class="badge ${window.S5 ? S5.cls(r.status) : r.status === "Reviewed" ? "Reviewed" : "Draft"}">${esc(r.status || "Draft")}</span>${window.S5 && S5.needs(r) ? '<span class="needs-flag" title="Still needs review">⚑ Needs review</span>' : ""}</div>
        <h3>${esc(r.object_type || "Uncategorized")}</h3>${kindOf(r) === "rock" && (r.hardness || r.luster) ? `<div class="meta">${r.hardness ? "Hardness " + esc(r.hardness) : ""}${r.luster ? " · " + esc(r.luster) + " luster" : ""}</div>` : ""}
        <div class="meta">${esc(r.material)}${r.color ? " · " + esc(r.color) : ""}</div>
        <div class="meta">Size: ${size(r)}${r.measure_method ? ` <span class="chip">${esc(r.measure_method)}</span>` : ""}</div>
        ${suggestions(r).length ? `<ol>${suggestions(r).map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        ${meter(r.confidence)}
        ${r.open_questions ? `<div class="oq"><strong>Open:</strong> ${esc(r.open_questions)}</div>` : ""}
        ${r._src !== "seed" ? `<span class="local">● ${r._src === "local" ? "Added in this browser" : "Edited in this browser"}</span>` : ""}
      </button>`).join("") : inKind().length ? '<p class="empty">No finds match these filters.</p>' : `<div class="empty-state"><div class="es-icon" aria-hidden="true">${KINDS[kind].icon}</div><h3>No ${KINDS[kind].label.toLowerCase()} yet. Add the first one!</h3><p>${KINDS[kind].empty}</p><p class="help">Same honest process as artifacts: photos with a scale, measurements, then ranked possibilities with caveats, never a definitive ID or value.</p><a class="btn primary lg" href="#/add?kind=${kind}">Add the first ${KINDS[kind].one}</a></div>`;
  }
  const refresh = () => { merge(); renderStats(); renderGrid(); renderTimeline(); };

  /* ---------- detail modal ---------- */
  let current = null, lastFocus = null, tab = 0;
  function openModal(id) {
    current = all.find(r => r.catalog_id === id); if (!current) return;
    lastFocus = document.activeElement; $("#mId").textContent = current.catalog_id; $("#mTitle").textContent = current.object_type || "Find";
    $("#modal").hidden = false; document.body.style.overflow = "hidden"; selectTab(0); $("#tab-0").focus();
    if (location.hash !== "#/record/" + id) history.replaceState(null, "", "#/record/" + id);
  }
  function closeModal() { if (/^#\/record\//.test(location.hash)) history.replaceState(null, "", "#/catalog"); $("#modal").hidden = true; document.body.style.overflow = ""; current = null; lastFocus && lastFocus.focus(); }
  function selectTab(i) {
    tab = i; $$(".tabs [role=tab]").forEach((b, j) => { b.setAttribute("aria-selected", j === i); b.tabIndex = j === i ? 0 : -1; });
    const r = current, kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd>`).join("")}</dl>`;
    const ps = pics(r), photos = ps.length ? `<h3 class="gal-h">Photos (${ps.length})</h3><div class="photos">${ps.map((p, j) => `<figure><button type="button" class="ph" data-lb="${j}" aria-label="Enlarge ${esc(p.label)}"><img src="${esc(p.thumb)}" alt="${esc(r.catalog_id)} ${esc(p.label)}" loading="lazy"></button><figcaption>${esc(p.label)}</figcaption></figure>`).join("")}</div>` : `<p class="help">No photos yet for this find.</p>`;
    const html = [
      () => (window.Region ? Region.bannerHtml(r) : "") + aiChip(r) + photos + (window.Region && Region.originHtml ? Region.originHtml(r) : "") + (window.Correct ? Correct.html(r) + Correct.simHtml(r) : "") + kv([...(r.provenance || r.acquisition ? [["Provenance", esc([r.acquisition, r.provenance && !String(r.acquisition || "").includes(String(r.provenance).split(" (")[0]) ? r.provenance : ""].filter(Boolean).join(" · ") || r.provenance)]] : []), ["Status", window.S5 ? S5.badge(r) : `<span class="badge ${r.status === "Reviewed" ? "Reviewed" : "Draft"}">${esc(r.status || "Draft")}</span>`], ["Collection", esc(KINDS[kindOf(r)].label) + (r.category_note ? `<br><span class="muted">${esc(r.category_note)}</span>` : "")], ["Category history", histHtml(r.category_history)], ["Material", esc(r.material)], ["Color", esc(r.color)], ...kindRows(r).map(([k, v]) => [k, esc(v)]), ["Condition", esc(r.condition)], ["Key features", esc(r.key_features)], ["Context", esc(r.context_notes)], ["Date found", esc(r.date_found)], ["Location sharing", esc(r.location_sharing || "Private")], ["🔒 Private location", r[PRIVATE] ? esc(r[PRIVATE]) + ' <span class="chip">owner only</span>' : ""]]),
      () => kv([["Method", esc(r.measure_method)], ["Length", r.length_mm ? esc(r.length_mm) + " mm" : ""], ["Width", r.width_mm ? esc(r.width_mm) + " mm" : ""], ["Thickness", r.thickness_mm ? esc(r.thickness_mm) + " mm" : ""], ["Weight", r.weight_g ? esc(r.weight_g) + " g" : ""]]) + (isMeasured(r) ? "" : '<p class="tip">📏 Not yet measured with a ruler or caliper. A flat ruler reading and weight would raise confidence.</p>'),
      () => `<p class="help">Research possibilities, not identifications. No authenticity or value claims.</p><p class="tip">${esc(KINDS[kindOf(r)].guide)}</p><h3 class="gal-h">Your recorded possibilities</h3>${suggestions(r).length ? `<ol class="rank">${suggestions(r).map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : "<p>No suggestions recorded.</p>"}${meter(r.confidence)}<h3 class="gal-h">Rich analysis <span class="muted">(rule-based engine + your verified examples)</span></h3>${window.Analysis ? Analysis.render(r, kindOf(r)) : ""}`,
      () => `<form id="reviewForm"><p class="help">Edits save in this browser for <strong>${esc(r.catalog_id)}</strong> and override the published record on this device. Use Export to back them up.</p>
        <h3 class="gal-h">Measurements</h3><div class="row">${[["length_mm","Length (mm)"],["width_mm","Width (mm)"],["thickness_mm","Thickness (mm)"],["weight_g","Weight (g)"]].map(([k,l]) => `<label class="field"><span>${l}</span><input name="${k}" inputmode="decimal" value="${esc(r[k])}"></label>`).join("")}
        <label class="field"><span>Method</span><select name="measure_method">${[...new Set([r.measure_method || "Not measured", "Measured", "Estimated", "Not measured"])].map(o => `<option ${o === r.measure_method ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label></div>
        <h3 class="gal-h">Find details</h3><div class="row"><label class="field"><span>Date found</span><input type="date" name="date_found" value="${esc(r.date_found)}"></label><label class="field grow"><span>Find context</span><input name="context_notes" value="${esc(r.context_notes)}"></label>
        <label class="field"><span>Sharing level</span><select name="location_sharing">${["Private", "County", "Fuzzed ~10 km"].map(o => `<option ${o === (r.location_sharing || "Private") ? "selected" : ""}>${o}</option>`).join("")}</select></label></div>
        <h3 class="gal-h">Owner review</h3><label class="field"><span>Owner observations &amp; corrections</span><textarea name="owner_observations" rows="4">${esc(r.owner_observations)}</textarea></label>
        <div class="row"><label class="field"><span>Status</span><select name="status">${window.S5 ? S5.options(r.status) : `<option ${r.status !== "Reviewed" ? "selected" : ""}>Draft</option><option ${r.status === "Reviewed" ? "selected" : ""}>Reviewed</option>`}</select></label>
        <label class="field grow"><span>🔒 Private location (owner only, kept in this browser)</span><input name="${PRIVATE}" value="${esc(r[PRIVATE])}"></label></div>
        <div class="wiz-nav">${r._src !== "seed" ? '<button type="button" class="btn" id="revert">' + (r._src === "local" ? "Delete find" : "Revert my edits") + "</button>" : ""}<span class="grow"></span><button class="btn primary">Save review</button></div></form>`
    ][i]();
    const ev = i === 0 && ps.length ? '<h3 class="gal-h">Evidence viewer</h3><div id="evHost"></div>' : "";
    $("#mBody").innerHTML = recatBanner(r, kindOf(r), r.category_kept) + `<div role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" tabindex="0">${ev}${html}</div>`; mountEvidence(); if (window.Features) Features.decorate(i, r, $("#mBody")); if (window.Learn) Learn.decorate(i, r, $("#mBody")); if (window.S2) S2.decorate(i, r, $("#mBody")); if (window.S5) S5.decorate(i, r, $("#mBody"));
    const f = $("#reviewForm"); if (f) {
      f.onsubmit = async e => { e.preventDefault(); const o = { ...(local.find(x => x.catalog_id === r.catalog_id) || { catalog_id: r.catalog_id }) };
        const MEAS = /^((~|≈)\s*|ca\.?\s*|c\.\s*|approx\.?\s*|about\s*)?\d+(\.\d+)?(\s*(-|–|to)\s*~?\d+(\.\d+)?)?\s*(mm|g)?$/i; // also accepts approximate values like ~51, ≈ 60-70, about 38
        const bad = ["length_mm", "width_mm", "thickness_mm", "weight_g"].find(k => f[k].value.trim() && !MEAS.test(f[k].value.trim()));
        if (bad) { f[bad].focus(); return toast(`Review not saved: ${f[bad].name.replace("_mm", "").replace("_g", "")} must be a number, e.g. 62, 60-70 or ~62`, { warn: true }); }
        new FormData(f).forEach((v, k) => o[k] = String(v).trim()); const sSel = f.querySelector("select[name=status]");
        if (window.S5 && S5.needs(r) && S5.needs(o) && !(sSel && sSel.dataset.touched)) o.status = "Reviewed"; // Save review advances an untouched Draft to Reviewed
        await DB.put(o); local = await DB.all(); const id = r.catalog_id; refresh(); current = all.find(x => x.catalog_id === id);
        if (o.status === "Reviewed" && r.status !== "Reviewed" && r.status !== "Verified" && current.suggestion_1) { await Analysis.learn(current, kindOf(current), current.suggestion_1, "Marked Reviewed (top possibility)"); toast("Review saved · added as a verified example"); } else toast("Review saved"); selectTab(3); };
      const rv = $("#revert"); if (rv) rv.onclick = async () => { if (!confirm(rv.textContent + "?")) return; await DB.del(r.catalog_id); local = await DB.all(); refresh(); closeModal(); };
    }
  }
  $("#mBody").addEventListener("click", e => { if (window.Correct && current && e.target.closest("[data-corr]")) Correct.onClick(e, current); });
  $("#mBody").addEventListener("click", async e => { if (!window.Region || !current || !e.target.closest(".oor")) return; const a = Region.answer(e, current); if (!a || a.pending) return;
    await App.patch(current.catalog_id, a.patch); selectTab(tab); toast(a.patch.provenance_answer === "collection" ? `Provenance saved: ${a.patch.provenance}` : a.patch.provenance_answer === "local" ? "Noted: found here" : "Noted: not sure. The note stays on the record so you can answer later."); });
  $("#mBody").addEventListener("click", async e => { const b = e.target.closest("[data-recat]"); if (!b || !current) return; const r = current, from = kindOf(r), id = r.catalog_id;
    const o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }) };
    if (b.dataset.recat === "keep") { o.category_kept = from; o.category = from; o.category_history = [...(r.category_history || []), decision(from, from, "Owner kept it here after an auto-categorization suggestion")]; await DB.put(o); local = await DB.all(); refresh(); current = all.find(x => x.catalog_id === id); selectTab(tab); return toast(`Kept in ${KINDS[from].label}`); }
    const to = b.dataset.to; o.category = to; o.category_kept = ""; o.category_note = "";
    Object.entries(KIND_FIELDS).forEach(([k, fs]) => { if (k !== to) fs.forEach(f => o[f] = ""); }); if (to !== "artifact") o.era = "";
    o.category_history = [...(r.category_history || []), decision(from, to, "Auto-categorization rule: " + b.dataset.reason + " (owner confirmed)")];
    await DB.put(o); local = await DB.all(); kind = to; refresh(); current = all.find(x => x.catalog_id === id); $("#mTitle").textContent = current.object_type; selectTab(0); toast(`${id} moved to ${KINDS[to].label}`); });
  $("#mBody").addEventListener("click", async e => { if (!current) return; const id = current.catalog_id;
    if (e.target.closest("[data-confirm]")) { const label = $("#cfType").value.trim(); if (!label) return toast("Enter the identification to confirm");
      const o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }) }, prev = current.suggestion_1 || "";
      if (label.toLowerCase() !== prev.toLowerCase()) { o.suggestion_1 = label; o.suggestion_2 = prev || current.suggestion_2 || ""; o.owner_observations = [current.owner_observations, `ID corrected to “${label}” (was “${prev || "none"}”), ${new Date().toLocaleDateString("en-CA")}.`].filter(Boolean).join(" "); }
      o.status = window.S5 ? "Verified" : "Reviewed"; await DB.put(o); local = await DB.all(); refresh(); current = all.find(x => x.catalog_id === id); // saved as a verified reference example
      await Analysis.learn(current, kindOf(current), label, label.toLowerCase() === prev.toLowerCase() ? "Owner confirmed in analysis panel" : "Owner correction in analysis panel"); selectTab(2); toast(`${id} saved as a verified ${label} example`); }
    if (e.target.closest("[data-forget]")) { await Analysis.forget(id); selectTab(2); toast("Verified example removed from this browser"); } });
  const marksFor = (r, i) => (r.photo_annotations && r.photo_annotations[i]) || (r.photos && r.photos[i] && r.photos[i].annotations) || [];
  async function saveMarks(i, list) { const id = current.catalog_id, o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }) };
    o.photo_annotations = { ...(current.photo_annotations || {}), [i]: list }; await DB.put(o); local = await DB.all(); refresh(); current = all.find(x => x.catalog_id === id); }
  const marksJson = r => ({ catalog_id: r.catalog_id, photos: pics(r).map((p, i) => ({ path: p.src, label: p.label, annotations: marksFor(r, i) })) });
  function mountEvidence() { const h = $("#evHost"); if (!h || !window.Marks) return;
    Marks.mount(h, { r: current, kind: kindOf(current), photos: pics(current), get: i => marksFor(current, i), save: saveMarks, enlarge: i => { lbList = pics(current); lightbox(i); },
      exportMarks: () => download(`${current.catalog_id}-marks.json`, JSON.stringify(marksJson(current), null, 2), "application/json") }); }
  let lbList = [], lbI = 0, lbOn = true;
  function lightbox(i) { lbI = (i + lbList.length) % lbList.length; const p = lbList[lbI];
    $("#lbImg").src = p.src; $("#lbImg").alt = p.label; $("#lbCap").textContent = `${current.catalog_id} · ${p.label} (${lbI + 1}/${lbList.length})`; $("#lb").hidden = false; drawLbMarks(); $("#lbClose").focus(); }
  $("#mBody").addEventListener("click", e => { const b = e.target.closest("[data-lb]"); if (b) { lbList = pics(current); lightbox(+b.dataset.lb); } });
  function drawLbMarks() { const ms = marksFor(current, lbI); $("#lbMarks").hidden = !ms.length; $("#lbMarks").setAttribute("aria-pressed", lbOn); $("#lbMarks").textContent = `Evidence marks: ${lbOn ? "on" : "off"} (${ms.length})`;
    Marks.overlay($("#lbWrap"), $("#lbImg"), ms, lbOn); $("#lbLegend").innerHTML = lbOn && ms.length ? Marks.legend(ms, current, kindOf(current)) : ""; }
  $("#lbMarks").onclick = () => { lbOn = !lbOn; drawLbMarks(); }; Marks.pairHover($("#lb"));
  $("#lbClose").onclick = () => { $("#lb").hidden = true; const b = $(`[data-lb="${lbI}"]`); b && b.focus(); };
  $("#lbPrev").onclick = () => lightbox(lbI - 1); $("#lbNext").onclick = () => lightbox(lbI + 1);
  $("#lb").addEventListener("click", e => { if (e.target.id === "lb") $("#lbClose").click(); });
  document.addEventListener("keydown", e => { if ($("#lb").hidden) return; e.stopImmediatePropagation();
    if (e.key === "Escape") $("#lbClose").click(); if (e.key === "m" || e.key === "M") $("#lbMarks").click(); if (e.key === "ArrowRight") lightbox(lbI + 1); if (e.key === "ArrowLeft") lightbox(lbI - 1); if (e.key === "Tab") { e.preventDefault(); } }, true);
  $(".tabs").addEventListener("click", e => { const b = e.target.closest("[role=tab]"); if (b) selectTab(+b.id.split("-")[1]); });
  $(".tabs").addEventListener("keydown", e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { const n = (tab + d + 4) % 4; selectTab(n); $("#tab-" + n).focus(); } });
  $("#mClose").onclick = closeModal; $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if ($("#modal").hidden) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") { const f = $$("#modal button, #modal input, #modal select, #modal textarea, #modal [tabindex='0']").filter(x => x.offsetParent); const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } });
  $("#grid").addEventListener("click", e => { const c = e.target.closest(".card"); if (c) openModal(c.dataset.id); });

  /* ---------- print ---------- */
  $("#printBtn").onclick = async () => { const r = current, ps0 = pics(r), ai = ps0.findIndex((_, k) => marksFor(r, k).length); let annotated = "";
    if (ai >= 0) { const im = new Image(); im.src = ps0[ai].src; const [W, H] = await Marks.dims(im); annotated = `<figure class="pc-ann">${Marks.printSvg(ps0[ai].src, marksFor(r, ai), W, H)}<figcaption>${esc(ps0[ai].label)} with evidence marks</figcaption>${Marks.legend(marksFor(r, ai), r, kindOf(r))}</figure>`; }
    const rows = [["Collection", KINDS[kindOf(r)].label], ["Category history", histText(r.category_history)], ["Type", r.object_type], ...kindRows(r), ["Material", r.material], ["Color", r.color], ["Condition", r.condition], ["Size", size(r).replace(/<[^>]+>/g, "")], ["Method", r.measure_method], ["Weight", r.weight_g && r.weight_g + " g"], ["Key features", r.key_features], ["Possibilities", suggestions(r).map((s, i) => `${i + 1}. ${s}`).join("<br>")], ["Confidence", r.confidence], ["Owner observations", r.owner_observations], ["Open questions", r.open_questions], ["Status", r.status]];
    $("#printArea").innerHTML = `<div class="pc"><img class="pc-logo" src="assets/brand/lockup-light.svg" alt="${window.Brand ? Brand.name() : "Rolling Oak Catalog"}"><h1>${esc(r.catalog_id)} — ${esc(r.object_type)}</h1><p>${window.Brand ? Brand.name() : "Rolling Oak Catalog"} · ${window.Brand ? Brand.short() : "Rolling Oak"} finds · printed ${new Date().toLocaleDateString()}</p><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${k === "Possibilities" ? v : esc(v || "—")}</td></tr>`).join("")}</table>${annotated}${pics(r).filter((_, k) => k !== ai).slice(0, annotated ? 2 : 3).map(p => `<img src="${esc(p.src)}" alt="">`).join("")}<p class="disc">Possibilities are research suggestions, not identifications. No authenticity or value claims. Exact location omitted.</p></div>`;
    window.print(); };

  /* ---------- export ---------- */
  function exportRows() { const inc = $("#inclPrivate").checked; if (inc && !confirm("Include exact private location in this export? Only do this for your own backup.")) return null;
    return { inc, rows: filtered().map(r => { const o = {}; COLS.forEach(c => o[c] = r[c] ?? ""); if (inc) o[PRIVATE] = r[PRIVATE] ?? ""; o.annotations = marksJson(r).photos.filter(p => p.annotations.length); return o; }) }; }
  function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  const cq = v => { v = Array.isArray(v) ? histText(v) : String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  $("#exportCsv").onclick = () => { const x = exportRows(); if (!x) return; const c = x.inc ? [...COLS, PRIVATE] : COLS; download("elgin_catalog.csv", [c.join(","), ...x.rows.map(r => c.map(k => cq(r[k])).join(","))].join("\n"), "text/csv"); };
  $("#exportJson").onclick = () => { const x = exportRows(); if (x) download("elgin_catalog.json", JSON.stringify(x.rows, null, 2), "application/json"); };

  /* ---------- wizard ---------- */
  const STEPS = ["Category", "Photos", "Measurements", "Description", "AI analysis", "Review & save"];
  let step = 0, photos = [];
  $("#steps").innerHTML = STEPS.map(s => `<li>${s}</li>`).join("");
  function stripExif(file) { // re-encode through canvas: drops all EXIF/GPS metadata
    return new Promise((res, rej) => { const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85)); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Unreadable image")); }; img.src = url; }); }
  async function addPhotos(files, tag) { for (const f of files) { try { photos.push({ name: f.name, tag, src: await stripExif(f) }); } catch { toast("Could not read " + f.name); } }
    drawThumbs(); if (photos.length) $("[data-err=photos]").textContent = ""; }
  $("#pFile").addEventListener("change", async e => { await addPhotos([...e.target.files], $("#pTag").value); e.target.value = ""; });
  const SHOTS = () => { const k = F().category.value || "artifact"; return [["front", "Front", "Straight down, whole piece in frame"], ["back", "Back", "Flip it over, same distance"], ["edge", "Edge / profile", "Side-on to show thickness"], ["scale", "With ruler / scale", "Ruler flat beside the piece"], ["base", k === "artifact" ? "Close-up of base / stem" : "Close-up of key feature", k === "artifact" ? "Fill the frame with the base and stem edges" : k === "fossil" ? "Sutures, ribs, hinge or star pattern" : "Fresh surface, banding or crystals"]]; };
  function drawShots() { const s = SHOTS(), done = s.filter(([t]) => photos.some(p => p.tag === t)).length;
    $("#shotList").innerHTML = `<div class="shot-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${s.length}" aria-valuenow="${done}" aria-label="Recommended shots"><strong>${done} of ${s.length}</strong> recommended shots<span class="bar"><i style="width:${done / s.length * 100}%"></i></span></div>
      <ol class="shots">${s.map(([t, l, h]) => { const ok = photos.some(p => p.tag === t); return `<li class="${ok ? "ok" : ""}"><span class="shot-st" aria-hidden="true">${ok ? "✓" : "○"}</span><span class="shot-t"><strong>${l}</strong><span>${h}</span></span><label class="btn ${ok ? "" : "primary"} shot-btn">📷 ${ok ? "Retake" : "Take"}<input type="file" accept="image/*" capture="environment" data-shot="${t}" class="sr-only" aria-label="Take ${l} photo"></label></li>`; }).join("")}</ol>`; }
  $("#shotList").addEventListener("change", async e => { const t = e.target.dataset.shot; if (!t) return; await addPhotos([...e.target.files], t); e.target.value = ""; });
  $("#gpsBtn").onclick = () => { if (!navigator.geolocation) return toast("Location isn't available on this device");
    $("#gpsMsg").textContent = "Getting location…"; navigator.geolocation.getCurrentPosition(p => { const { latitude: la, longitude: lo, accuracy: a } = p.coords;
      F().find_location_private.value = `${la.toFixed(6)}, ${lo.toFixed(6)} (±${Math.round(a)} m)`; F().location_sharing.value = "Private"; $("#gpsMsg").textContent = "Saved to the private location field only. It is never shown publicly."; },
      err => { $("#gpsMsg").textContent = "Couldn't get location: " + err.message; }, { enableHighAccuracy: true, timeout: 15000 }); };
  function drawThumbs() { if ($("#shotList")) drawShots();
    $("#thumbs").innerHTML = photos.map((p, i) => `<div class="thumb"><img src="${p.src}" alt="Photo ${i + 1}, ${esc(p.tag)} view"><label><span class="sr-only">View tag for photo ${i + 1}</span><select data-i="${i}">${["front", "back", "edge", "base", "scale"].map(t => `<option ${t === p.tag ? "selected" : ""}>${t}</option>`).join("")}</select></label><button type="button" data-rm="${i}">Remove</button></div>`).join("") || '<p class="help">No photos yet.</p>';
  }
  $("#thumbs").addEventListener("change", e => { if (e.target.dataset.i) { photos[e.target.dataset.i].tag = e.target.value; drawShots(); } });
  $("#thumbs").addEventListener("click", e => { if (e.target.dataset.rm) { photos.splice(+e.target.dataset.rm, 1); drawThumbs(); } });
  const F = () => $("#wizard").elements;
  /* "4 in", '2.5"', "1 1/2 in", "6 cm" -> millimetres (string); plain numbers are left alone. */
  function toMm(v) { const t = String(v || "").trim().toLowerCase(); if (!t) return v;
    const m = t.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*(in|inch|inches|"|”|cm|mm)?$/); if (!m || !m[4] || m[4] === "mm") return v;
    const n = +m[1] + (m[2] ? m[2] / m[3] : 0); return String(Math.round(m[4] === "cm" ? n * 10 : n * 25.4)); }
  function validate(i) {
    const err = (k, m) => { const el = $(`[data-err=${k}]`); el.textContent = m; return !m; };
    if (i === 0) return err("kind", F().category.value ? "" : "Choose what kind of find this is.");
    i--;
    if (i === 0) return err("photos", photos.length ? "" : "Add at least one photo (with a scale in view).");
    if (i === 1) { const m = F().measure_method.value, nums = ["length_mm", "width_mm", "thickness_mm", "weight_g"].map(n => F()[n]);
      nums.slice(0, 3).forEach(n => { const v = toMm(n.value); if (v !== n.value) n.value = v; });
      const bad = nums.find(n => n.value && !/^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?$/.test(n.value.trim()));
      if (bad) { bad.focus(); return err("measure", "Use numbers (e.g. 62 or 60-70)."); }
      if (m === "Measured" && !F().length_mm.value) { F().length_mm.focus(); return err("measure", "Enter at least a length, or choose “Estimated from photo” / “Not measured”."); }
      if (m !== "Not measured" && !nums.some(n => n.value)) F().measure_method.value = "Not measured";
      return err("measure", ""); }
    if (i === 2) { if (!F().object_type.value.trim()) { F().object_type.focus(); return err("desc", "Give it a short name, your best guess is fine (e.g. “rock with rings”)."); }
      if (F().public_land.checked) return err("desc", "Finds from public land can’t be catalogued here. Collecting on public land is restricted or illegal.");
      if (!F().landowner_permission.checked) return err("desc", "Please confirm landowner permission.");
      return err("desc", ""); }
    return true;
  }
  function applyKind() { const k = F().category.value || "artifact";
    $$("[data-kind-only]").forEach(el => el.hidden = !el.dataset.kindOnly.split(" ").includes(k));
    $("#aiGuide").textContent = KINDS[k].guide;
    F().material.placeholder = { artifact: "Chert, quartzite…", fossil: "Calcite shell, pyrite mold, limestone…", rock: "Chert, calcite, quartz…" }[k];
    F().object_type.placeholder = { artifact: "Dart point, biface, scraper…", fossil: "Ammonite, echinoid, oyster…", rock: "Nodule, geode, cobble…" }[k];
    $("#s1").textContent = { artifact: "1. Most likely type", fossil: "1. Most likely taxon", rock: "1. Most likely rock / mineral" }[k]; }
  $("#wizard").addEventListener("change", e => { if (e.target.name === "category") { applyKind(); $("[data-err=kind]").textContent = ""; } });
  let wizHist = [], wizKept = "";
  function wizBanner() { if (step !== 4) return; const o = collect(); $("#wizBanner").innerHTML = recatBanner(o, o.category, wizKept); }
  $("#wizard").addEventListener("input", e => { if (/^(suggestion_1|object_type|key_features)$/.test(e.target.name)) wizBanner(); });
  $("#wizBanner").addEventListener("click", e => { const b = e.target.closest("[data-recat]"); if (!b) return; const from = F().category.value;
    if (b.dataset.recat === "keep") { wizKept = from; } else { const to = b.dataset.to; $(`#wizard input[name=category][value=${to}]`).checked = true; applyKind(); wizKept = "";
      wizHist.push({ from, to, date: new Date().toLocaleDateString("en-CA"), ts: new Date().toISOString(), reason: "Auto-categorization rule: " + b.dataset.reason + " (owner confirmed in wizard)" });
      toast(`Moved to ${KINDS[to].label}. Its specific fields are now in the Description step.`); }
    wizBanner(); });
  function collect() { const o = { catalog_id: nextId(), photos }; for (const el of F()) if (el.name && el.type !== "radio" && el.type !== "checkbox") o[el.name] = el.value.trim();
    o.measure_method = F().measure_method.value; o.category = F().category.value || "artifact"; $$("[data-kind-only]").forEach(el => { if (el.hidden) $$("[name]", el).forEach(x => delete o[x.name]); }); o.landowner_permission = F().landowner_permission.checked ? "Yes" : "No"; if (wizHist.length) o.category_history = [...wizHist]; if (wizKept) o.category_kept = wizKept; o.visibility = o.visibility || "private"; o.created_local = true; if (!o.region && window.Region && Region.profile()) o.region = Region.profile().name; Object.assign(o, wizProv); o.confidence = capConf(o.confidence); return o; }
  function showStep(i) {
    step = i; $$(".step").forEach((s, j) => s.hidden = j !== i);
    $$("#steps li").forEach((li, j) => { li.className = j < i ? "done" : j === i ? "cur" : ""; j === i ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"); });
    if (i === 4) autoSuggestWizard();
    wizBanner(); if (i !== 4) { $("#wizBanner").innerHTML = ""; $("#wizRegion").innerHTML = ""; } $("#prev").disabled = i === 0; $("#next").hidden = i === 5; $("#save").hidden = i !== 5;
    if (i === 5) { const o = collect(); $("#summary").innerHTML = `<strong>${o.catalog_id}</strong> · ${esc(KINDS[o.category].label)} · ${esc(o.object_type)} · ${esc(o.material)}<br>${photos.length} photo(s), EXIF stripped · ${size(o)} (${esc(o.measure_method)})<br>Possibilities: ${esc(suggestions(o).join(" / ") || "none")} · Confidence: ${esc(o.confidence)}<br>🔒 Location: ${o[PRIVATE] ? "recorded, private" : "not recorded"} · Sharing: ${esc(o.location_sharing)}`; }
  }
  $("#next").onclick = () => { if (validate(step)) { showStep(step + 1); $(".step:not([hidden]) legend").scrollIntoView({ block: "nearest" }); } };
  $("#prev").onclick = () => showStep(Math.max(0, step - 1));
  $("#wizard").onsubmit = async e => { e.preventDefault(); for (let i = 0; i < 5; i++) if (!validate(i)) return showStep(i);
    if (window.Features && !Features.canAddFind(all)) { toast("Free plan limit reached. Become a Supporter for unlimited finds."); location.hash = "#/pricing"; return; }
    const o = collect(); o.catalog_id = nextId(); await autoAnalyze(o);
    try { await DB.put(o); } catch (err) { return toast("Could not save on this device: " + err.message, { warn: true, ms: 9000 }); }
    local = await DB.all(); refresh(); resetWizard(); kind = o.category; location.hash = "#/catalog"; refresh(); openModal(o.catalog_id);
    if (o.ai_status === "ai-ready") toast(`${o.catalog_id} saved. Local analysis added; open AI analysis to run the photo review.`);
    else toast(`${o.catalog_id} saved with a local analysis. ${o.ai_status === "ai-not-setup" ? "AI photo review isn't set up yet." : ""}`, { ms: 4500 }); };
  /* Local analysis runs on every save (no key needed). AI availability is recorded so the record says why it didn't run. */
  async function autoAnalyze(o) { const rk = Analysis.rank(o, o.category), names = rk.slice(0, 3).map(x => x.c.name);
    if (!o.suggestion_1 && names.length) { names.forEach((n, k) => o["suggestion_" + (k + 1)] = n); o.confidence = capConf(confOf(rk)); }
    o.confidence = capConf(o.confidence || confOf(rk));
    o.local_analysis = { ts: new Date().toISOString(), engine: "local rules + reference KB", candidates: rk.slice(0, 3).map(x => ({ name: x.c.name, score: x.score, why: x.why.join("; "), against: x.against.join("; ") })), region_check: window.Region ? Region.check(o).reasons.map(x => x.reason) : [] };
    if (!o.open_questions) { const ck = (Analysis.checklist ? Analysis.checklist(o, o.category) : null); const unk = Array.isArray(ck) ? ck.filter(x => x[1] === "unknown").slice(0, 4).map(x => x[0]) : []; o.open_questions = (unk.length ? "Not yet recorded: " + unk.join("; ") + ". " : "") + "Next photos: scale photo straight down, close-up of the key feature; weight if possible."; }
    o.ai_status = await aiStatus(); return o; }
  let _ai = null;
  async function aiStatus() { if (_ai) return _ai; const st = window.Cloud ? Cloud.state() : {};
    if (!st.user) return "ai-signed-out";
    if (!(window.Features && Features.isMember && Features.isMember())) return "ai-members";
    const r = await Cloud.analyze({ ping: true }); _ai = r.error && /not found|not configured|AI_API_KEY|404/i.test(r.error) ? "ai-not-setup" : "ai-ready"; return _ai; }
  const AI_TXT = { "ai-not-setup": "AI photo review isn't set up yet (the analyze-find function isn't deployed or has no AI key). The local analysis below was used.", "ai-members": "AI photo review is a Supporter feature. The local analysis below was used.", "ai-signed-out": "Sign in to use AI photo review. The local analysis below was used.", "ai-ready": "AI photo review is available: open AI analysis and press “Analyze photos with AI”." };
  const aiChip = r => r.ai_status ? `<p class="help ai-st">🤖 ${esc(AI_TXT[r.ai_status] || "")}</p>` : "";
  /* Runs the local analyzer as soon as the AI step opens and pre-fills empty suggestion boxes (owner can overwrite). */
  function autoSuggestWizard() { const o = collect(); $("#wizSuggest").innerHTML = Analysis.suggestHtml(o, o.category);
    if (window.Learn) $("#wizSimilar").innerHTML = Learn.similarHtml({ ...o, catalog_id: o.catalog_id || "NEW" });
    const rk = Analysis.rank(o, o.category), f = F();
    if (!f.suggestion_1.value && !f.suggestion_2.value && !f.suggestion_3.value && rk.length) { rk.slice(0, 3).forEach((x, k) => f["suggestion_" + (k + 1)].value = x.c.name); f.confidence.value = capConf(confOf(rk)); }
    if (window.Region) $("#wizRegion").innerHTML = Region.bannerHtml({ ...o, catalog_id: "NEW", ...wizProv }); }
  const confOf = rk => !rk.length ? "Low" : rk[0].score >= 7 && rk[0].score - (rk[1]?.score || 0) >= 2 ? "Moderate" : rk[0].score >= 4 ? "Low-moderate" : "Low";
  const capConf = c => /high/i.test(c || "") ? "Moderate" : (c || "Low");
  let wizProv = {};
  $("#wizRegion").addEventListener("click", e => { if (!window.Region) return; const a = Region.answer(e, { ...collect(), catalog_id: "NEW" }); if (!a || a.pending) return; wizProv = a.patch; $("#wizRegion").innerHTML = `<p class="help ok">✓ Provenance noted: ${esc(a.patch.provenance || "not sure")}</p>`; });
  function resetWizard() { wizProv = {}; $("#wizard").reset(); photos = []; wizHist = []; wizKept = ""; drawThumbs(); $$(".err").forEach(e => e.textContent = ""); applyKind(); showStep(0); }

  /* ---------- routing, theme, toast ---------- */
  $("#wizard").addEventListener("click", e => {
    if (e.target.id === "suggestBtn") { const o = collect(); $("#wizSuggest").innerHTML = Analysis.suggestHtml(o, o.category); if (window.Learn) $("#wizSimilar").innerHTML = Learn.similarHtml({ ...o, catalog_id: o.catalog_id || "NEW" }); }
    if (e.target.id === "useSuggest") { const rk = Analysis.rank(collect(), collect().category); ["suggestion_1", "suggestion_2", "suggestion_3"].forEach((n, i) => F()[n].value = rk[i] ? rk[i].c.name : F()[n].value); wizBanner(); toast("Filled your 3 possibilities. Edit freely."); } });
  function renderModel() { $("#modelPanel").innerHTML = Analysis.panelHtml();
    $("#exLearn").onclick = () => download("learned-examples.json", Analysis.exportJSON(), "application/json");
    $("#imLearn").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { toast(`Imported ${await Analysis.importJSON(await f.text())} examples`); renderModel(); } catch { toast("Not a valid learned-examples.json"); } }; }
  function route() { const v = (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1], view = ["catalog", "add", "about", "timeline", "people", "map", "labels", "profile", "members", "pricing", "c", "find", "discover", "review", "library", "settings"].includes(v) ? v : "catalog";
    const param = (location.hash.match(/^#\/\w+\/([\w-]+)/) || [])[1];
    if (v === "record" && param && all.length && (!current || current.catalog_id !== param)) setTimeout(() => openModal(param), 0);
    if (v === "find" && current) { $("#modal").hidden = true; document.body.style.overflow = ""; current = null; }
    $$(".view").forEach(s => s.hidden = s.id !== "view-" + view);
    $$("nav a").forEach(a => a.dataset.route === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    if (view === "add") { $("#newId").textContent = "New ID: " + nextId(); const q = (location.hash.match(/kind=(\w+)/) || [])[1]; if (q && KINDS[q] && step === 0) { const rb = $(`#wizard input[name=category][value=${q}]`); rb.checked = true; applyKind(); } }
    if (view === "about" && window.Analysis) { renderModel(); if (window.Learn) Learn.renderAbout(); }
    if (window.Features) Features.render(view, param);
    document.title = { catalog: "Catalog", add: "Add find", about: "About & methods", timeline: "Deep time", people: "People & land", map: "Private find map", labels: "QR labels", profile: "Profile", members: "Collection members", pricing: "Membership", c: "Collection", find: "Find", discover: "Discover public finds", review: "Review queue", library: "Reference Library", settings: "Settings" }[view] + " — " + (window.Brand ? Brand.name() : "Rolling Oak Catalog"); if (view === "find" && window.Learn) Promise.resolve(Learn.renderPublic(param)).then(() => window.S2 && S2.afterPublic(param)); if (window.S2) S2.render(view); }
  window.addEventListener("hashchange", () => { if (/^#\/record\//.test(location.hash)) { const id = location.hash.split("/")[2]; route(); if (!current || current.catalog_id !== id) openModal(id); return; }
    if (location.hash === "#browse") { route(); $("#browse").focus({ preventScroll: true }); $("#browse").scrollIntoView({ behavior: "smooth" }); return; } route(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); });
  function setTheme(t) { document.documentElement.dataset.theme = t; $("#themeToggle").setAttribute("aria-pressed", t === "dark"); $("#themeToggle").textContent = t === "dark" ? "☀ Light mode" : "☾ Dark mode"; try { localStorage.setItem("elgin-theme", t); } catch {} }
  $("#themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  function toast(m, opt = {}) { const t = document.createElement("div"); t.textContent = m; t.setAttribute("role", opt.warn ? "alert" : "status"); if (opt.warn) t.className = "toast-warn";
    Object.assign(t.style, { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", background: opt.warn ? "#7a1f12" : "var(--ink)", color: opt.warn ? "#fff" : "var(--bg)", padding: "10px 16px", borderRadius: "8px", zIndex: 99, maxWidth: "min(92vw, 560px)" });
    if (opt.warn) { const x = document.createElement("button"); x.textContent = "✕"; x.setAttribute("aria-label", "Dismiss"); Object.assign(x.style, { marginLeft: "10px", background: "none", border: "0", color: "inherit", cursor: "pointer" }); x.onclick = () => t.remove(); t.appendChild(x); }
    document.body.appendChild(t); setTimeout(() => t.remove(), opt.ms || 2600); }
  ["#q", "#fStatus", "#fCat", "#fConf"].forEach(s => $(s).addEventListener("input", renderGrid));

  /* ---------- API for features.js ---------- */
  window.App = { get all() { return all; }, get current() { return current; }, openModal, closeModal, kindOf, KINDS, eraOf, marksFor, pics, esc, toast, stripExif, download, refresh, route,
    async patch(id, obj) { const o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }), ...obj }; await DB.put(o); local = await DB.all(); refresh(); if (current && current.catalog_id === id) { current = all.find(x => x.catalog_id === id); } },
    async saveMarks(id, i, list) { const r = all.find(x => x.catalog_id === id), o = { ...(local.find(x => x.catalog_id === id) || { catalog_id: id }) }; o.photo_annotations = { ...(r.photo_annotations || {}), [i]: list }; await DB.put(o); local = await DB.all(); refresh(); if (current && current.catalog_id === id) current = all.find(x => x.catalog_id === id); },
    reselect() { if (current) selectTab(tab); } };
  /* ---------- sign-in UI ---------- */
  function renderAuth() { if (!window.Cloud) return; const s = Cloud.state(), b = $("#authBtn"), pill = $("#syncPill");
    pill.textContent = s.online ? (s.user ? "☁ Synced" : "☁ Cloud") : "Offline copy"; pill.title = s.online ? "Reading from the shared Supabase catalog" : "Using the built-in catalog.json and this browser's storage";
    b.hidden = !s.available; b.textContent = s.user ? "Account" : "Sign in";
    $("#authState").innerHTML = s.user ? `Signed in as <strong>${esc(s.user.email || (s.user.phone && window.AuthOptions ? AuthOptions.pretty(s.user.phone) : s.user.phone) || "your account")}</strong>. Edits, marks, photos and verified examples sync to the shared catalog${s.online ? "" : " (cloud tables not reachable yet, so changes stay on this device)"}.` : "Sign in to sync your edits across devices. Visitors can browse without an account.";
    $("#authForm").hidden = !!s.user; $("#signOut").hidden = !s.user; }
  $("#authBtn").onclick = () => { renderAuth(); $("#authDlg").showModal(); };
  $("#authClose").onclick = () => $("#authDlg").close();
  $("#authForm").onsubmit = e => e.preventDefault();
  const authMsg = (m, ok) => { const el = $("#authMsg"); el.textContent = m; el.className = ok ? "help ok" : "err"; };
  const authDo = async (fn, okMsg) => { const em = $("#authEmail").value.trim(), pw = $("#authPw").value; if (!/.+@.+\..+/.test(em)) return authMsg("Enter a valid email.");
    try { const { error } = await fn(em, pw); if (error) return authMsg(error.message); authMsg(okMsg, true); renderAuth(); if (Cloud.state().user) setTimeout(() => location.reload(), 600); } catch (err) { authMsg("Could not reach the sign-in service: " + err.message); } };
  $("#authMagic").onclick = () => authDo(em => Cloud.magicLink(em), "Check your email for a sign-in link.");
  $("#authPwIn").onclick = () => $("#authPw").value ? authDo((em, pw) => Cloud.signIn(em, pw), "Signed in.") : authMsg("Enter your password, or use the email link.");
  $("#authSignUp").onclick = () => $("#authPw").value.length >= 8 ? authDo((em, pw) => Cloud.signUp(em, pw), "Account created. Confirm via the email we sent.") : authMsg("Choose a password of at least 8 characters.");
  $("#signOut").onclick = async () => { await Cloud.signOut(); location.reload(); };

  /* ---------- boot ---------- */
  (async () => {
    let saved; try { saved = localStorage.getItem("elgin-theme"); } catch {}
    setTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    route(); drawThumbs(); applyKind(); showStep(0);
    if (window.Cloud) { await Cloud.init(); Cloud.on(renderAuth); }
    const cloudRows = window.Cloud ? await Cloud.loadFinds() : null;
    let json = [];
    try { const r = await fetch("data/catalog.json", { cache: "no-cache" }); json = (await r.json()).map(({ [PRIVATE]: _, ...x }) => x); }
    catch { if (!cloudRows) $("#count").textContent = "Could not load data/catalog.json. Serve the folder over HTTP (see README)."; }
    if (cloudRows) { // cloud wins field-by-field; the bundled copy only fills gaps (finds or photos not uploaded yet)
      const byId = new Map(json.map(r => [r.catalog_id, r]));
      cloudRows.forEach(c => { const j = byId.get(c.catalog_id) || {}; byId.set(c.catalog_id, { ...j, ...c, photos: (c.photos && c.photos.length) ? c.photos : (j.photos || []) }); });
      seed = [...byId.values()]; // PRIVATE only present here for the signed-in owner (owner-only table)
    } else seed = json;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    await Analysis.init(); if (window.Region) await Region.load();
    if (cloudRows) { const ex = await Cloud.loadExamples(); if (ex) Analysis.setShared(ex); }
    const _learn = Analysis.learn, _forget = Analysis.forget;
    Analysis.learn = async (...a) => { const e = await _learn(...a); if (window.Cloud) Cloud.pushExample(e); return e; };
    Analysis.forget = async id => { await _forget(id); if (window.Cloud) Cloud.forgetExample(id); };
    renderAuth();
    try { await DB.open(); local = await DB.all(); await renumberCollisions(); } catch { toast("IndexedDB unavailable: additions won’t be saved."); }
    refresh(); route(); retryPending();
    if (window.Cloud) { let had = !!Cloud.state().user; Cloud.on(st => { if (st.user && !had) { had = true; retryPending(); } }); }
    if (conflicts.size) { // move the stale local copy out of the way (backed up), so no later edit or sync retry can resurrect it over the canonical record
      const bk = (() => { try { return JSON.parse(localStorage.getItem("ro-set-aside") || "[]"); } catch { return []; } })();
      for (const [id, r] of conflicts) { bk.push({ ...r, set_aside_ts: new Date().toISOString() }); await _del(id); }
      try { localStorage.setItem("ro-set-aside", JSON.stringify(bk.slice(-20))); } catch {}
      local = await DB.all(); refresh();
      toast(`${[...conflicts.keys()].join(", ")}: showing the corrected catalog record. Your earlier copy on this device was set aside (backed up, not deleted).`, { ms: 8000 }); conflicts.clear(); }
    const m = location.hash.match(/^#\/record\/([A-Z]+-\d+)/); if (m) openModal(m[1]);
    if (window.Cloud && Cloud.state().user) Cloud.acceptInvites().then(n => n && toast(`Joined ${n} shared collection${n > 1 ? "s" : ""}`));
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
