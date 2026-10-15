/* Rolling Oak: earned confidence score (0-100%). Pure and dependency-free; runs in the browser (window.Score)
   and in Deno edge functions (supabase/functions/_shared/score.js is an identical copy; tools/check_shared.py verifies).
   Every point added or removed is returned as a factor so the UI can show "Why this score".
   Rules engine and AI alone are capped (default 95%); 100% only when the owner has Verified the find AND it agrees
   with the published references. Thresholds are config (window.ROLLING_OAK_SCORE overrides DEFAULTS). */
(function (root) {
  "use strict";
  const DEFAULTS = {
    rulesCap: 95, aiCap: 95, verifiedMax: 100, base: 30,
    traitPts: 6, traitMax: 24, sizeIn: 8, sizeMeasured: 5, sizeOut: -12, sizeUnknown: -4, estimateOnly: -5,
    regionMatch: 6, verifiedAgree: 5, verifiedAgreeMax: 15, verifiedDisagree: -5,
    feedbackGood: 3, feedbackGoodMax: 10, feedbackWrong: -6, feedbackClose: -2, correction: -4, feedbackBadMax: -20,
    marginStrong: 3, marginStrongPts: 8, marginOk: 1.5, marginOkPts: 4, marginWeak: 1, marginWeakPts: -10,
    conflict: -8, fewPhotos: 2, fewPhotosPts: -10, goodPhotos: 4, goodPhotosPts: 4, manyPhotos: 6, manyPhotosPts: 6,
    diagnostic: 2, diagnosticMax: 8,
    // backward-compatible labels: pct >= threshold -> label (old records with text labels map to the midpoints below)
    bands: [[80, "High"], [50, "Moderate"], [30, "Low-moderate"], [0, "Low"]],
    labelPct: { "high": 85, "moderate": 65, "low-moderate": 40, "moderate-low": 40, "low to moderate": 40, "low": 20, "very low": 8, "insufficient data": 5 }
  };
  const cfg = over => Object.assign({}, DEFAULTS, (root && root.ROLLING_OAK_SCORE) || {}, over || {});
  const band = (pct, o) => { const c = cfg(o); for (const [t, l] of c.bands) if (pct >= t) return l; return "Low"; };
  const color = pct => pct >= 70 ? "green" : pct >= 40 ? "yellow" : "red";
  /* old text labels ("Moderate (capped)", "Low-moderate") -> a percentage, so existing records and filters keep working */
  function fromLabel(label, o) { const c = cfg(o), t = String(label || "").toLowerCase().trim(); if (!t) return null;
    const n = t.match(/(\d{1,3})\s*%/); if (n) return Math.min(100, +n[1]);
    for (const k of Object.keys(c.labelPct).sort((a, b) => b.length - a.length)) if (t.startsWith(k)) return c.labelPct[k]; return null; }
  /* inp: { traitHits, conflicts, size: "in"|"out"|"unknown", measured, estimateOnly, regionMatch, verifiedAgree, verifiedDisagree,
            feedback: {match, close, wrong}, keeps, corrections, photos, margin (top - runner-up, null if alone), diagnostics,
            ownerVerified, refAgrees, sources: [{name, url}], mode: "rules"|"ai", aiPct } */
  function compute(inp, o) {
    const c = cfg(o), f = [], add = (pts, label, source) => { if (pts) f.push({ sign: pts > 0 ? "+" : "-", pts: Math.abs(Math.round(pts)), label, source: source || null }); };
    const src = (inp.sources || [])[0] || null; let s;
    if (inp.mode === "ai" && inp.aiPct != null) { s = Math.max(0, Math.min(100, Number(inp.aiPct) || 0)); add(s, "AI model estimate from the photos and context"); }
    else { s = c.base; add(c.base, "Starting point for any ranked possibility"); }
    const th = inp.traitHits || 0; if (th) add(Math.min(c.traitMax, th * c.traitPts), `${th} reference trait${th > 1 ? "s" : ""} match the record`, src);
    if (inp.size === "in") { add(c.sizeIn, "Size is inside the published range", src); if (inp.measured) add(c.sizeMeasured, "Size was measured (calipers or ruler), not estimated"); }
    else if (inp.size === "out") add(c.sizeOut, "Size is outside the published range", src);
    else if (inp.size === "unknown") add(c.sizeUnknown, "Size not recorded, so size fit is unknown");
    if (inp.estimateOnly && inp.size !== "unknown") add(c.estimateOnly, "Size is an estimate only (photo or rough)");
    if (inp.regionMatch) add(c.regionMatch, "Type is reported from the find's region", src);
    if (inp.verifiedAgree) add(Math.min(c.verifiedAgreeMax, inp.verifiedAgree * c.verifiedAgree), `Agrees with ${inp.verifiedAgree} of your verified example${inp.verifiedAgree > 1 ? "s" : ""}`);
    if (inp.verifiedDisagree) add(inp.verifiedDisagree * c.verifiedDisagree, `Differs from ${inp.verifiedDisagree} verified example${inp.verifiedDisagree > 1 ? "s" : ""}`);
    const fb = inp.feedback || {}, good = (fb.match || 0) + (inp.keeps || 0), bad = (fb.wrong || 0) * c.feedbackWrong + (fb.close || 0) * c.feedbackClose + (inp.corrections || 0) * c.correction;
    if (good) add(Math.min(c.feedbackGoodMax, good * c.feedbackGood), `${good} 👍 Matches well / Keep response${good > 1 ? "s" : ""}`);
    if (bad) add(Math.max(c.feedbackBadMax, bad), "Past Correct / Wrong / Close feedback on this type");
    if (inp.margin != null) { const m = inp.margin; if (m >= c.marginStrong) add(c.marginStrongPts, "Clear lead over the runner-up"); else if (m >= c.marginOk) add(c.marginOkPts, "Some lead over the runner-up"); else if (m < c.marginWeak) add(c.marginWeakPts, "Runner-up is close behind"); }
    if (inp.conflicts) add(inp.conflicts * c.conflict, `${inp.conflicts} trait${inp.conflicts > 1 ? "s" : ""} conflict with this type`, src);
    const ph = inp.photos == null ? null : inp.photos; if (ph != null) { if (ph < c.fewPhotos) add(c.fewPhotosPts, `Only ${ph} photo${ph === 1 ? "" : "s"}`); else if (ph >= c.manyPhotos) add(c.manyPhotosPts, `${ph} photos from several views`); else if (ph >= c.goodPhotos) add(c.goodPhotosPts, `${ph} photos`); }
    if (inp.diagnostics) add(Math.min(c.diagnosticMax, inp.diagnostics * c.diagnostic), `${inp.diagnostics} diagnostic feature${inp.diagnostics > 1 ? "s" : ""} recorded as present`);
    const raw = (inp.mode === "ai" && inp.aiPct != null) ? s + f.slice(1).reduce((a, x) => a + (x.sign === "+" ? x.pts : -Math.abs(x.pts)), 0) * 0.5 : f.reduce((a, x) => a + (x.sign === "+" ? x.pts : -Math.abs(x.pts)), 0);
    const cap = inp.mode === "ai" ? c.aiCap : c.rulesCap; let pct = Math.round(Math.max(1, Math.min(cap, raw))), capped = raw > cap;
    if (inp.ownerVerified && inp.refAgrees) { pct = c.verifiedMax; capped = false; f.push({ sign: "+", pts: c.verifiedMax - Math.min(cap, Math.round(raw)), label: "Owner Verified this find and it agrees with the published references", source: src }); }
    else if (capped) f.push({ sign: "-", pts: Math.round(raw - cap), label: `Capped at ${cap}%: only an owner-Verified find that agrees with references can reach 100%`, source: null });
    return { pct, band: band(pct, o), color: color(pct), capped, cap, factors: f };
  }
  /* server-side clamp for AI output: 0-100 number (old text labels accepted), AI ceiling (default 95), factors sanitized */
  const COORD = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/;
  function clampPct(v, cap, o) { const c = cfg(o); let p = typeof v === "number" ? v : /^\s*\d/.test(String(v || "")) ? parseFloat(v) : fromLabel(v, o); if (p == null || isNaN(p)) p = 20; return Math.round(Math.max(0, Math.min(cap == null ? c.aiCap : cap, p))); }
  function clampFactors(fs) { return (Array.isArray(fs) ? fs : []).slice(0, 8).map(f => ({ sign: f && f.sign === "-" ? "-" : "+", reason: String((f && (f.reason || f.label)) || "").replace(COORD, "[coordinates removed]").slice(0, 160), source: f && f.source ? String(f.source).slice(0, 120) : null })).filter(f => f.reason); }
  function clampCandidates(list, o) { const c = cfg(o); return (Array.isArray(list) ? list : []).slice(0, 3).map(x => { const pct = clampPct(x && (x.confidence_pct != null ? x.confidence_pct : x.confidence), c.aiCap, o);
    return { ...x, confidence_pct: pct, confidence: band(pct, o), factors: clampFactors(x && x.factors), reference_ids: (Array.isArray(x && x.reference_ids) ? x.reference_ids : []).slice(0, 5).map(String) }; }); }
  const api = { compute, band, color, fromLabel, clampPct, clampFactors, clampCandidates, DEFAULTS };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Score = api;
})(typeof window !== "undefined" ? window : globalThis);
