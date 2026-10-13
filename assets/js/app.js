/* Elgin Catalog — static app. Seed data: data/catalog.json. User additions/edits: IndexedDB (browser only). */
(() => {
  "use strict";
  const COLS = ["catalog_id","category","material","color","length_mm","width_mm","thickness_mm","weight_g","measure_method","condition","key_features","suggestion_1","suggestion_2","suggestion_3","confidence","owner_observations","open_questions","date_found","context_notes","location_sharing","status"];
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

  function merge() {
    const m = new Map(seed.map(r => [r.catalog_id, { ...r, _src: "seed" }]));
    local.forEach(r => m.set(r.catalog_id, { ...(m.get(r.catalog_id) || {}), ...r, _src: m.has(r.catalog_id) ? "edited" : "local" }));
    all = [...m.values()].sort((a, b) => a.catalog_id.localeCompare(b.catalog_id, undefined, { numeric: true }));
  }
  const nextId = () => "ELG-" + String(Math.max(0, ...all.map(r => +((/ELG-(\d+)/.exec(r.catalog_id) || [])[1] || 0))) + 1).padStart(3, "0");

  /* ---------- helpers ---------- */
  function confScore(c = "") { c = c.toLowerCase();
    if (c.includes("high")) return 90; if (c.startsWith("moderate-low") || c.startsWith("low-moderate") || c.startsWith("low to moderate")) return 45;
    if (c.startsWith("moderate")) return 65; if (c.startsWith("low")) return 25; return 0; }
  const confBucket = c => { const s = confScore(c); return s >= 80 ? "high" : s >= 45 ? "moderate" : s > 0 ? "low" : ""; };
  const isMeasured = r => /^measured/i.test(r.measure_method || "") && r.length_mm;
  const size = r => { const p = [["L", r.length_mm], ["W", r.width_mm], ["T", r.thickness_mm]].filter(x => x[1]);
    return p.length ? p.map(x => `${x[0]} ${esc(x[1])}`).join(" × ") + " mm" : "<em>not measured</em>"; };
  const suggestions = r => [r.suggestion_1, r.suggestion_2, r.suggestion_3].filter(Boolean);
  const meter = c => `<div class="meter" aria-label="Confidence: ${esc(c || "not set")}"><span>Confidence</span><span class="bar"><i style="width:${confScore(c)}%"></i></span><span class="chip">${esc(c || "—")}</span></div>`;

  /* ---------- catalog view ---------- */
  function renderStats() {
    const s = [["Total finds", all.length], ["Reviewed", all.filter(r => r.status === "Reviewed").length], ["Drafts", all.filter(r => r.status !== "Reviewed").length], ["Measured", all.filter(isMeasured).length]];
    $("#stats").innerHTML = s.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    const cats = [...new Set(all.map(r => r.category).filter(Boolean))].sort(), fc = $("#fCat"), v = fc.value;
    fc.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join(""); fc.value = v;
    $("#catList").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  }
  function filtered() {
    const q = $("#q").value.trim().toLowerCase(), st = $("#fStatus").value, ca = $("#fCat").value, co = $("#fConf").value;
    return all.filter(r => (!st || (r.status || "Draft") === st) && (!ca || r.category === ca) && (!co || confBucket(r.confidence) === co)
      && (!q || COLS.some(c => String(r[c] || "").toLowerCase().includes(q))));
  }
  function renderGrid() {
    const rows = filtered();
    $("#count").textContent = `Showing ${rows.length} of ${all.length} finds`;
    $("#grid").innerHTML = rows.length ? rows.map(r => `
      <button class="card" data-id="${esc(r.catalog_id)}" aria-label="Open ${esc(r.catalog_id)} ${esc(r.category)}">
        <div class="card-top"><span class="cid">${esc(r.catalog_id)}</span><span class="badge ${r.status === "Reviewed" ? "Reviewed" : "Draft"}">${esc(r.status || "Draft")}</span></div>
        <h3>${esc(r.category || "Uncategorized")}</h3>
        <div class="meta">${esc(r.material)}${r.color ? " · " + esc(r.color) : ""}</div>
        <div class="meta">Size: ${size(r)}${r.measure_method ? ` <span class="chip">${esc(r.measure_method)}</span>` : ""}</div>
        ${suggestions(r).length ? `<ol>${suggestions(r).map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        ${meter(r.confidence)}
        ${r.open_questions ? `<div class="oq"><strong>Open:</strong> ${esc(r.open_questions)}</div>` : ""}
        ${r._src !== "seed" ? `<span class="local">● ${r._src === "local" ? "Added in this browser" : "Edited in this browser"}</span>` : ""}
      </button>`).join("") : '<p class="empty">No finds match these filters.</p>';
  }
  const refresh = () => { merge(); renderStats(); renderGrid(); };

  /* ---------- detail modal ---------- */
  let current = null, lastFocus = null, tab = 0;
  function openModal(id) {
    current = all.find(r => r.catalog_id === id); if (!current) return;
    lastFocus = document.activeElement; $("#mId").textContent = current.catalog_id; $("#mTitle").textContent = current.category || "Find";
    $("#modal").hidden = false; document.body.style.overflow = "hidden"; selectTab(0); $("#tab-0").focus();
  }
  function closeModal() { $("#modal").hidden = true; document.body.style.overflow = ""; current = null; lastFocus && lastFocus.focus(); }
  function selectTab(i) {
    tab = i; $$(".tabs [role=tab]").forEach((b, j) => { b.setAttribute("aria-selected", j === i); b.tabIndex = j === i ? 0 : -1; });
    const r = current, kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd>`).join("")}</dl>`;
    const photos = (r.photos || []).length ? `<div class="photos">${r.photos.map(p => `<figure><img src="${p.src}" alt="${esc(r.catalog_id)} ${esc(p.tag)} view"><figcaption>${esc(p.tag)}</figcaption></figure>`).join("")}</div>` : `<p class="help">No photos stored in this browser for this find.</p>`;
    const html = [
      () => kv([["Status", `<span class="badge ${r.status === "Reviewed" ? "Reviewed" : "Draft"}">${esc(r.status || "Draft")}</span>`], ["Material", esc(r.material)], ["Color", esc(r.color)], ["Condition", esc(r.condition)], ["Key features", esc(r.key_features)], ["Context", esc(r.context_notes)], ["Date found", esc(r.date_found)], ["Location sharing", esc(r.location_sharing || "Private")], ["🔒 Private location", r[PRIVATE] ? esc(r[PRIVATE]) + ' <span class="chip">owner only</span>' : ""]]) + photos,
      () => kv([["Method", esc(r.measure_method)], ["Length", r.length_mm ? esc(r.length_mm) + " mm" : ""], ["Width", r.width_mm ? esc(r.width_mm) + " mm" : ""], ["Thickness", r.thickness_mm ? esc(r.thickness_mm) + " mm" : ""], ["Weight", r.weight_g ? esc(r.weight_g) + " g" : ""]]) + (isMeasured(r) ? "" : '<p class="tip">📏 Not yet measured with a ruler or caliper. A flat ruler reading and weight would raise confidence.</p>'),
      () => `<p class="help">Research possibilities, not identifications. No authenticity or value claims.</p>${suggestions(r).length ? `<ol class="rank">${suggestions(r).map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : "<p>No suggestions recorded.</p>"}${meter(r.confidence)}${r.open_questions ? `<p class="oq" style="margin-top:12px"><strong>What would help:</strong> ${esc(r.open_questions)}</p>` : ""}`,
      () => `<form id="reviewForm"><label class="field"><span>Owner observations &amp; corrections</span><textarea name="owner_observations" rows="4">${esc(r.owner_observations)}</textarea></label>
        <div class="row"><label class="field"><span>Status</span><select name="status"><option ${r.status !== "Reviewed" ? "selected" : ""}>Draft</option><option ${r.status === "Reviewed" ? "selected" : ""}>Reviewed</option></select></label>
        <label class="field grow"><span>🔒 Private location (owner only, kept in this browser)</span><input name="${PRIVATE}" value="${esc(r[PRIVATE])}"></label></div>
        <div class="wiz-nav">${r._src !== "seed" ? '<button type="button" class="btn" id="revert">' + (r._src === "local" ? "Delete find" : "Revert my edits") + "</button>" : ""}<span class="grow"></span><button class="btn primary">Save review</button></div></form>`
    ][i]();
    $("#mBody").innerHTML = `<div role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}" tabindex="0">${html}</div>`;
    const f = $("#reviewForm"); if (f) {
      f.onsubmit = async e => { e.preventDefault(); const o = { ...(local.find(x => x.catalog_id === r.catalog_id) || { catalog_id: r.catalog_id }) };
        new FormData(f).forEach((v, k) => o[k] = v); await DB.put(o); local = await DB.all(); const id = r.catalog_id; refresh(); current = all.find(x => x.catalog_id === id); selectTab(3); toast("Review saved"); };
      const rv = $("#revert"); if (rv) rv.onclick = async () => { if (!confirm(rv.textContent + "?")) return; await DB.del(r.catalog_id); local = await DB.all(); refresh(); closeModal(); };
    }
  }
  $(".tabs").addEventListener("click", e => { const b = e.target.closest("[role=tab]"); if (b) selectTab(+b.id.split("-")[1]); });
  $(".tabs").addEventListener("keydown", e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { const n = (tab + d + 4) % 4; selectTab(n); $("#tab-" + n).focus(); } });
  $("#mClose").onclick = closeModal; $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if ($("#modal").hidden) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") { const f = $$("#modal button, #modal input, #modal select, #modal textarea, #modal [tabindex='0']").filter(x => x.offsetParent); const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } });
  $("#grid").addEventListener("click", e => { const c = e.target.closest(".card"); if (c) openModal(c.dataset.id); });

  /* ---------- print ---------- */
  $("#printBtn").onclick = () => { const r = current, rows = [["Category", r.category], ["Material", r.material], ["Color", r.color], ["Condition", r.condition], ["Size", size(r).replace(/<[^>]+>/g, "")], ["Method", r.measure_method], ["Weight", r.weight_g && r.weight_g + " g"], ["Key features", r.key_features], ["Possibilities", suggestions(r).map((s, i) => `${i + 1}. ${s}`).join("<br>")], ["Confidence", r.confidence], ["Owner observations", r.owner_observations], ["Open questions", r.open_questions], ["Status", r.status]];
    $("#printArea").innerHTML = `<div class="pc"><h1>${esc(r.catalog_id)} — ${esc(r.category)}</h1><p>Elgin Catalog · Rolling Oak finds · printed ${new Date().toLocaleDateString()}</p><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${k === "Possibilities" ? v : esc(v || "—")}</td></tr>`).join("")}</table>${(r.photos || []).map(p => `<img src="${p.src}" alt="">`).join("")}<p class="disc">Possibilities are research suggestions, not identifications. No authenticity or value claims. Exact location omitted.</p></div>`;
    window.print(); };

  /* ---------- export ---------- */
  function exportRows() { const inc = $("#inclPrivate").checked; if (inc && !confirm("Include exact private location in this export? Only do this for your own backup.")) return null;
    return { inc, rows: filtered().map(r => { const o = {}; COLS.forEach(c => o[c] = r[c] ?? ""); if (inc) o[PRIVATE] = r[PRIVATE] ?? ""; return o; }) }; }
  function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  const cq = v => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  $("#exportCsv").onclick = () => { const x = exportRows(); if (!x) return; const c = x.inc ? [...COLS, PRIVATE] : COLS; download("elgin_catalog.csv", [c.join(","), ...x.rows.map(r => c.map(k => cq(r[k])).join(","))].join("\n"), "text/csv"); };
  $("#exportJson").onclick = () => { const x = exportRows(); if (x) download("elgin_catalog.json", JSON.stringify(x.rows, null, 2), "application/json"); };

  /* ---------- wizard ---------- */
  const STEPS = ["Photos", "Measurements", "Description", "AI analysis", "Review & save"];
  let step = 0, photos = [];
  $("#steps").innerHTML = STEPS.map(s => `<li>${s}</li>`).join("");
  function stripExif(file) { // re-encode through canvas: drops all EXIF/GPS metadata
    return new Promise((res, rej) => { const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.85)); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Unreadable image")); }; img.src = url; }); }
  $("#pFile").addEventListener("change", async e => { const tag = $("#pTag").value;
    for (const f of e.target.files) { try { photos.push({ name: f.name, tag, src: await stripExif(f) }); } catch { toast("Could not read " + f.name); } }
    e.target.value = ""; drawThumbs(); if (photos.length) $("[data-err=photos]").textContent = ""; });
  function drawThumbs() {
    $("#thumbs").innerHTML = photos.map((p, i) => `<div class="thumb"><img src="${p.src}" alt="Photo ${i + 1}, ${esc(p.tag)} view"><label><span class="sr-only">View tag for photo ${i + 1}</span><select data-i="${i}">${["front", "back", "edge", "base", "scale"].map(t => `<option ${t === p.tag ? "selected" : ""}>${t}</option>`).join("")}</select></label><button type="button" data-rm="${i}">Remove</button></div>`).join("") || '<p class="help">No photos yet.</p>';
  }
  $("#thumbs").addEventListener("change", e => { if (e.target.dataset.i) photos[e.target.dataset.i].tag = e.target.value; });
  $("#thumbs").addEventListener("click", e => { if (e.target.dataset.rm) { photos.splice(+e.target.dataset.rm, 1); drawThumbs(); } });
  const F = () => $("#wizard").elements;
  function validate(i) {
    const err = (k, m) => { const el = $(`[data-err=${k}]`); el.textContent = m; return !m; };
    if (i === 0) return err("photos", photos.length ? "" : "Add at least one photo (with a scale in view).");
    if (i === 1) { const m = F().measure_method.value, nums = ["length_mm", "width_mm", "thickness_mm", "weight_g"].map(n => F()[n]);
      const bad = nums.find(n => n.value && !/^\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?$/.test(n.value.trim()));
      if (bad) { bad.focus(); return err("measure", "Use numbers (e.g. 62 or 60-70)."); }
      if (m !== "Not measured" && !F().length_mm.value) { F().length_mm.focus(); return err("measure", "Enter at least a length, or choose “Not measured”."); }
      return err("measure", ""); }
    if (i === 2) { for (const n of ["category", "material"]) if (!F()[n].value.trim()) { F()[n].focus(); return err("desc", "Category and material are required."); }
      if (F().public_land.checked) return err("desc", "Finds from public land can’t be catalogued here. Collecting on public land is restricted or illegal.");
      if (!F().landowner_permission.checked) return err("desc", "Please confirm landowner permission.");
      return err("desc", ""); }
    return true;
  }
  function collect() { const o = { catalog_id: nextId(), photos }; for (const el of F()) if (el.name && el.type !== "radio" && el.type !== "checkbox") o[el.name] = el.value.trim();
    o.measure_method = F().measure_method.value; o.landowner_permission = F().landowner_permission.checked ? "Yes" : "No"; return o; }
  function showStep(i) {
    step = i; $$(".step").forEach((s, j) => s.hidden = j !== i);
    $$("#steps li").forEach((li, j) => { li.className = j < i ? "done" : j === i ? "cur" : ""; j === i ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"); });
    $("#prev").disabled = i === 0; $("#next").hidden = i === 4; $("#save").hidden = i !== 4;
    if (i === 4) { const o = collect(); $("#summary").innerHTML = `<strong>${o.catalog_id}</strong> · ${esc(o.category)} · ${esc(o.material)}<br>${photos.length} photo(s), EXIF stripped · ${size(o)} (${esc(o.measure_method)})<br>Possibilities: ${esc(suggestions(o).join(" / ") || "none")} · Confidence: ${esc(o.confidence)}<br>🔒 Location: ${o[PRIVATE] ? "recorded, private" : "not recorded"} · Sharing: ${esc(o.location_sharing)}`; }
  }
  $("#next").onclick = () => { if (validate(step)) { showStep(step + 1); $(".step:not([hidden]) legend").scrollIntoView({ block: "nearest" }); } };
  $("#prev").onclick = () => showStep(Math.max(0, step - 1));
  $("#wizard").onsubmit = async e => { e.preventDefault(); for (let i = 0; i < 4; i++) if (!validate(i)) return showStep(i);
    const o = collect(); try { await DB.put(o); } catch (err) { return toast("Could not save: " + err.message); }
    local = await DB.all(); refresh(); resetWizard(); toast(o.catalog_id + " saved"); location.hash = "#/catalog"; openModal(o.catalog_id); };
  function resetWizard() { $("#wizard").reset(); photos = []; drawThumbs(); $$(".err").forEach(e => e.textContent = ""); showStep(0); }

  /* ---------- routing, theme, toast ---------- */
  function route() { const v = (location.hash.match(/^#\/(\w+)/) || [, "catalog"])[1], view = ["catalog", "add", "about"].includes(v) ? v : "catalog";
    $$(".view").forEach(s => s.hidden = s.id !== "view-" + view);
    $$("nav a").forEach(a => a.dataset.route === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    if (view === "add") $("#newId").textContent = "New ID: " + nextId();
    document.title = { catalog: "Catalog", add: "Add find", about: "About & methods" }[view] + " — Elgin Catalog"; }
  window.addEventListener("hashchange", () => { route(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); });
  function setTheme(t) { document.documentElement.dataset.theme = t; $("#themeToggle").setAttribute("aria-pressed", t === "dark"); $("#themeToggle").textContent = t === "dark" ? "☀" : "☾"; try { localStorage.setItem("elgin-theme", t); } catch {} }
  $("#themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  function toast(m) { const t = document.createElement("div"); t.textContent = m; t.setAttribute("role", "status");
    Object.assign(t.style, { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", background: "var(--ink)", color: "var(--bg)", padding: "10px 16px", borderRadius: "8px", zIndex: 99 });
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
  ["#q", "#fStatus", "#fCat", "#fConf"].forEach(s => $(s).addEventListener("input", renderGrid));

  /* ---------- boot ---------- */
  (async () => {
    let saved; try { saved = localStorage.getItem("elgin-theme"); } catch {}
    setTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    route(); drawThumbs(); showStep(0);
    try { const r = await fetch("data/catalog.json", { cache: "no-cache" }); seed = (await r.json()).map(({ [PRIVATE]: _, ...x }) => x); }
    catch { $("#count").textContent = "Could not load data/catalog.json. Serve the folder over HTTP (see README)."; }
    try { await DB.open(); local = await DB.all(); } catch { toast("IndexedDB unavailable: additions won’t be saved."); }
    refresh(); route();
    const m = location.hash.match(/^#\/find\/(ELG-\d+)/); if (m) { location.hash = "#/catalog"; openModal(m[1]); }
  })();
})();
