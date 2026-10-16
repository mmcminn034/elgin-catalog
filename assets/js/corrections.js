/* Stage 4: field corrections -> verified library -> similar examples.
   Owners/editors can correct any suggested field (category, type, material, era/period, origin). Each correction is kept
   locally (ro-field-corrections) and, when signed in, written to public.corrections (private by default). Optionally the
   corrected record is saved as a verified reference, which feeds the similar-examples retrieval. Additive only.
   Research suggestions only; origin is coarse (region / setting), never coordinates. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = "ro-field-corrections";
  const coarse = t => { t = String(t || "").trim(); return t && !/\d+\.\d{2,}/.test(t) && !/^\s*\d+\s+\w/.test(t) && t.length <= 80 ? t : ""; };
  const st = () => (window.Cloud ? Cloud.state() : { user: null });
  const canEdit = () => { const s = st(); if (!s.user) return !s.online; return window.Features && Features.isEditor ? Features.isEditor() : false; };
  const kinds = () => Object.entries((window.App && App.KINDS) || {}).map(([k, v]) => [k, v.label]);
  const originOf = r => { if (r.origin_confirmed) return r.origin_confirmed; const o = window.Region && Region.likelyOrigin ? Region.likelyOrigin(r).items[0] : null; return o ? o.region : ""; };
  /* field -> how to read it, how to write it, and what to call it */
  const FIELDS = {
    category: { label: "Category", get: r => (window.App ? App.kindOf(r) : r.category), show: v => ((window.App && App.KINDS[v]) || {}).label || v, choices: kinds },
    type: { label: "Type (top suggestion)", get: r => String(r.suggestion_1 || r.object_type || "").trim(), key: "suggestion_1" },
    material: { label: "Material", get: r => r.material || "", key: "material" },
    era: { label: "Era / period", get: r => r.era || r.geologic_period || (window.App ? App.eraOf(r) : ""), key: "era" },
    origin: { label: "Likely origin", get: originOf, key: "origin_confirmed", coarse: true }
  };
  const sourceOf = (r, f) => (r.field_sources && r.field_sources[f]) || (f === "origin" ? (r.origin_confirmed || r.provenance_answer === "local" || r.provenance_answer === "collection" ? "owner" : "rules") : f === "category" ? (r.category_kept ? "owner" : "rules") : (r.ai_accepted_at && f === "type" ? "AI" : r.local_analysis ? "rules" : "owner"));
  const all = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
  const save = l => { try { localStorage.setItem(LS, JSON.stringify(l.slice(-2000))); } catch {} };
  /* accuracy per field: of the suggestions reviewed, how many were kept vs corrected (owner "keep" clicks count as kept) */
  function accuracy() { const m = {}; all().forEach(c => { const o = m[c.field] = m[c.field] || { kept: 0, corrected: 0 }; c.kept ? o.kept++ : o.corrected++; }); return m; }
  const accChip = f => { const a = accuracy()[f]; if (!a) return ""; const n = a.kept + a.corrected; return `<span class="acc-chip" title="Of ${n} reviewed suggestions for this field, ${a.kept} were kept">${Math.round(100 * a.kept / n)}% kept · n=${n}</span>`; };
  function html(r) {
    if (!r || !canEdit()) return "";
    const rows = Object.entries(FIELDS).map(([f, d]) => { const v = d.get(r); return `<li data-cf="${f}"><div class="cf-row"><span class="cf-k">${esc(d.label)}</span><span class="cf-v">${esc(d.show ? d.show(v) : v) || '<span class="muted">—</span>'}</span>
      <span class="cf-src src-${esc(sourceOf(r, f).toLowerCase())}">${esc(sourceOf(r, f))}</span>${accChip(f)}
      <span class="cf-act"><button type="button" class="btn small" data-corr="keep" data-f="${f}">✓ Keep</button> <button type="button" class="btn small" data-corr="open" data-f="${f}">✎ Correct this</button></span></div>
      <div class="cf-form" hidden><label class="field grow"><span>Correct ${esc(d.label.toLowerCase())}${d.coarse ? " (region or setting only: no coordinates, no address)" : ""}</span>${d.choices ? `<select data-cv>${d.choices().map(([k, l]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : `<input data-cv value="${esc(v)}">`}</label>
      <label class="field grow"><span>Why (optional)</span><input data-cr placeholder="e.g. caliper shows a ground stem"></label>
      <label class="switch"><input type="checkbox" data-cvref> <span>Also save as a verified reference</span></label>
      <button type="button" class="btn primary small" data-corr="save" data-f="${f}">Save correction</button></div></li>`; }).join("");
    return `<section class="corr" aria-label="Review suggestions"><h3 class="gal-h">🧭 Review suggestions <span class="muted">(your corrections teach the library)</span></h3>${window.S5 && S5.needs(r) ? `<p class="s5-panel-mark">${S5.badge(r)} <span class="help">Checked everything below?</span> <button type="button" class="btn primary small" data-s5-status="Reviewed">✓ Mark as Reviewed</button></p>` : ""}<ul class="cf-list">${rows}</ul>
      <p class="help">Corrections are private to your collection. “Verified reference” adds this find to the library used for similar examples. Research suggestions only.</p></section>`;
  }
  async function record(r, f, oldV, newV, reason, kept) {
    const row = { catalog_id: r.catalog_id, field: f, old_value: oldV || null, new_value: newV || null, reason: `[${kept ? "kept" : "corrected"}:${sourceOf(r, f)}] ${reason || ""}`.trim(), source: sourceOf(r, f), kept: !!kept, ts: new Date().toISOString() };
    const l = all(); l.push(row); save(l);
    if (window.Cloud && Cloud.addCorrection) { try { await Cloud.addCorrection(row); } catch {} }
    return row;
  }
  async function onClick(e, r) {
    const b = e.target.closest("[data-corr]"); if (!b || !r) return false; const f = b.dataset.f, d = FIELDS[f], li = b.closest("[data-cf]"), act = b.dataset.corr;
    if (act === "open") { const fm = $(".cf-form", li); fm.hidden = !fm.hidden; if (!fm.hidden) $("[data-cv]", fm).focus(); return true; }
    if (act === "keep") { await record(r, f, d.get(r), d.get(r), "", true); /* Keep records feedback only; status changes only via the explicit Mark as Reviewed button or the Status control */ App.toast(`Kept ${d.label.toLowerCase()} for ${r.catalog_id}`); App.reselect && App.reselect(); return true; }
    const nv = ($("[data-cv]", li).value || "").trim(), why = ($("[data-cr]", li).value || "").trim(), vref = $("[data-cvref]", li).checked, ov = d.get(r);
    if (!nv) { App.toast("Enter the corrected value"); return true; }
    if (d.coarse && !coarse(nv)) { App.toast("Origin must be a region or setting (no coordinates or street address)"); return true; }
    const patch = { field_sources: { ...(r.field_sources || {}), [f]: "owner" } };
    if (f === "category") { patch.category = nv; patch.category_kept = nv; patch.category_history = [...(r.category_history || []), { from: App.kindOf(r), to: nv, date: new Date().toISOString().slice(0, 10), ts: new Date().toISOString(), reason: "Owner correction" + (why ? `: ${why}` : "") }]; }
    else patch[d.key] = nv;
    if (f === "origin") { patch.region = coarse(nv); if (r.provenance_answer !== "local" && r.provenance_answer !== "collection") patch.provenance_answer = "collection"; }
    await record(r, f, ov, nv, why, false);
    await App.patch(r.catalog_id, patch);
    if (vref && window.Analysis && Analysis.learn) { const rr = { ...r, ...patch }, kind = App.kindOf(rr), type = String(rr.suggestion_1 || rr.object_type || "").replace(/\s*\(.*$/, "");
      await Analysis.learn(rr, kind, type, "owner verified reference (correction)", { region: coarse(rr.region) || (window.Learn ? Learn.regionOf(rr) : ""), era: rr.era || App.eraOf(rr), notes: [rr.key_features, why].filter(Boolean).join(". "), photo_ids: (rr.photos || []).map((p, i) => p.id || `${rr.catalog_id}/${i}`), material: rr.material || "", is_public: false }); }
    App.toast(`✓ ${d.label} corrected for ${r.catalog_id}${vref ? " and saved as a verified reference" : ""}`); App.refresh(); App.reselect && App.reselect(); return true;
  }
  /* worldwide similar examples: same category + material first, region is a soft bonus (never a filter) */
  function similarWorld(r, k = 4) { if (!window.Retrieve || !window.Analysis) return []; const kind = window.App ? App.kindOf(r) : r.category;
    const ex = Analysis.all().map(e => ({ ...e, region: e.region || "" })); return Retrieve.rankSimilar({ ...r, category: kind, region: coarse(r.region) || "" }, ex, { k, softRegion: true }); }
  function simHtml(r) { const s = similarWorld(r); if (!s.length) return "";
    return `<section class="simw" aria-label="Similar verified examples"><h3 class="gal-h">🔗 Similar verified examples <span class="muted">(worldwide library; region is a soft match)</span></h3><ol>${s.map(x => `<li><strong>${esc(x.example.catalog_id || "")}</strong> ${esc(x.example.confirmed_type || "")} <span class="muted">score ${esc(x.score)}${x.example.region ? " · " + esc(x.example.region) : ""}</span><br><span class="help">${esc(x.why.join("; "))}</span></li>`).join("")}</ol></section>`; }
  window.Correct = { html, onClick, simHtml, all, accuracy, similarWorld, FIELDS, sourceOf };
})();
