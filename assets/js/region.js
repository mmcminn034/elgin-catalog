/* Region check: rule-based "may not be local" hints against a regional profile (data/regions/<id>.json).
   Never blocks a save. An owner answer (provenance_answer) always wins and silences the prompt. */
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let P = null, rules = [], W = null, IDX = null;
  const FB = "ro-region-feedback";
  const homeId = () => (window.ROLLING_OAK_BRAND && window.ROLLING_OAK_BRAND.homeRegion) || "bastrop-tx";
  async function load(id = homeId()) { loadWorld(); try { P = await (await fetch(`data/regions/${id}.json`, { cache: "no-cache" })).json(); rules = (P.non_local || []).map(x => ({ ...x, re: new RegExp(x.pattern, "i") })); } catch { P = null; rules = []; } return P; }
  /* Worldwide settings (data/regions/world.json) + pack index; loaded alongside the home pack, failures are non-fatal. */
  async function loadWorld() { try { const [w, i] = await Promise.all([fetch("data/regions/world.json", { cache: "no-cache" }).then(r => r.json()), fetch("data/regions/index.json", { cache: "no-cache" }).then(r => r.json())]); W = w; IDX = i; W.settings.forEach(x => { x.re = new RegExp(x.pattern, "i"); }); } catch { W = W || null; } return W; }
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
  const COUNTRIES = ["Argentina","Australia","Brazil","Canada","Chile","China","Denmark","Egypt","England","France","Germany","India","Indonesia","Ireland","Israel","Italy","Japan","Kenya","Mexico","Morocco","Netherlands","New Zealand","Peru","Portugal","Scotland","South Africa","Spain","Sweden","United Kingdom","United States","Wales"];
  const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","Mexico","Other / unknown"];
  function bannerHtml(r, { compact = false } = {}) {
    if (answered(r)) return "";
    const c = check(r); if (!c.flag) return "";
    return `<div class="oor" role="status" data-oor="${esc(r.catalog_id || "NEW")}"><div><strong>⚠ May not be local</strong> <span class="muted">(differs from your home region${P && P.name ? ": " + esc(P.name) : ""})</span>${r.provenance_answer === "unsure" ? ' <span class="muted">(you said “not sure”; answer anytime)</span>' : ""}
      <ul>${c.reasons.map(x => `<li>${esc(x.reason)} <span class="muted">(matched “${esc(x.match)}”)</span></li>`).join("")}</ul>
      <span>Where is this piece from? Your answer is recorded as provenance and helps the analysis. This doesn't change the identification.</span></div>
      <div class="oor-act"><button type="button" class="btn" data-prov="local">Found here</button>
      <button type="button" class="btn" data-prov="collection-open">From my collection…</button>
      <button type="button" class="btn" data-prov="unsure">Not sure</button></div>
      <div class="oor-place" hidden><label class="field"><span>Where is it from? (state, province or country; no exact locality needed)</span><input list="oorStates" data-prov-place placeholder="e.g. Nevada"></label>
      <datalist id="oorStates">${[...STATES, ...COUNTRIES].map(s => `<option value="${esc(s)}">`).join("")}</datalist>
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
  /* ---- Likely origin (Stage 2): ranked, coarse-only, never coordinates. ----
     Sources in priority order: owner-confirmed origin > owner provenance (local / collection) > AI guess (r.origin_guess, members) > rules.
     Confidence is capped at Moderate. Output is region / geologic-setting level only. */
  const COARSE = s => { s = String(s || "").trim(); return s && !/\d+\.\d{3,}|\b\d{2,5}\s+\w+\s+(st|rd|ave|lane|ln|dr|road|street|hwy)\b/i.test(s) ? s : ""; };
  const CAP = c => ({ moderate: "Moderate", "low-moderate": "Low-Moderate", low: "Low" })[String(c || "").toLowerCase()] || "Low";
  function settingsFor(r) { if (!W) return []; const t = textOf(r); return W.settings.filter(x => { const re = new RegExp(x.pattern, "gi"); let m; while ((m = re.exec(t))) if (!negated(t, m.index)) return true; return false; }); }
  function likelyOrigin(r) {
    if (!r) return { items: [], settings: [] };
    const items = [], settings = settingsFor(r).slice(0, 3), home = P && P.name;
    const owner = COARSE(r.origin_confirmed);
    if (owner) items.push({ region: owner, confidence: "Moderate", source: "Owner confirmed", why: "Recorded by the owner." });
    if (r.provenance_answer === "local" && home) items.push({ region: COARSE(r.region) || home, confidence: "Moderate", source: "Owner: found here", why: "The owner recorded this as a local find in the collection's home region." });
    else if (isCollection(r)) { const st = stateOnly(r.provenance || r.region); if (st) items.push({ region: COARSE(r.region) || st, confidence: "Moderate", source: "Owner: from a collection", why: COARSE(r.acquisition) || "Personal collection piece." }); }
    (Array.isArray(r.origin_guess) ? r.origin_guess : []).slice(0, 3).forEach(g => { const reg = COARSE(g.region || g.setting); if (reg) items.push({ region: reg, setting: g.setting || "", confidence: CAP(g.confidence), source: g.source || "AI suggestion", why: g.why || "" }); });
    if (!items.length) {
      const c = check(r);
      if (home && !c.flag) items.push({ region: home, confidence: settings.some(x => !x.country || x.admin1 === (P.admin1 || P.state)) ? "Low-Moderate" : "Low", source: "Rules: home region", why: "Nothing in the record points elsewhere, and the material fits the home region." });
      settings.filter(x => x.where && x.where.length).slice(0, 2).forEach(x => items.push({ region: x.where.slice(0, 3).join("; "), setting: x.name, confidence: "Low", source: "Rules: geologic setting", why: `The record mentions ${x.name.toLowerCase()}.` }));
    }
    return { items: items.slice(0, 4), settings, home };
  }
  function originHtml(r) {
    const o = likelyOrigin(r); if (!o.items.length && !o.settings.length) return "";
    const conf = c => `<span class="oc oc-${esc(c.toLowerCase())}">${esc(c)}</span>`;
    return `<section class="origin" aria-label="Likely origin"><h3 class="gal-h">🌍 Likely origin <span class="muted">(region or geologic setting; never an exact spot)</span></h3>
      ${o.items.length ? `<ol class="origin-list">${o.items.map(x => `<li><strong>${esc(x.region)}</strong>${x.setting ? ` <span class="muted">· ${esc(x.setting)}</span>` : ""} ${conf(x.confidence)}<br><span class="help">${esc(x.source)}${x.why ? ": " + esc(x.why) : ""}</span></li>`).join("")}</ol>` : ""}
      ${o.settings.length ? `<p class="help"><strong>Where similar material occurs:</strong></p><ul class="origin-where">${o.settings.map(x => `<li>${esc(x.name)}: <span class="muted">${esc((x.where || []).join("; "))}</span></li>`).join("")}</ul>` : ""}
      <p class="help">Research suggestions only. Confidence is capped at Moderate. The owner's provenance always wins; members' AI analysis can refine this.</p></section>`;
  }
  window.Region = { likelyOrigin, originHtml, loadWorld, homeId, world: () => W, packs: () => IDX, load, check, answered, isCollection, stateOnly, bannerHtml, answer, feedback, promptContext, profile: () => P };
})();
