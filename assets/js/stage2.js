/* Rolling Oak Stage 2: Discover, comments & expert requests, measurement sources + ruler helper, field notes,
   next-photos checklist. Public surfaces only ever use safe columns; exact locations are never read here. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const st = () => (window.Cloud ? Cloud.state() : { user: null });
  const canEdit = () => { const s = st(); if (!s.user) return !s.online; return window.Features && Features.isEditor ? Features.isEditor() : false; };

  /* ---------- measurement sources ---------- */
  const DIMS = [["length_mm", "Length", "mm"], ["width_mm", "Width", "mm"], ["thickness_mm", "Thickness", "mm"], ["weight_g", "Weight", "g"]];
  const SRC = { measured: ["📏", "Measured", "caliper / ruler / scale"], photo_estimate: ["📷", "Photo estimate", "estimated from a photo with a scale"], estimate: ["≈", "Estimate", "rough estimate"] };
  function srcOf(r, k) { const v = r[k.replace(/_(mm|g)$/, "") + "_source"]; if (SRC[v]) return v; if (!r[k]) return null; const m = r.measure_method || "";
    return /^measured/i.test(m) ? "measured" : /photo/i.test(m) ? "photo_estimate" : "estimate"; }
  const srcKey = k => k.replace(/_(mm|g)$/, "") + "_source";
  const badge = s => s ? `<span class="msrc msrc-${s}" title="${esc(SRC[s][2])}">${SRC[s][0]} ${SRC[s][1]}</span>` : "";
  function dimsHtml(r, compact) { const rows = DIMS.filter(([k]) => r[k]);
    if (!rows.length) return '<p class="help">Not measured yet.</p>';
    return `<dl class="dims ${compact ? "compact" : ""}">${rows.map(([k, l, u]) => `<div class="dim dim-${srcOf(r, k)}"><dt>${l}</dt><dd><strong>${esc(r[k])}</strong> ${u} ${badge(srcOf(r, k))}</dd></div>`).join("")}</dl>`; }
  const sizeTag = r => { const ss = DIMS.map(([k]) => srcOf(r, k)).filter(Boolean); return !ss.length ? "" : ss.every(s => s === "measured") ? " 📏" : ss.some(s => s === "photo_estimate") ? " 📷 est." : " ≈ est."; };

  /* mm / in conversion for inputs (storage is always mm) */
  const conv = (v, f) => String(v || "").replace(/\d+(\.\d+)?/g, n => String(Math.round(+n * f * 100) / 100));
  function unitToggle(form, keys) { const bar = document.createElement("div"); bar.className = "unit-bar";
    bar.innerHTML = `<span class="help">Units for length/width/thickness:</span><div class="seg-sm" role="group" aria-label="Units"><button type="button" class="btn" data-u="mm" aria-pressed="true">mm</button><button type="button" class="btn" data-u="in" aria-pressed="false">in</button></div><span class="help">Saved in mm.</span>`;
    let unit = "mm"; const orig = {}; const set = u => { if (u === unit) return; const f = u === "in" ? 1 / 25.4 : 25.4; keys.forEach(k => { const i = form.querySelector(`[name=${k}]`);
        if (i && i.value) { if (u === "in") { const v = conv(i.value, f); orig[k] = [i.value, v]; i.value = v; } else i.value = orig[k] && orig[k][1] === i.value ? orig[k][0] : conv(i.value, f); } const lab = i && i.closest("label") && i.closest("label").querySelector("span"); if (lab) lab.textContent = lab.textContent.replace(/\((mm|in)\)/, `(${u})`); });
      unit = u; $$("[data-u]", bar).forEach(b => b.setAttribute("aria-pressed", b.dataset.u === u)); };
    bar.onclick = e => { const b = e.target.closest("[data-u]"); if (b) set(b.dataset.u); };
    form.addEventListener("submit", () => set("mm"), true); // convert back before the app reads the form
    bar.toMm = () => set("mm"); return bar; }
  function sourceSelect(k, cur) { return `<select name="${srcKey(k)}" class="src-sel" aria-label="Source for ${k.split("_")[0]}"><option value="">Source…</option>${Object.entries(SRC).map(([v, [ic, t]]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${ic} ${t}</option>`).join("")}</select>`; }
  function enhanceDims(form, r, photosFn) { if (!form || form.dataset.s2) return; form.dataset.s2 = "1";
    const first = form.querySelector("[name=length_mm]"); if (!first) return;
    DIMS.forEach(([k]) => { const i = form.querySelector(`[name=${k}]`); if (!i) return; i.setAttribute("inputmode", "decimal"); i.setAttribute("enterkeyhint", "next"); i.setAttribute("autocomplete", "off");
      const l = i.closest("label"); l.classList.add("dim-field"); l.insertAdjacentHTML("beforeend", sourceSelect(k, r ? (r[srcKey(k)] || (r[k] ? srcOf(r, k) : "")) : "")); });
    const row = first.closest(".row"), bar = unitToggle(form, ["length_mm", "width_mm", "thickness_mm"]); row.before(bar);
    const rb = document.createElement("button"); rb.type = "button"; rb.className = "btn ruler-btn"; rb.textContent = "📐 Measure from a photo (ruler helper)"; bar.appendChild(rb);
    rb.onclick = () => { bar.toMm(); rulerHelper(photosFn(), res => { Object.entries(res).forEach(([k, v]) => { const i = form.querySelector(`[name=${k}]`), s = form.querySelector(`[name=${srcKey(k)}]`); if (i) i.value = v; if (s) s.value = "photo_estimate"; });
      const mm = form.querySelector("[name=measure_method][value='Estimated']"); if (mm && !form.querySelector("[name=measure_method]:checked[value='Measured']")) mm.checked = true; App.toast("Filled as 📷 Photo estimate. Check with a caliper when you can."); }); }; }

  /* ---------- ruler-assisted measurement ---------- */
  function rulerHelper(photos, done) { photos = (photos || []).filter(p => p && p.src); let dlg = $("#rulerDlg");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "rulerDlg"; dlg.setAttribute("aria-labelledby", "rulerH"); document.body.appendChild(dlg); }
    if (!photos.length) { dlg.innerHTML = `<div class="auth-card"><h2 id="rulerH">Ruler helper</h2><p>Add a photo with a ruler or scale beside the piece first.</p><button class="btn" value="x" formmethod="dialog" onclick="this.closest('dialog').close()">Close</button></div>`; dlg.showModal(); return; }
    let pi = Math.max(0, photos.findIndex(p => /scale|ruler/i.test(p.label + p.view))), pts = [], scale = null, dim = "length_mm"; const res = {};
    const draw = () => { const p = photos[pi], step = scale ? 2 : 1;
      dlg.innerHTML = `<div class="auth-card ruler-card"><div class="modal-head"><h2 id="rulerH">📐 Ruler helper</h2><button type="button" class="btn ghost icon" data-x aria-label="Close">✕</button></div>
        <ol class="ruler-steps"><li class="${step === 1 ? "now" : "ok"}">Tap two marks on the ruler, then enter the real distance between them.</li><li class="${step === 2 ? "now" : ""}">Pick a dimension and tap its two end points on the piece.</li></ol>
        ${photos.length > 1 ? `<label class="field"><span>Photo</span><select class="r-photo">${photos.map((q, i) => `<option value="${i}" ${i === pi ? "selected" : ""}>${i + 1}. ${esc(q.label || "photo")}</option>`).join("")}</select></label>` : ""}
        <div class="ruler-stage"><img src="${esc(p.src)}" alt="Photo for measuring" class="r-img" draggable="false"><svg class="r-svg" aria-hidden="true"></svg></div>
        ${step === 1 ? `<div class="row r-cal"><label class="field"><span>Distance between the two ruler marks</span><input class="r-known" inputmode="decimal" value="10" aria-describedby="rHelp"></label><label class="field"><span>Unit</span><select class="r-unit"><option>mm</option><option>cm</option><option>in</option></select></label><button type="button" class="btn primary r-setscale" ${pts.length < 2 ? "disabled" : ""}>Set scale</button></div><p class="help" id="rHelp">${pts.length}/2 ruler points. Tip: use marks far apart (e.g. 0 and 5 cm) for better accuracy.</p>`
        : `<p class="help">Scale: <strong>${scale.toFixed(2)} px/mm</strong> <button type="button" class="btn ghost r-recal">Re-calibrate</button></p><div class="seg-sm" role="radiogroup" aria-label="Dimension">${[["length_mm", "Length"], ["width_mm", "Width"], ["thickness_mm", "Thickness"]].map(([k, l]) => `<button type="button" class="btn" data-dim="${k}" aria-pressed="${k === dim}">${l}${res[k] ? ` · ${res[k]} mm` : ""}</button>`).join("")}</div><p class="help">${pts.length}/2 points for ${dim.split("_")[0]}.</p>`}
        <p class="help">Results are <strong>📷 Photo estimates</strong>: perspective and tilt add error. Keep the piece flat and in the same plane as the ruler.</p>
        <div class="row"><button type="button" class="btn primary r-apply" ${Object.keys(res).length ? "" : "disabled"}>Use these measurements</button><button type="button" class="btn" data-x>Cancel</button></div></div>`;
      const img = $(".r-img", dlg), svg = $(".r-svg", dlg);
      const paint = () => { const W = img.naturalWidth || 1, H = img.naturalHeight || 1; svg.setAttribute("viewBox", `0 0 ${W} ${H}`); const sw = Math.max(2, W / 250);
        svg.innerHTML = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${sw * 3}" fill="#F2B36A" stroke="#1A1512" stroke-width="${sw}"/>`).join("") + (pts.length === 2 ? `<line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" stroke="${scale ? "#2F8F8A" : "#F2B36A"}" stroke-width="${sw}" stroke-dasharray="${sw * 3}"/>` : ""); };
      img.complete ? paint() : img.addEventListener("load", paint, { once: true });
      img.onclick = e => { const b = img.getBoundingClientRect(), x = (e.clientX - b.left) * img.naturalWidth / b.width, y = (e.clientY - b.top) * img.naturalHeight / b.height;
        if (pts.length >= 2) pts = []; pts.push([x, y]);
        if (scale && pts.length === 2) { const mm = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / scale; res[dim] = String(Math.round(mm * 10) / 10); const nx = ["length_mm", "width_mm", "thickness_mm"].find(k => !res[k]); if (nx) dim = nx; pts = []; }
        draw(); };
      $$("[data-x]", dlg).forEach(b => b.onclick = () => dlg.close());
      const ph = $(".r-photo", dlg); if (ph) ph.onchange = () => { pi = +ph.value; pts = []; if (!scale) draw(); else draw(); };
      const ss = $(".r-setscale", dlg); if (ss) ss.onclick = () => { const k = parseFloat($(".r-known", dlg).value), u = $(".r-unit", dlg).value; if (!(k > 0)) return App.toast("Enter the known distance");
        const mm = k * (u === "cm" ? 10 : u === "in" ? 25.4 : 1); scale = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / mm; pts = []; draw(); };
      const rc = $(".r-recal", dlg); if (rc) rc.onclick = () => { scale = null; pts = []; draw(); };
      $$("[data-dim]", dlg).forEach(b => b.onclick = () => { dim = b.dataset.dim; pts = []; draw(); });
      $(".r-apply", dlg).onclick = () => { dlg.close(); done(res); }; };
    draw(); if (!dlg.open) dlg.showModal(); }

  /* ---------- field notes ---------- */
  const HEAT = { none: "None seen", possible: "Possible", likely: "Likely", unknown: "Unknown" };
  function fieldNotesForm(r) { return `<fieldset class="field-notes"><legend>Field notes</legend>
    <label class="field"><span>Condition notes</span><textarea name="condition_notes" rows="2" placeholder="e.g. tip snapped, old patina on breaks, plow scar on one face">${esc(r.condition_notes)}</textarea></label>
    <div class="row"><label class="field"><span>Possible heat treatment</span><select name="heat_treatment">${Object.entries(HEAT).map(([v, t]) => `<option value="${v}" ${(r.heat_treatment || "unknown") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field grow"><span>Heat notes (luster, color change, potlids, crazing)</span><input name="heat_notes" value="${esc(r.heat_notes)}" placeholder="e.g. waxy luster on flake scars, pink tip, no potlids"></label></div>
    <label class="field"><span>Use-wear observations</span><textarea name="use_wear" rows="2" placeholder="e.g. edge rounding near tip under 10× loupe, micro-chipping on one edge">${esc(r.use_wear)}</textarea></label>
    <p class="help">Observations, not conclusions. Heat treatment and use-wear need magnification and expert comparison to confirm.</p></fieldset>`; }
  function fieldNotesHtml(r) { const h = r.heat_treatment && r.heat_treatment !== "unknown";
    if (!r.condition_notes && !h && !r.heat_notes && !r.use_wear) return "";
    return `<div class="fn-view"><h3 class="gal-h">Field notes</h3><dl class="kv">${r.condition_notes ? `<dt>Condition</dt><dd class="pre">${esc(r.condition_notes)}</dd>` : ""}${h || r.heat_notes ? `<dt>Heat treatment</dt><dd><span class="heat heat-${esc(r.heat_treatment || "unknown")}">${esc(HEAT[r.heat_treatment] || "Unknown")}</span> ${esc(r.heat_notes || "")}</dd>` : ""}${r.use_wear ? `<dt>Use-wear</dt><dd class="pre">${esc(r.use_wear)}</dd>` : ""}</dl></div>`; }

  /* ---------- next photos checklist (per type, with why + done state) ---------- */
  const SHOTS = {
    artifact: [["front", /front|face|obverse/, "Front, square-on, even light", "Shows outline, blade shape and flaking pattern, the first things type guides compare."],
      ["back", /back|reverse/, "Back (reverse) face", "Bifacial flaking and any unfinished/cortex areas show on the other face."],
      ["edge", /edge|profile|side/, "Edge profile (side-on)", "Reveals thickness, cross-section (lenticular/plano-convex) and beveling."],
      ["base", /base|stem|haft|notch/, "Base / stem close-up under raking light", "Grinding vs sharp edges and notch shape are among the most diagnostic traits."],
      ["scale", /scale|ruler/, "Flat on a ruler, camera straight above", "Lets length/width be checked against each type's size range."],
      ["tip", /tip|point|distal/, "Tip close-up", "Impact fractures or resharpening change how the outline should be read."]],
    fossil: [["front", /front|top|dorsal/, "Top / dorsal view", "Overall shape and ornament (ribs, tubercles)."], ["edge", /edge|side|aperture|profile/, "Side or aperture view", "Coiling, aperture shape and thickness separate similar genera."],
      ["detail", /detail|suture|close/, "Close-up of sutures, ribbing or hinge", "Suture patterns and hinge teeth are key diagnostic features."], ["scale", /scale|ruler/, "With a ruler", "Size narrows the possibilities."], ["matrix", /matrix|rock|context/, "The rock it came from", "The host rock hints at formation and age."]],
    rock: [["front", /front|fresh|break/, "Fresh broken surface", "Grain, luster and color are clearest on a fresh break."], ["back", /back|weather|rind/, "Weathered surface / rind", "Weathering color and texture help identify the rock."],
      ["scale", /scale|ruler/, "With a ruler", "Grain size needs a scale."], ["streak", /streak|test/, "Streak test on unglazed tile", "Streak color separates look-alike minerals."], ["luster", /luster|light|shine/, "Raking light for luster", "Glassy, waxy or metallic luster is diagnostic."]] };
  const shotKey = id => "ro-shots-" + id;
  function shotDone(r) { let m = {}; try { m = JSON.parse(localStorage.getItem(shotKey(r.catalog_id)) || "{}"); } catch {} return m; }
  function nextPhotosHtml(r) { const kind = App.kindOf(r), ps = App.pics(r), manual = shotDone(r), list = SHOTS[kind] || SHOTS.artifact;
    const items = list.map(([k, re, t, why]) => { const auto = ps.some(p => re.test(String(p.view + " " + p.label).toLowerCase())); return { k, t, why, done: auto || !!manual[k], auto }; });
    const n = items.filter(i => i.done).length;
    return `<div class="np"><h3 class="gal-h">📷 Next photos checklist <span class="chip">${n}/${items.length} done</span></h3><div class="np-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${n}" aria-label="Photos done"><i style="width:${Math.round(100 * n / items.length)}%"></i></div>
      <ul class="np-list">${items.map(i => `<li class="${i.done ? "done" : ""}"><label class="check"><input type="checkbox" data-shot="${i.k}" ${i.done ? "checked" : ""} ${i.auto ? "disabled" : ""}> <strong>${esc(i.t)}</strong>${i.auto ? ' <span class="chip ok">photo on file</span>' : ""}</label><p class="help"><strong>Why:</strong> ${esc(i.why)}</p></li>`).join("")}</ul></div>`; }
  function wireNext(host, r) { $$("[data-shot]", host).forEach(c => c.onchange = () => { const m = shotDone(r); m[c.dataset.shot] = c.checked; localStorage.setItem(shotKey(r.catalog_id), JSON.stringify(m)); const n = document.createElement("div"); n.innerHTML = nextPhotosHtml(r); host.replaceWith(n.firstElementChild); wireNext($(".np", n.parentNode || document) || n, r); }); }

  /* ---------- comments & expert requests ---------- */
  const KIND = { comment: ["💬", "Comment"], question: ["❓", "Question"], expert: ["🧑‍🔬", "Expert input requested"] };
  async function renderComments(host, r) { if (!host) return; host.innerHTML = '<p class="help">Loading comments…</p>';
    const list = window.Cloud ? await Cloud.comments(r.catalog_id) : null, s = st(), me = s.user && s.user.id, mod = canEdit() && !!s.user;
    const open = (list || []).filter(c => c.kind !== "comment" && !c.resolved).length;
    host.innerHTML = `<section class="comments" aria-labelledby="cmH-${esc(r.catalog_id)}"><h3 class="gal-h" id="cmH-${esc(r.catalog_id)}">Comments &amp; expert input ${list ? `<span class="chip">${list.length}</span>` : ""}${open ? ` <span class="chip warn">${open} open</span>` : ""}</h3>
      ${list === null ? '<p class="help">Comments load when the shared catalog is online.</p>' : list.length ? `<ol class="cm-list">${list.map(c => `<li class="cm cm-${esc(c.kind)} ${c.resolved ? "resolved" : ""}" data-id="${esc(c.id)}"><div class="cm-h"><strong>${esc(c.author || "Member")}</strong> <span class="muted">${esc(new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</span>${c.kind !== "comment" ? ` <span class="kbadge kb-${esc(c.kind)}">${KIND[c.kind][0]} ${KIND[c.kind][1]}</span>` : ""}${c.resolved ? ' <span class="kbadge kb-res">✓ Resolved</span>' : ""}</div>
        <p class="cm-b">${esc(c.body)}</p><div class="cm-a">${mod && c.kind !== "comment" ? `<button type="button" class="btn ghost" data-res="${c.resolved ? 0 : 1}">${c.resolved ? "Reopen" : "Mark resolved"}</button>` : ""}${me && (c.user_id === me || mod) ? `<button type="button" class="btn ghost" data-del>${c.user_id === me ? "Delete" : "Remove (moderate)"}</button>` : ""}</div></li>`).join("")}</ol>` : '<p class="help">No comments yet.</p>'}
      ${list === null ? "" : s.user ? `<form class="cm-form" novalidate><div class="seg-sm" role="radiogroup" aria-label="Type">${Object.entries(KIND).map(([k, [ic, t]], i) => `<label class="pill"><input type="radio" name="kind" value="${k}" ${i ? "" : "checked"}> ${ic} ${k === "expert" ? "Request expert input" : k === "question" ? "Ask a question" : t}</label>`).join("")}</div>
        <label class="field"><span class="sr-only">Your comment</span><textarea name="body" rows="3" maxlength="4000" required placeholder="Share an observation, ask a question, or describe what you'd like an expert to look at."></textarea></label>
        <div class="row"><button class="btn primary">Post</button><span class="help">Be kind. No site locations. Owners can remove comments.</span></div><p class="err" role="alert"></p></form>`
        : `<div class="gate"><p>Sign in to comment, ask a question or request expert input.</p><button type="button" class="btn primary" data-signin>Sign in</button></div>`}</section>`;
    const f = $(".cm-form", host); if (f) f.onsubmit = async e => { e.preventDefault(); const body = f.body.value.trim(); if (!body) { $(".err", f).textContent = "Write something first."; return; }
      if (/-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(body)) { $(".err", f).textContent = "Please don't post coordinates. Exact find locations stay private."; return; }
      const k = f.kind.value, res = await Cloud.addComment(r.catalog_id, k, body); if (res.error) { $(".err", f).textContent = res.error.message || res.error; return; } App.toast(k === "expert" ? "Expert input requested" : "Posted"); renderComments(host, r); };
    $$("[data-res]", host).forEach(b => b.onclick = async () => { await Cloud.resolveComment(b.closest("li").dataset.id, b.dataset.res === "1"); renderComments(host, r); });
    $$("[data-del]", host).forEach(b => b.onclick = async () => { if (!confirm("Delete this comment?")) return; await Cloud.deleteComment(b.closest("li").dataset.id); renderComments(host, r); }); }

  /* ---------- Discover ---------- */
  const SAFE = ["catalog_id", "category", "object_type", "material", "era", "region", "suggestion_1", "suggestion_2", "suggestion_3", "confidence", "status", "key_features", "length_mm", "width_mm", "thickness_mm", "weight_g", "length_source", "width_source", "thickness_source", "weight_source", "measure_method", "thumb", "verified"];
  const safe = r => { const o = {}; SAFE.forEach(k => { if (r[k] != null) o[k] = r[k]; }); return o; };
  let dState = { q: "", region: "", kind: "", type: "", era: "", material: "", conf: "", page: 1 }, dData = null, dSrc = "";
  const PAGE = 12;
  async function loadDiscover() { const remote = window.Cloud && Cloud.discover ? await Cloud.discover() : null;
    if (remote && remote.length) { dSrc = "Shared catalog"; return remote.map(d => safe({ ...d, era: d.era || "Undetermined" })); }
    dSrc = st().online ? "Public finds" : "Offline copy (public finds)";
    return App.all.filter(r => window.Learn ? Learn.vis(r) === "public" : r.is_public !== false).map(r => safe({ ...r, region: window.Learn ? Learn.regionOf(r) : "Texas", era: App.eraOf(r), category: App.kindOf(r), thumb: (App.pics(r)[0] || {}).thumb, verified: !!(window.Learn && Learn.verified(r)) })); }
  const matKey = m => String(m || "").split(/[\s/,(]/)[0].replace(/\?/g, "").trim() || "Unrecorded";
  const confKey = c => /moderate/i.test(c || "") && !/low/i.test(c) ? "Moderate" : /low-?moderate/i.test(c || "") ? "Low-moderate" : /low/i.test(c || "") ? "Low" : "Not set";
  async function renderDiscover() { const host = $("#discoverBody"); if (!host) return; if (!dData) { host.innerHTML = '<p class="help">Loading public finds…</p>'; dData = await loadDiscover(); }
    const opts = (f) => [...new Set(dData.map(f).filter(Boolean))].sort();
    const F = { region: ["📍 Region", opts(d => d.region)], kind: ["Category", opts(d => d.category)], type: ["Type", opts(d => d.object_type)], era: ["Era", opts(d => d.era)], material: ["Material", opts(d => matKey(d.material))], conf: ["Confidence", opts(d => confKey(d.confidence))] };
    const chipsHtml = () => `${Object.keys(F).filter(k => dState[k]).map(k => `<button type="button" class="fchip" data-clear="${k}" aria-label="Remove filter ${esc(F[k][0])}: ${esc(label(k, dState[k]))}">${esc(F[k][0].replace(/^📍 /, ""))}: ${esc(label(k, dState[k]))} ✕</button>`).join("")}${dState.q ? `<button type="button" class="fchip" data-clear="q">“${esc(dState.q)}” ✕</button>` : ""}${Object.keys(F).some(k => dState[k]) || dState.q ? '<button type="button" class="btn ghost" data-clear="all">Clear all</button>' : ""}`;
    const label = (k, v) => k === "kind" ? (App.KINDS[v] || {}).label || v : v;
    host.innerHTML = `<div class="disc-tools"><label class="field disc-q"><span class="sr-only">Search public finds</span><input type="search" id="dQ" placeholder="Search: type, material, features, ID…" value="${esc(dState.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="disc-filters">${Object.entries(F).map(([k, [l, vs]]) => `<label class="field"><span>${l}</span><select data-f="${k}"><option value="">All</option>${vs.map(v => `<option value="${esc(v)}" ${dState[k] === v ? "selected" : ""}>${esc(label(k, v))}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="chips" aria-label="Active filters">${chipsHtml()}</div></div>
      <p class="help disc-count" role="status"></p><div class="disc-grid" id="dGrid"></div><div class="disc-more"></div>`;
    const grid = $("#dGrid"), more = $(".disc-more", host);
    const match = d => { const t = [d.catalog_id, d.object_type, d.material, d.key_features, d.suggestion_1, d.suggestion_2, d.suggestion_3, d.region, d.era].join(" ").toLowerCase();
      return (!dState.q || dState.q.toLowerCase().split(/\s+/).every(w => t.includes(w))) && (!dState.region || d.region === dState.region) && (!dState.kind || d.category === dState.kind) && (!dState.type || d.object_type === dState.type) && (!dState.era || d.era === dState.era) && (!dState.material || matKey(d.material) === dState.material) && (!dState.conf || confKey(d.confidence) === dState.conf); };
    const paint = () => { const res = dData.filter(match), shown = res.slice(0, dState.page * PAGE);
      $(".disc-count", host).textContent = `${res.length} public find${res.length === 1 ? "" : "s"} · ${dSrc}. Locations are shown as county / general area only.`;
      grid.innerHTML = shown.map(d => `<a class="dcard" href="${d.public_id ? "#/p/" + esc(d.public_id) : "#/find/" + esc(d.catalog_id)}">${d.thumb ? `<img src="${esc(d.thumb)}" alt="" loading="lazy" decoding="async" width="320" height="240">` : '<span class="dc-ph" aria-hidden="true">◆</span>'}
        <span class="dc-b"><span class="dc-id">${esc(d.catalog_id)}${d.verified ? ' <span class="vbadge">✓ Verified</span>' : ""}</span><strong class="dc-t">${esc(d.object_type || "Find")}</strong>
        <span class="dc-m">📍 ${esc(d.region)} · ${esc(d.era || "Undetermined")}</span><span class="dc-m">${esc(d.material || "Material not recorded")}${d.length_mm ? ` · L ${esc(d.length_mm)} mm ${badge(srcOf(d, "length_mm"))}` : ""}</span>
        ${d.suggestion_1 ? `<span class="dc-s">Possibly: ${esc(String(d.suggestion_1).replace(/\s*\(.*$/, ""))} <span class="chip">${esc(confKey(d.confidence))}</span></span>` : ""}</span></a>`).join("") || '<p class="empty">No public finds match. Try removing a filter.</p>';
      more.innerHTML = res.length > shown.length ? `<button type="button" class="btn" id="dMore">Show more (${res.length - shown.length} left)</button>` : "";
      const b = $("#dMore"); if (b) b.onclick = () => { dState.page++; paint(); }; };
    paint();
    let t; $("#dQ").oninput = e => { clearTimeout(t); t = setTimeout(() => { dState.q = e.target.value.trim(); dState.page = 1; paint(); syncChips(); }, 150); };
    $$("[data-f]", host).forEach(s => s.onchange = () => { dState[s.dataset.f] = s.value; dState.page = 1; renderDiscover(); });
    $$("[data-clear]", host).forEach(b => b.onclick = () => { const k = b.dataset.clear; if (k === "all") dState = { q: "", region: "", kind: "", type: "", era: "", material: "", conf: "", page: 1 }; else dState[k] = ""; dState.page = 1; renderDiscover(); });
    function syncChips() { const c = $(".chips", host); c.innerHTML = chipsHtml(); $$("[data-clear]", c).forEach(b => b.onclick = () => { const k = b.dataset.clear; if (k === "all") dState = { q: "", region: "", kind: "", type: "", era: "", material: "", conf: "", page: 1 }; else dState[k] = ""; dState.page = 1; renderDiscover(); }); } }

  /* ---------- hooks ---------- */
  function decorate(i, r, body) { const panel = $("[role=tabpanel]", body); if (!panel) return;
    if (i === 0) { const h = document.createElement("div"); h.className = "s2-comments"; panel.appendChild(h); renderComments(h, r); }
    if (i === 1) { const kv = $(".kv", panel); const box = document.createElement("div"); box.className = "s2-dims"; box.innerHTML = `<h3 class="gal-h">Dimensions & source</h3>${dimsHtml(r)}<p class="help legend-src">${Object.values(SRC).map(([ic, t, d]) => `${badge(Object.keys(SRC).find(k => SRC[k][1] === t))} ${esc(d)}`).join(" · ")}</p>${fieldNotesHtml(r)}`;
      kv ? kv.before(box) : panel.prepend(box); }
    if (i === 2) { const h = document.createElement("div"); h.innerHTML = nextPhotosHtml(r); const np = h.firstElementChild; const sim = $(".s1-an", panel); sim ? sim.after(np) : panel.prepend(np); wireNext(np, r); }
    if (i === 3) { const f = $("#reviewForm"); if (!f) return; enhanceDims(f, r, () => App.pics(r).map(p => ({ src: p.src, label: p.label, view: p.view })));
      const own = [...f.querySelectorAll("h3")].find(h => /owner review/i.test(h.textContent)); const fn = document.createElement("div"); fn.innerHTML = fieldNotesForm(r); (own || f.querySelector(".wiz-nav")).before(fn.firstElementChild); } }
  async function afterPublic(id) { const host = $("#publicFind"), r = App.all.find(x => x.catalog_id === id); if (!host || !r || !$(".pub", host)) return;
    const sum = $(".pub-sum dl", host); if (sum) { const dd = [...sum.querySelectorAll("dt")].find(d => /size/i.test(d.textContent)); if (dd) { dd.textContent = "Dimensions"; dd.nextElementSibling.innerHTML = dimsHtml(r, true); } }
    const fn = fieldNotesHtml(r); if (fn) $(".pub-sum", host).insertAdjacentHTML("beforeend", fn);
    const c = document.createElement("div"); c.className = "pub-comments no-print"; $(".pub-foot", host).before(c); renderComments(c, r); }
  function wizard() { const f = $("#wizard"); if (!f) return; const step = f.querySelector("[data-step='2']");
    enhanceDims(f, null, () => $$("#wizard img").map((im, i) => ({ src: im.src, label: im.alt || "photo " + (i + 1), view: im.dataset.view || "" })).filter(p => p.src));
    const desc = f.querySelector("[data-step='3']"); if (desc && !desc.querySelector(".field-notes")) { const d = document.createElement("div"); d.innerHTML = fieldNotesForm({}); desc.appendChild(d.firstElementChild); } }
  function render(view) { if (view === "discover") { dData = null; renderDiscover(); } }
  function reset() { dData = null; }
  window.S2 = { render, decorate, afterPublic, renderComments, dimsHtml, srcOf, sizeTag, badge, rulerHelper, nextPhotosHtml, wizard, reset, SAFE };
  if (document.readyState !== "loading") wizard(); else document.addEventListener("DOMContentLoaded", wizard);
})();
