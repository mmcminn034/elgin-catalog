/* Stage 3: server-side clamping for autonomous classification + likely origin.
   Pure and dependency-free so it runs in the analyze-find edge function (Deno) and in node tests (tests/ai_schema_test.js).
   Rules: confidence is a 0-100 percentage with the AI ceiling (95, same as Score.DEFAULTS.aiCap); old text labels are accepted
   and mapped (High 85, Moderate 65, Low-moderate 40, Low 20) and then capped; each field carries a band label for backward
   compatibility plus sanitized factors. Origin is region / geologic setting only (anything that looks like coordinates, a street
   address, or a lat/lon key is dropped); strings are length-limited; unknown categories fall back to null. */
(function (root) {
  "use strict";
  const AI_CAP = 95, LEVELS = ["Low", "Low-moderate", "Moderate", "High"];
  const LABEL = { "very-high": 85, "high": 85, "moderate": 65, "medium": 65, "low-moderate": 40, "moderate-low": 40, "low": 20, "very-low": 8 };
  const band = p => p >= 80 ? "High" : p >= 50 ? "Moderate" : p >= 30 ? "Low-moderate" : "Low";
  const pct = (v, lab) => { let p = typeof v === "number" ? v : /^\s*\d/.test(String(v ?? "")) ? parseFloat(v) : null;
    if (p == null || isNaN(p)) { const t = String(lab ?? v ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-"); p = LABEL[t] != null ? LABEL[t] : 20; }
    return Math.round(Math.max(0, Math.min(AI_CAP, p))); };
  const cap = c => band(pct(c)); // legacy helper: label in -> capped band label out
  const COORD = /-?\d{1,3}\.\d{2,}\s*°?\s*[,;\s]\s*-?\d{1,3}\.\d{2,}|\d{1,3}\s*°\s*\d{1,2}\s*['′]|\b[NS]\s*\d{1,2}\.\d+|\b\d{1,3}\.\d{3,}\b|\b(lat|lon|lng|latitude|longitude|gps|utm)\b/i;
  const ADDR = /^\s*\d+\s+\w|\b\d{2,6}\s+[A-Za-z]+\s+(st|street|rd|road|ave|avenue|ln|lane|dr|drive|hwy|highway|blvd|ct|court|way)\b/i;
  const coarse = s => { s = String(s ?? "").trim().slice(0, 120); return s && !COORD.test(s) && !ADDR.test(s) ? s : ""; };
  const str = (s, n) => String(s ?? "").trim().slice(0, n);
  const factors = fs => (Array.isArray(fs) ? fs : []).slice(0, 6).map(f => ({ sign: f && f.sign === "-" ? "-" : "+", reason: coarse(f && (f.reason || f.label)) ? str(f.reason || f.label, 160) : "", source: f && f.source ? str(f.source, 120) : null })).filter(f => f.reason);
  const conf = o => { const p = pct(o.confidence_pct, o.confidence); return { confidence_pct: p, confidence: band(p), factors: factors(o.factors) }; };
  const CATS = ["artifact", "fossil", "rock"];
  const field = (o, n = 120) => { if (typeof o === "string") o = { value: o }; if (!o || typeof o !== "object") return null; const value = str(o.value ?? o.name, n); return value ? { value, ...conf(o), why: str(o.why, 400) } : null; };
  function clampClassification(res) {
    res = res && typeof res === "object" ? res : {};
    const c = res.classification && typeof res.classification === "object" ? res.classification : {};
    const cat = field(c.category, 20); if (cat) { cat.value = cat.value.toLowerCase().replace(/s$/, "").replace(/^rocks? ?(&|and)? ?minerals?$|^mineral$/, "rock"); if (!CATS.includes(cat.value)) cat.value = null; }
    const era = c.era && typeof c.era === "object" ? { human_period: str(c.era.human_period, 80) || null, geologic_period: str(c.era.geologic_period, 80) || null, range: str(c.era.range, 80) || null, ...conf(c.era), why: str(c.era.why, 400) } : null;
    const classification = { category: cat && cat.value ? cat : null, type: field(c.type || c.object_type), material: field(c.material), era: era && (era.human_period || era.geologic_period || era.range) ? era : null };
    const origin = (Array.isArray(res.origin) ? res.origin : []).slice(0, 3).map(o => {
      if (!o || typeof o !== "object") return null;
      if (Object.keys(o).some(k => /^(lat|lon|lng|latitude|longitude|coords?|gps)$/i.test(k))) return null;
      const region = coarse(o.region), setting = coarse(o.setting); if (!region && !setting) return null;
      return { region: region || null, setting: setting || null, ...conf(o), why: coarse(o.why) ? str(o.why, 300) : "", source: "AI suggestion" };
    }).filter(Boolean);
    return { classification, origin };
  }
  const api = { clampClassification, cap, pct, band, coarse, LEVELS, AI_CAP };
  root.AiSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
