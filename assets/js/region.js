/* Region check: rule-based "may not be local" hints against a regional profile (data/regions/<id>.json).
   Never blocks a save. An owner answer (provenance_answer) always wins and silences the prompt. */
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let P = null, rules = [];
  const FB = "ro-region-feedback";
  async function load(id = "bastrop-tx") { try { P = await (await fetch(`data/regions/${id}.json`, { cache: "no-cache" })).json(); rules = (P.non_local || []).map(x => ({ ...x, re: new RegExp(x.pattern, "i") })); } catch { P = null; rules = []; } return P; }
  // Owner text that describes the piece (not long research prose about other places).
  const textOf = r => [r.object_type, r.material, r.color, r.key_features, r.suggestion_1, r.suggestion_2, r.suggestion_3, r.owner_observations, r.context_notes && r.context_notes.length < 400 ? r.context_notes : ""].filter(Boolean).join(" \n ");
  const negated = (t, i) => /\b(no|not|without|isn't|never|unlike)\b[^.;,\n]{0,24}$/i.test(t.slice(Math.max(0, i - 30), i));
  function check(r) {
    if (!rules.length || !r) return { flag: false, reasons: [] };
    const t = textOf(r), reasons = [];
    for (const x of rules) { const re = new RegExp(x.pattern, "gi"); let m, hit = null; while ((m = re.exec(t))) { if (!negated(t, m.index)) { hit = m[0]; break; } } if (hit) reasons.push({ id: x.id, match: hit, reason: x.reason }); }
    return { flag: reasons.length > 0, reasons, region: P && P.name };
  }
  const answered = r => !!(r && ((r.provenance_answer && r.provenance_answer !== "unsure") || r.acquisition));
  const isCollection = r => !!(r && (r.provenance_answer === "collection" || /collection|brought|bought|purchas|gift|traded/i.test(r.acquisition || "")));
  /* State-level only, for public pages: "Nevada (exact locality unknown)" -> "Nevada"; "Elko County, Nevada" -> "Nevada". */
  const stateOnly = s => { s = String(s || "").split(" (")[0].trim(); const parts = s.split(",").map(x => x.trim()).filter(Boolean); return parts.length ? parts[parts.length - 1] : ""; };
  const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","Mexico","Other / unknown"];
  function bannerHtml(r, { compact = false } = {}) {
    if (answered(r)) return "";
    const c = check(r); if (!c.flag) return "";
    return `<div class="oor" role="status" data-oor="${esc(r.catalog_id || "NEW")}"><div><strong>⚠ May not be local</strong>${r.provenance_answer === "unsure" ? ' <span class="muted">(you said “not sure”; answer anytime)</span>' : ""}
      <ul>${c.reasons.map(x => `<li>${esc(x.reason)} <span class="muted">(matched “${esc(x.match)}”)</span></li>`).join("")}</ul>
      <span>Where is this piece from? Your answer is recorded as provenance and helps the analysis. This doesn't change the identification.</span></div>
      <div class="oor-act"><button type="button" class="btn" data-prov="local">Found here</button>
      <button type="button" class="btn" data-prov="collection-open">From my collection…</button>
      <button type="button" class="btn" data-prov="unsure">Not sure</button></div>
      <div class="oor-place" hidden><label class="field"><span>Where is it from? (state or country; no exact locality needed)</span><input list="oorStates" data-prov-place placeholder="e.g. Nevada"></label>
      <datalist id="oorStates">${STATES.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <button type="button" class="btn primary" data-prov="collection">Save provenance</button></div></div>`;
  }
  /* Turns a click inside a banner into a patch; returns null if the click wasn't an answer. */
  function answer(e, r) {
    const b = e.target.closest("[data-prov]"); if (!b) return null; const box = b.closest(".oor"), v = b.dataset.prov, c = check(r);
    if (v === "collection-open") { box.querySelector(".oor-place").hidden = false; box.querySelector("[data-prov-place]").focus(); return { pending: true }; }
    let patch;
    if (v === "local") patch = { provenance_answer: "local", provenance: (P && P.name) || "Found locally", acquisition: "Surface find (owner confirmed local)" };
    else if (v === "unsure") patch = { provenance_answer: "unsure" };
    else { const place = (box.querySelector("[data-prov-place]").value || "").trim() || "Other / unknown"; patch = { provenance_answer: "collection", region: place, provenance: `${place} (exact locality unknown)`, acquisition: `Personal collection, brought from ${place}` }; }
    try { const fb = JSON.parse(localStorage.getItem(FB) || "[]"); fb.push({ catalog_id: r.catalog_id, answer: patch.provenance_answer, place: patch.provenance || "", reasons: c.reasons.map(x => x.id), ts: new Date().toISOString() }); localStorage.setItem(FB, JSON.stringify(fb.slice(-500))); } catch {}
    return { patch };
  }
  const feedback = () => { try { return JSON.parse(localStorage.getItem(FB) || "[]"); } catch { return []; } };
  /* Compact context for the AI prompt. */
  const promptContext = r => { const c = check(r); return { profile: P && P.name, expected_materials: P && P.expected.materials, flagged_non_local: c.reasons.map(x => x.reason), owner_provenance: r.provenance || null, acquisition: r.acquisition || null, provenance_answer: r.provenance_answer || null }; };
  window.Region = { load, check, answered, isCollection, stateOnly, bannerHtml, answer, feedback, promptContext, profile: () => P };
})();
