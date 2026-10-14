/* Rolling Oak retrieval: rank verified reference examples by similarity to a find (RAG context).
   Pure, dependency-free; runs in the browser (window.Retrieve) and in Deno edge functions
   (supabase/functions/_shared/retrieve.js is an identical copy; tools/check_shared.py verifies). */
(function (root) {
  "use strict";
  const STOP = new Set("with from that this have been were into very some more than also each about like only near both other their there these those which while edge edges point possible likely piece shows".split(" "));
  const MATERIALS = ["chert", "flint", "quartzite", "agate", "chalcedony", "jasper", "obsidian", "petrified wood", "limestone", "sandstone", "quartz", "calcite", "pyrite", "marcasite", "hematite", "basalt", "novaculite"];
  const tokens = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
  const num = v => { const m = String(v ?? "").match(/\d+(\.\d+)?/g); return m ? m.map(Number).reduce((s, x) => s + x, 0) / m.length : null; };
  const mats = t => MATERIALS.filter(m => String(t || "").toLowerCase().includes(m));
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const textOf = r => [r.object_type, r.key_features, r.owner_observations, r.notes, r.features, r.condition].filter(Boolean).join(" ");
  /* target: a find record. examples: verified_examples rows. opts: { k, candidateTypes: [names], candidateIds: [type ids] } */
  function rankSimilar(target, examples, opts) {
    opts = opts || {}; const k = opts.k || 3, me = tokens(textOf(target)), L = num(target.length_mm), myMat = mats(target.material);
    const cands = [target.suggestion_1, target.suggestion_2, target.suggestion_3, ...(opts.candidateTypes || [])].filter(Boolean).map(norm), cIds = new Set(opts.candidateIds || []);
    const kind = target.category || target.kind || "artifact";
    return (examples || []).filter(e => e && e.catalog_id !== target.catalog_id && (e.category || "artifact") === kind).map(e => {
      let s = 0; const why = [];
      const tn = norm(e.confirmed_type), tHit = (e.type_ids || []).some(id => cIds.has(id)) || cands.some(c => c && tn && (c.includes(tn) || tn.includes(c.split(" ")[0])));
      if (tHit) { s += 3; why.push(`same candidate type (${e.confirmed_type})`); }
      const et = tokens(textOf(e)), shared = [...me].filter(w => et.has(w)), j = shared.length / Math.max(1, me.size + et.size - shared.length);
      if (shared.length) { s += Math.min(4, 10 * j + 0.25 * shared.length); why.push("shared traits: " + shared.slice(0, 4).join(", ")); }
      const em = mats(e.material), mHit = myMat.filter(m => em.includes(m)); if (mHit.length) { s += 1.5; why.push(`same material (${mHit[0]})`); }
      if (target.region && e.region && norm(target.region) === norm(e.region)) { s += 1; why.push(`same region (${e.region})`); }
      const EL = num(e.length_mm); if (L && EL) { const d = Math.abs(L - EL) / Math.max(L, EL); if (d <= 0.15) { s += 1.5; why.push(`similar length (${Math.round(L)} vs ${Math.round(EL)} mm)`); } else if (d <= 0.3) { s += 0.75; why.push(`comparable length (${Math.round(L)} vs ${Math.round(EL)} mm)`); } }
      if (target.era && e.era && norm(target.era) === norm(e.era)) { s += 0.75; why.push(`same era (${e.era})`); }
      return { example: e, score: Math.round(s * 10) / 10, why };
    }).filter(x => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, k);
  }
  const api = { rankSimilar, tokens, materials: mats };
  root.Retrieve = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
