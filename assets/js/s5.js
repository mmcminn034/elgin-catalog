/* Rolling Oak S5: status progression (Draft → Needs review → Reviewed → Verified), per-find Discover toggle + bulk select,
   clearer measurement sources (incl. "From ruler in photo #N"). Additive: existing values, keys and panels keep working.
   Privacy: Discover shows county / general area only; exact locations are never read or shown here. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const C = window.ROLLING_OAK_CLOUD || {};

  /* ---------- status ---------- */
  const LIST = ["Draft", "Needs review", "Reviewed", "Verified"];
  const LABEL = { "Draft": "Draft", "Needs review": "Needs review", "Reviewed": "Reviewed", "Verified": "Verified (reference)" };
  const norm = s => LIST.find(x => x.toLowerCase() === String(s || "").trim().toLowerCase()) || (s ? String(s) : "Draft");
  const needs = r => ["Draft", "Needs review"].includes(norm(r && r.status));
  const done = r => ["Reviewed", "Verified"].includes(norm(r && r.status));
  const cls = s => ({ "Draft": "Draft", "Needs review": "NeedsReview", "Reviewed": "Reviewed", "Verified": "Verified" }[norm(s)] || "Draft");
  const badge = r => `<span class="badge ${cls(r.status)}">${esc(norm(r.status))}</span>`;
  const options = cur => LIST.map(s => `<option value="${s}" ${norm(cur) === s ? "selected" : ""}>${esc(LABEL[s])}</option>`).join("");
  const canEdit = () => { const s = window.Cloud ? Cloud.state() : { user: null }; if (!s.user) return !s.online; return window.Features && Features.isEditor ? Features.isEditor() : false; };
  async function setStatus(r, s, why) { await App.patch(r.catalog_id, { status: s, status_ts: new Date().toISOString() }); App.toast(`${r.catalog_id}: ${LABEL[s]}${why ? " · " + why : ""}`); }
  /* Draft finds auto-advance to Reviewed when the owner confirms something (Save review, Keep). Needs review is a deliberate flag, also advanced. */
  const autoAdvance = r => needs(r) ? "Reviewed" : null;
  function statusBar(r) {
    return `<div class="s5-status" data-s5-bar><span class="s5-st-l">Status</span> ${badge(r)}${needs(r) ? ' <span class="needs-flag">⚑ Still needs review</span>' : ""}
      ${canEdit() ? `<span class="grow"></span>${needs(r) ? `<button type="button" class="btn primary s5-mark" data-s5-status="Reviewed">✓ Mark as Reviewed</button>` : ""}
      ${norm(r.status) === "Draft" ? `<button type="button" class="btn small" data-s5-status="Needs review">⚑ Flag: needs review</button>` : ""}
      ${done(r) && norm(r.status) !== "Verified" ? `<button type="button" class="btn small" data-s5-status="Verified" title="Use this find as a verified reference example">★ Mark Verified (reference)</button>` : ""}
      ${done(r) ? `<button type="button" class="btn ghost small" data-s5-status="Draft">Back to Draft</button>` : ""}` : ""}</div>`;
  }

  /* ---------- Discover (per find + bulk) ---------- */
  const area = r => (window.Learn && Learn.regionOf ? Learn.regionOf(r) : r.region) || "General area not set";
  const onDisc = r => !!r.show_on_discover && (r.visibility || (r.is_public === false ? "editors" : "public")) === "public";
  async function setDiscover(ids, on) {
    for (const id of ids) { const r = App.all.find(x => x.catalog_id === id) || {}, cur = r.visibility || (r.is_public === false ? "editors" : "public");
      // remember the visibility it had before, so hiding it again restores that (e.g. back to 🔒 Private)
      const back = r.vis_before_discover || cur, patch = on ? { show_on_discover: true, visibility: "public", is_public: true, vis_before_discover: r.show_on_discover ? r.vis_before_discover || cur : cur } : { show_on_discover: false, visibility: back, is_public: back === "public", vis_before_discover: "" };
      await App.patch(id, patch); if (window.Cloud && Cloud.setDiscover) await Cloud.setDiscover(id, on); if (!on && window.Cloud && Cloud.setFindVisibility) await Cloud.setFindVisibility(id, back); }
    App.toast(`${ids.length} find${ids.length === 1 ? "" : "s"} ${on ? "shown on Discover (general area only)" : "hidden from Discover"}`); if (window.S2 && S2.reset) S2.reset(); }
  function discToggle(r) { if (!canEdit()) return "";
    return `<label class="s5-disc check"><input type="checkbox" data-s5-disc ${onDisc(r) ? "checked" : ""}> <strong>🌐 Show on Discover (public)</strong>
      <span class="help">Shows type, photos and <strong>general area only: ${esc(area(r))}</strong>. Exact location is never shared.</span></label>`; }
  function bulkDialog() { let d = $("#s5Bulk"); if (!d) { d = document.createElement("dialog"); d.id = "s5Bulk"; d.setAttribute("aria-labelledby", "s5BulkH"); document.body.appendChild(d); }
    const rows = App.all.slice().sort((a, b) => a.catalog_id.localeCompare(b.catalog_id));
    d.innerHTML = `<div class="auth-card s5-bulk"><div class="modal-head"><h2 id="s5BulkH">🌐 Show on Discover</h2><button type="button" class="btn ghost icon" data-x aria-label="Close">✕</button></div>
      <p class="help">Pick finds to show publicly on Discover. Only the general area (county / state) is shown, never an exact location. Private notes and the 🔒 location stay private.</p>
      <div class="row"><button type="button" class="btn small" data-all="1">Select all</button><button type="button" class="btn small" data-all="0">Select none</button><span class="help s5-n" role="status"></span></div>
      <ul class="s5-bl">${rows.map(r => `<li><label class="check"><input type="checkbox" value="${esc(r.catalog_id)}" ${onDisc(r) ? "checked" : ""}> <strong>${esc(r.catalog_id)}</strong> ${esc(r.object_type || "")} <span class="muted">· 📍 ${esc(area(r))}</span>${onDisc(r) ? ' <span class="chip ok">on Discover</span>' : ""}</label></li>`).join("")}</ul>
      <div class="row"><span class="grow"></span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-apply>Save Discover choices</button></div></div>`;
    const cnt = () => $(".s5-n", d).textContent = `${$$("input:checked", d).length} selected`; cnt();
    d.onchange = cnt; d.onclick = async e => { if (e.target.closest("[data-x]")) return d.close(); const a = e.target.closest("[data-all]"); if (a) { $$(".s5-bl input", d).forEach(i => i.checked = a.dataset.all === "1"); cnt(); }
      if (e.target.closest("[data-apply]")) { const want = new Set($$(".s5-bl input:checked", d).map(i => i.value)); const on = rows.filter(r => want.has(r.catalog_id) && !onDisc(r)).map(r => r.catalog_id), off = rows.filter(r => !want.has(r.catalog_id) && onDisc(r)).map(r => r.catalog_id);
        if (on.length) await setDiscover(on, true); if (off.length) await setDiscover(off, false); if (!on.length && !off.length) App.toast("No changes"); d.close(); } };
    d.showModal(); }
  function toolbar() { const ex = $("#s5BulkBtn"); if (ex) { ex.hidden = !canEdit(); return; } const host = $("#fStatus") && $("#fStatus").closest(".filters, .toolbar, form, div"); if (!host) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "btn small"; b.id = "s5BulkBtn"; b.textContent = "🌐 Discover…"; b.title = "Choose which finds show on Discover (general area only)";
    b.hidden = !canEdit(); b.onclick = bulkDialog; host.appendChild(b); if (window.Cloud && Cloud.on) Cloud.on(() => { b.hidden = !canEdit(); }); }

  /* ---------- measurements ---------- */
  const DIMS = [["length_mm", "length"], ["width_mm", "width"], ["thickness_mm", "thickness"], ["weight_g", "weight"]];
  const refsOf = r => { const v = r && r.measure_refs; if (!v) return {}; if (typeof v === "object") return v; try { return JSON.parse(v) || {}; } catch { return {}; } };
  function enhanceForm(f, r) { if (!f || f.dataset.s5) return; f.dataset.s5 = "1"; const n = App.pics(r).length, refs = refsOf(r);
    const hid = document.createElement("input"); hid.type = "hidden"; hid.name = "measure_refs"; hid.value = JSON.stringify(refs); f.appendChild(hid);
    const first = f.querySelector("[name=length_mm]"); if (first) first.closest(".row").insertAdjacentHTML("beforebegin", `<p class="help s5-mhelp">Enter <strong>Length, Width, Thickness in mm</strong> and <strong>Weight in g</strong>. For each one pick where the number came from: <span class="msrc msrc-measured">📏 Measured</span> (calipers or a ruler on the piece) or <span class="msrc msrc-photo_estimate">📷 Photo estimate</span> / <span class="msrc msrc-ruler">📐 From ruler in photo #N</span>. Approximate values like ~51 are fine.</p>`);
    DIMS.forEach(([k, d]) => { const s = f.querySelector(`[name=${d}_source]`), lab = s && s.closest("label"); if (!s) return;
      const meas = s.querySelector("option[value=measured]"); if (meas) meas.textContent = "📏 Measured (calipers or ruler)";
      for (let i = 1; i <= n; i++) s.insertAdjacentHTML("beforeend", `<option value="ruler:${i}">📐 From ruler in photo #${i}</option>`);
      if (refs[d] && s.querySelector(`option[value="ruler:${refs[d]}"]`)) s.value = `ruler:${refs[d]}`;
      const paint = () => { const v = s.value; lab.dataset.src = /^ruler:/.test(v) ? "ruler" : v || "none"; }; paint(); s.addEventListener("change", paint);
      s.addEventListener("change", () => { const mm = f.querySelector("[name=measure_method]"), i = f.querySelector(`[name=${k}]`); if (s.value === "measured" && mm && i && i.value.trim()) { if (!$$("option", mm).some(o => o.value === "Measured")) mm.insertAdjacentHTML("beforeend", "<option>Measured</option>"); mm.value = "Measured"; } }); });
    f.addEventListener("submit", () => { // runs before the app's handler: map ruler:N -> photo_estimate + ref, and Measured values -> measure_method=Measured
      const out = {}; let measured = false;
      DIMS.forEach(([k, d]) => { const s = f.querySelector(`[name=${d}_source]`), i = f.querySelector(`[name=${k}]`); if (!s) return; const m = /^ruler:(\d+)$/.exec(s.value);
        if (m) { out[d] = +m[1]; const o = s.querySelector("option[value=photo_estimate]"); s.value = "photo_estimate"; if (!o) s.insertAdjacentHTML("beforeend", '<option value="photo_estimate" selected>photo</option>'); }
        if (s.value === "measured" && i && i.value.trim()) measured = true; });
      hid.value = Object.keys(out).length ? JSON.stringify(out) : "";
      const mm = f.querySelector("[name=measure_method]"); if (measured && mm) { if (!$$("option", mm).some(o => o.value === "Measured")) mm.insertAdjacentHTML("beforeend", "<option>Measured</option>"); mm.value = "Measured"; } }, true);
  }
  function rulerChips(panel, r) { const refs = refsOf(r); $$(".s2-dims .dim", panel).forEach(el => { const t = (el.querySelector("dt") || {}).textContent || "", d = t.trim().toLowerCase();
      if (refs[d]) el.querySelector("dd").insertAdjacentHTML("beforeend", ` <span class="msrc msrc-ruler">📐 ruler in photo #${refs[d]}</span>`); }); }
  /* size missing or estimate-only => ask for a scaled photo */
  const estimateOnly = r => !(/^measured/i.test(r.measure_method || "") && r.length_mm);
  const scaledPhotoTip = r => estimateOnly(r) ? `<div class="s5-scale tip" role="note"><strong>📏 Next photo: a scaled shot.</strong> Lay a ruler <strong>flat beside the item</strong>, in the same plane, camera straight down, both ends of the piece and the ruler marks in frame. ${r.length_mm ? "Current size is an estimate only" : "No size recorded yet"}; this lets the 📐 ruler helper measure it, and calipers or a ruler on the piece make it 📏 Measured.</div>` : "";

  /* ---------- hooks ---------- */
  function decorate(i, r, body) { const panel = $("[role=tabpanel]", body); if (!panel) return;
    if (i === 0) { panel.insertAdjacentHTML("afterbegin", statusBar(r) + discToggle(r)); }
    if (i === 1) { rulerChips(panel, r); panel.insertAdjacentHTML("beforeend", scaledPhotoTip(r)); }
    if (i === 2) { const np = $(".np", panel); if (np) np.insertAdjacentHTML("afterbegin", scaledPhotoTip(r)); else panel.insertAdjacentHTML("afterbegin", scaledPhotoTip(r)); }
    if (i === 3) { const f = $("#reviewForm"); enhanceForm(f, r); const s = f && f.querySelector("select[name=status]"); if (s) s.addEventListener("change", () => s.dataset.touched = "1"); } }
  document.addEventListener("click", async e => { const b = e.target.closest("[data-s5-status]"); if (!b) return; const r = App.current;
    if (!r) return; await setStatus(r, b.dataset.s5Status); App.reselect && App.reselect(); });
  document.addEventListener("change", async e => { const c = e.target.closest("[data-s5-disc]"); if (!c) return; const r = App.current; if (!r) return;
    await setDiscover([r.catalog_id], c.checked); App.reselect && App.reselect(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", toolbar); else toolbar();
  window.S5 = { LIST, LABEL, norm, needs, done, cls, badge, options, statusBar, autoAdvance, setStatus, setDiscover, onDisc, bulkDialog, toolbar, enhanceForm, refsOf, scaledPhotoTip, estimateOnly, decorate };
})();
