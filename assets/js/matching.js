/* UnEarthed Finds: matching helpers shared by the browser and the analyze-find edge function (supabase/functions/_shared/matching.js is an identical copy;
   tools/check_shared.py verifies). Pure and dependency-free. Everything here is a research aid: no authenticity or value claims, no coordinates. */
(function (root) {
  "use strict";
  const VERSION = "match-2026-10-27.1";
  /* Structured attributes the owner can give the AI before a run. required: true means the field must be answered (a value of "unknown" counts). */
  const ATTRS = {
    artifact: [
      { k: "material", label: "Material", required: true, options: ["chert", "flint", "quartzite", "chalcedony / agate", "obsidian", "petrified wood", "sandstone", "limestone", "other", "unknown"] },
      { k: "form", label: "Overall form", options: ["point (pointed, symmetrical)", "knife / long biface", "preform / unfinished biface", "scraper", "core", "flake", "cobble / ground stone", "no clear form", "unknown"] },
      { k: "flaking", label: "Flake scars", required: true, options: ["flaked on both faces (bifacial)", "flaked on one face", "a few flake scars", "no flake scars visible", "hidden by coating (e.g. caliche)", "unknown"] },
      { k: "flake_pattern", label: "Flake-scar pattern", options: ["regular, consistent direction", "parallel / ribbon-like", "random sizes and directions", "edge retouch only", "unknown"] },
      { k: "base", label: "Base / hafting", options: ["not applicable", "lanceolate (no stem)", "stemmed", "corner-notched", "side-notched", "basal-notched / split base", "contracting stem", "broken or unclear", "unknown"] },
      { k: "edges", label: "Edges", options: ["serrated", "beveled", "ground (smooth)", "plain", "chipped irregularly", "unknown"] },
      { k: "surface", label: "Surface", options: ["cortex (original rind) present", "caliche or mineral crust", "patinated", "polished / ground face", "pecked or pitted", "rough and pebbly all around", "smooth and water-worn", "unknown"] },
      { k: "length_mm", label: "Length (mm)", num: true }, { k: "width_mm", label: "Width (mm)", num: true }, { k: "thickness_mm", label: "Thickness (mm)", num: true },
      { k: "setting", label: "Setting (general, never exact)", options: ["creek / river gravel", "plowed field", "pasture / surface", "road or gravel pit", "eroding bank", "other", "unknown"] }],
    fossil: [
      { k: "material", label: "Preserved as", required: true, options: ["shell material", "stone cast / steinkern", "silicified (chert-like)", "petrified wood", "bone / tooth", "unknown"] },
      { k: "form", label: "Overall form", options: ["coiled shell", "oyster-like valve", "round or heart-shaped test", "tooth", "stalk / segmented", "branching", "unknown"] },
      { k: "length_mm", label: "Length (mm)", num: true }, { k: "width_mm", label: "Width (mm)", num: true },
      { k: "setting", label: "Setting (general, never exact)", options: ["limestone / chalk outcrop", "creek gravel", "plowed field", "other", "unknown"] }],
    rock: [
      { k: "material", label: "Appearance", required: true, options: ["glassy / waxy (chert-like)", "gritty (sandstone-like)", "chalky / white crust", "metallic or heavy", "crystalline", "banded", "unknown"] },
      { k: "form", label: "Overall form", options: ["rounded lump", "nodule with rind", "flat slab", "crystals or cluster", "unknown"] },
      { k: "length_mm", label: "Length (mm)", num: true }, { k: "width_mm", label: "Width (mm)", num: true }] };
  const clean = (a, kind) => { const out = {}; (ATTRS[kind] || ATTRS.artifact).forEach(d => { let v = a && a[d.k]; if (v == null || v === "") return; v = String(v).slice(0, 80);
      if (d.num) { const n = parseFloat(v); if (isFinite(n) && n > 0 && n < 2000) out[d.k] = n; } else if (d.options.includes(v)) out[d.k] = v; }); return out; };
  const missingRequired = (a, kind) => (ATTRS[kind] || ATTRS.artifact).filter(d => d.required && !(a && a[d.k])).map(d => d.label);
  const attrsText = (a, kind) => { const o = clean(a, kind), lines = (ATTRS[kind] || ATTRS.artifact).filter(d => o[d.k] != null).map(d => `${d.label}: ${o[d.k]}${d.num ? " mm" : ""}`); return lines.length ? "Owner-entered attributes (owner's own observations, not verified):\n- " + lines.join("\n- ") : ""; };
  /* region/time-period priors (data/learn/priors.json): a mild hint, never a filter */
  function priorsFor(priors, region) { const reg = (region && (region.admin1 || region.country)) || ""; if (!priors || !Array.isArray(priors.packs) || !reg) return null;
    const p = priors.packs.find(x => ((x.match || {}).admin1 || []).some(a => String(a).toLowerCase() === String(reg).toLowerCase())); if (!p) return null; const { match, ...rest } = p; return { ...rest, how_to_use: "Mild hint only, never proof. The owner's provenance wins; do not force a match to these types." }; }
  const priorsText = p => p ? "REGION PRIORS (context only; a mild hint, never proof):\n" + JSON.stringify(p).slice(0, 3500) : "";
  /* sanitize the extra output sections */
  const COORD = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/g, str = (v, n) => String(v == null ? "" : v).replace(COORD, "[coordinates removed]").slice(0, n);
  const LIKELY = ["likely_artifact", "possible_artifact", "uncertain", "likely_natural"];
  function extras(res, nPhotos) {
    const al = res && res.artifact_likelihood || {}, v = LIKELY.includes(al.verdict) ? al.verdict : "uncertain";
    const list = x => (Array.isArray(x) ? x : []).slice(0, 8).map(s => str(s, 160)).filter(Boolean);
    const out = { artifact_likelihood: { verdict: v, confidence_pct: Math.max(0, Math.min(95, Math.round(Number(al.confidence_pct) || 0))), evidence_for: list(al.evidence_for), evidence_against: list(al.evidence_against), natural_explanations: list(al.natural_explanations), reason: str(al.reason, 400) } };
    out.diagnostic_checklist = (Array.isArray(res && res.diagnostic_checklist) ? res.diagnostic_checklist : []).slice(0, 14).map(x => ({ feature: str(x && x.feature, 80), status: ["present", "absent", "not_visible"].includes(x && x.status) ? x.status : "not_visible", photo_index: Number.isInteger(x && x.photo_index) && x.photo_index >= 0 && x.photo_index < (nPhotos || 99) ? x.photo_index : null, note: str(x && x.note, 160) })).filter(x => x.feature);
    const pq = res && res.photo_quality || {}; out.photo_quality = { usable: pq.usable !== false, issues: list(pq.issues), retake: list(pq.retake).slice(0, 4), views_seen: list(pq.views_seen) };
    return out;
  }
  /* confidence calibration, applied after the model answers. Returns { candidates, notes }. Never raises a percentage. Each change is listed as a '-' factor with source "calibration". */
  function calibrate(res, ctx) {
    ctx = ctx || {}; const notes = [], al = (res.artifact_likelihood || {}).verdict, pq = res.photo_quality || {}, n = ctx.nPhotos == null ? 3 : ctx.nPhotos, hist = ctx.history || {};
    const isNatural = c => /natural|geofact|concretion|caliche|cobble|not an artifact|unworked/i.test(String(c.name || ""));
    const cands = (res.candidates || []).map(c => { let pct = c.confidence_pct, why = [];
      const cap = (lim, msg) => { if (pct > lim) { why.push(msg + ` (capped at ${lim}%)`); pct = lim; } };
      if (!isNatural(c)) {
        if (al === "likely_natural") cap(35, "The photos look more like a natural rock than a worked piece");
        else if (al === "uncertain") cap(60, "It is not clear the piece is worked at all");
        if (pq.usable === false) cap(45, "Photo quality is too poor for a firm match");
        if (n < 2) cap(50, "Only one photo was given");
      }
      const h = hist[String(c.name || "").toLowerCase().split(/[\s(\/]/)[0]]; if (h && h.n >= 3 && h.agree < 0.5) { const np = Math.max(1, pct - 10); if (np < pct) { why.push(`Past feedback on this type agrees only ${Math.round(h.agree * 100)}% of the time (${h.n} responses), so -${pct - np}`); pct = np; } }
      if (why.length) { notes.push(c.name + ": " + why.join("; ")); return { ...c, confidence_pct: pct, factors: [...(c.factors || []), ...why.map(w => ({ sign: "-", reason: w.slice(0, 160), source: "calibration" }))].slice(0, 10) }; }
      return c; });
    return { candidates: cands, notes };
  }
  /* stable cache key (FNV-1a, 53-bit mix) over everything that changes the answer */
  function cacheKey(p) { const s = JSON.stringify([VERSION, p.catalog_id, p.kind, (p.photos || []).map(x => String(x).split("?")[0]), p.record || {}, p.attrs || {}, p.region || ""]); let h1 = 0x811c9dc5, h2 = 0x1b873593; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; } return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"); }
  /* Public list prices, USD per 1M tokens (https://platform.openai.com/docs/pricing, read 2026-10-27) and image-token rules
     (https://platform.openai.com/docs/guides/images-vision). tile models: base + tile x 512px tiles (detail low = base only);
     patch models: ceil(w/32) x ceil(h/32) patches within maxDim/budget, times a multiplier. Estimates only: the provider's bill is the truth. */
  const PRICES = { "gpt-4o-mini": { in: 0.15, out: 0.6, tile: [2833, 5667] }, "gpt-4o": { in: 2.5, out: 10, tile: [85, 170] },
    "gpt-4.1-mini": { in: 0.4, out: 1.6, patch: { mult: 1.62, maxDim: 2048, budget: 6144 } }, "gpt-5.4-nano": { in: 0.2, out: 1.25, patch: { mult: 1.2, maxDim: 2048, budget: 2500 } },
    "gpt-5.4-mini": { in: 0.75, out: 4.5, patch: { mult: 1.2, maxDim: 2048, budget: 2500 } } };
  function imageTokens(model, w, h, detail) { const m = PRICES[model] || PRICES["gpt-4o-mini"];
    if (m.tile) { if (detail === "low") return m.tile[0]; let W = w, H = h, s = Math.min(1, 2048 / Math.max(W, H)); W *= s; H *= s; s = Math.min(1, 768 / Math.min(W, H)); W *= s; H *= s; return m.tile[0] + m.tile[1] * Math.ceil(W / 512) * Math.ceil(H / 512); }
    const p = m.patch; let W = w, H = h, s = Math.min(1, p.maxDim / Math.max(W, H)); W *= s; H *= s; let n = Math.ceil(W / 32) * Math.ceil(H / 32);
    if (n > p.budget) { const f = Math.sqrt(32 * 32 * p.budget / (W * H)); W = Math.floor(W * f); H = Math.floor(H * f); n = Math.ceil(W / 32) * Math.ceil(H / 32); } return Math.ceil(n * p.mult); }
  /* detail policy (cost control): the first two photos at "high", the rest and all reference thumbnails at "low" */
  const detailFor = i => i < 2 ? "high" : "low";
  function estimateCost(o) { o = o || {}; const model = PRICES[o.model] ? o.model : "gpt-4o-mini", m = PRICES[model], n = o.photos == null ? 4 : o.photos, refs = o.refImages == null ? 2 : o.refImages, W = o.w || 1600, H = o.h || 1200;
    let img = refs * imageTokens(model, 320, 240, "low"); for (let i = 0; i < n; i++) img += imageTokens(model, W, H, o.detail || detailFor(i));
    const inTok = (o.textTokens || 7000) + img, outTok = o.outTokens || 1300; return { model, inTok, outTok, usd: Math.round((inTok * m.in + outTok * m.out) / 1e6 * 10000) / 10000 }; }
  const api = { VERSION, ATTRS, clean, missingRequired, attrsText, priorsFor, priorsText, extras, calibrate, cacheKey, PRICES, imageTokens, detailFor, estimateCost };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Matching = api;
})(typeof window !== "undefined" ? window : globalThis);
