/* Rolling Oak: AI prompt template + external-reference retrieval. Pure; runs in the browser (window.Prompt, used for the
   "View AI prompt" disclosure) and in the analyze-find edge function (supabase/functions/_shared/prompt.js, identical copy;
   tools/check_shared.py verifies). Region-neutral: the home region and provenance are context, never assumptions. */
(function (root) {
  "use strict";
  const SYSTEM = `You assist amateur collectors worldwide documenting finds (artifacts, fossils, rocks/minerals).
The collection's home region, the owner's provenance and any region hints are CONTEXT ONLY: the owner's provenance always wins, but do not assume a find comes from any particular region.
Rules: give RESEARCH POSSIBILITIES, never definitive identifications; never claim authenticity or monetary value.
Confidence is an earned 0-100 number ("confidence_pct"), at most 95, and you must list the factors behind it ("factors": each with sign "+" or "-", a short reason, and the source if it comes from a reference). Raise it for clearly visible diagnostic traits, sizes inside a published range, agreement with the owner's verified examples and clear separation from the runner-up; lower it for conflicting traits, estimate-only sizes, few or unclear photos and close alternatives.
Only describe and mark features you can actually see in the photos. If a feature is not visible, say so in "gaps".
Return ONLY JSON matching:
{"candidates":[{"name":str,"type_id":str|null,"confidence_pct":int,"factors":[{"sign":"+"|"-","reason":str,"source":str|null}],"why":str,"why_not":str,"reference_ids":[str]}],
 "classification":{"category":"artifact"|"fossil"|"rock","object_type":str,"material":str,"confidence_pct":int},
 "origin":[{"region":str,"setting":str,"confidence_pct":int,"why":str}],
 "marks":[{"photo_index":int,"marks":[{"type":"arrow"|"circle"|"line"|"measure"|"box","coords":[...],"label":str,"explanation":str,"links_to":{"kind":"candidate"|"feature"|"date","ref":str}}]}],
 "alternatives":[str],
 "measurements":{"scale_visible":bool,"length_mm":num|null,"width_mm":num|null,"thickness_mm":num|null,"note":str},
 "next_photos":[str],"gaps":[str],"caveat":str}
Coordinates are normalized 0-1 relative to each image (x by width, y by height). arrow/line/measure/box: [x1,y1,x2,y2]; circle: [cx,cy,r] with r as a fraction of width.
Use at most 3 candidates and at most 8 marks per photo. For "feature" links use the exact checklist names provided.
Comparison: "similar_verified_examples" are the owner's verified finds (photos labelled REFERENCE). "external_references" are PUBLISHED TYPOLOGY summaries (labelled EXTERNAL REFERENCE, not the find), each with its source and license. Compare form, base/stem, flaking and size against both; cite reference ids in "reference_ids" and name the source in factors. Never copy a type without visible evidence. A reference from the find's region is a mild hint, not proof; types from anywhere in the world may apply.
Origin: region or geologic setting only (e.g. "Edwards Plateau chert, Texas" or "Paris Basin flint, France"), never coordinates or street addresses.
Measurements: ONLY if a ruler, scale bar or coin is clearly visible, estimate length/width/thickness in mm from it and explain how in "note"; otherwise set scale_visible false and the numbers null.
"next_photos": the 1-4 specific photos that would most improve the identification (e.g. "square-on base view under raking light").
"alternatives": other plausible types worth ruling out (names only).`;
  const norm = s => String(s || "").toLowerCase();
  const num = v => { const m = String(v || "").match(/\d+(\.\d+)?/g); return m ? m.map(Number).reduce((a, x) => a + x, 0) / m.length : null; };
  /* top-k published types for a record: trait tags (via the dataset's trait_patterns), size range, name/alias mention,
     and a same-region BONUS (never a filter). region: { admin1, country, continent } */
  /* drop negated statements ("not ground", "no notches", "without serration") so a trait the owner ruled out never counts as present */
  const affirmed = t => String(t || "").replace(/\b(?:not|no|never|without|lacks?|lacking|isn'?t|aren'?t)\b(?:\s+(?:a|an|the|any|really|clearly|very))?\s+[\w-]+(?:\s+(?:or|and|nor)\s+[\w-]+)?/gi, " ");
  const GENERIC = /^(point|points|stemmed|stem|side|corner|basal|notched|knife|blade|biface|dart|arrow|large|small|early|late|type|lanceolate|triangular|bifurcate|leaf|archaic|paleo|clovis-like|flake|scraper|drill|core)$/;
  function rankReferences(rec, refs, patterns, opts) {
    opts = opts || {}; const k = opts.k || 5, reg = opts.region || {}, txt = norm([rec.object_type, rec.key_features, rec.owner_observations, rec.suggestion_1, rec.suggestion_2, rec.suggestion_3, rec.material].map(affirmed).join(" ")), L = num(rec.length_mm), hint = (opts.hintNames || []).map(norm).filter(Boolean);
    const pats = {}; Object.entries(patterns || {}).forEach(([t, rx]) => { try { pats[t] = new RegExp(rx, "i"); } catch (e) {} });
    return (refs || []).filter(e => !opts.category || !e.category || e.category === opts.category).map(e => {
      let s = 0; const why = [];
      const nm = [e.name, ...(e.aliases || [])].map(norm).filter(n => n.length > 3), base = norm(e.name).split(/\s+/)[0];
      if (nm.some(n => txt.includes(n)) || (base.length > 3 && !GENERIC.test(base) && new RegExp("\\b" + base.replace(/[^a-z0-9]/g, "") + "\\b").test(txt))) { s += 4; why.push("name or alias mentioned in the record"); }
      else if (hint.length && nm.some(n => hint.some(h => n === h || (h.split(" ")[0].length > 3 && n.split(" ")[0] === h.split(" ")[0])))) { s += 3; why.push("among the rules engine's top possibilities"); }
      const hits = (e.traits || []).filter(t => pats[t] && pats[t].test(txt)); if (hits.length) { s += Math.min(5, hits.length) + 2 * hits.length / (e.traits || []).length; why.push("traits: " + hits.slice(0, 5).join(", ")); } /* + precision: share of the type's own traits seen in the record */
      if (L && e.length_mm) { if (L >= e.length_mm[0] && L <= e.length_mm[1]) { s += 1; why.push(`length ~${Math.round(L)} mm within ${e.length_mm[0]}-${e.length_mm[1]} mm`); } else s -= 1; }
      if (reg.admin1 && (e.admin1 || []).some(a => norm(a) === norm(reg.admin1))) { s += 1; why.push(`reported from ${reg.admin1}`); }
      else if (reg.country && (e.country || []).some(c => norm(c) === norm(reg.country))) { s += 0.5; why.push(`reported from ${reg.country}`); }
      else if (reg.continent && norm(e.continent).includes(norm(reg.continent))) { s += 0.25; }
      return { entry: e, score: Math.round(s * 10) / 10, hits: hits.length, why };
    }).filter(x => x.score >= 2 && (x.hits >= 2 || /^(name or alias|among the rules)/.test(x.why[0] || ""))).sort((a, b) => b.score - a.score).slice(0, k);
  }
  const refBrief = x => ({ id: x.entry.id, name: x.entry.name, typology_system: x.entry.typology_system, period: x.entry.period, dates: x.entry.dates, region: [x.entry.continent, (x.entry.admin1 || []).slice(0, 8).join(", ")].filter(Boolean).join(": "),
    length_mm: x.entry.length_mm, width_mm: x.entry.width_mm, thickness_mm: x.entry.thickness_mm, traits: x.entry.traits, similar: (x.entry.similar || []).slice(0, 6), why_retrieved: x.why,
    source: (x.entry.sources || []).map(s => `${s.name} <${s.url}> (retrieved ${s.retrieved}; ${s.license})`).join(" | ") });
  /* user message text (everything except the image parts, which follow in order) */
  function buildUserText(ctx, nPhotos) {
    const refs = (ctx.external_references || []);
    return "Context (record, owner's notes, reference knowledge base, verified examples, external references):\n" + JSON.stringify(ctx).slice(0, 60000)
      + (refs.length ? "\n\n" + refs.map(r => `EXTERNAL REFERENCE (published typology, not the find): ${r.id} ${r.name} [${r.typology_system}; ${r.period || "period n/a"} ${r.dates || ""}; ${r.region}]. Source: ${r.source}`).join("\n") : "")
      + `\nPhotos follow in order (photo_index 0..${Math.max(0, nPhotos - 1)}).`;
  }
  const api = { SYSTEM, rankReferences, refBrief, buildUserText, affirmed };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Prompt = api;
})(typeof window !== "undefined" ? window : globalThis);
