/* Stage 3: server-side clamping for autonomous classification + likely origin.
   Pure and dependency-free so it runs in the analyze-find edge function (Deno) and in node tests (tests/ai_schema_test.js).
   Rules: confidence capped at Moderate; origin is region / geologic setting only (anything that looks like coordinates,
   a street address, or a lat/lon key is dropped); strings are length-limited; unknown categories fall back to null. */
(function (root) {
  "use strict";
  const LEVELS = ["Low", "Low-moderate", "Moderate"];
  const cap = c => { const t = String(c || "").toLowerCase().replace(/[\s_]+/g, "-"); return t === "moderate" || t === "high" || t === "very-high" ? "Moderate" : t === "low-moderate" || t === "medium" ? "Low-moderate" : "Low"; };
  const COORD = /-?\d{1,3}\.\d{2,}\s*°?\s*[,;\s]\s*-?\d{1,3}\.\d{2,}|\d{1,3}\s*°\s*\d{1,2}\s*['′]|\b[NS]\s*\d{1,2}\.\d+|\b\d{1,3}\.\d{3,}\b|\b(lat|lon|lng|latitude|longitude|gps|utm)\b/i;
  const ADDR = /^\s*\d+\s+\w|\b\d{2,6}\s+[A-Za-z]+\s+(st|street|rd|road|ave|avenue|ln|lane|dr|drive|hwy|highway|blvd|ct|court|way)\b/i;
  const coarse = s => { s = String(s ?? "").trim().slice(0, 120); return s && !COORD.test(s) && !ADDR.test(s) ? s : ""; };
  const str = (s, n) => String(s ?? "").trim().slice(0, n);
  const CATS = ["artifact", "fossil", "rock"];
  const field = (o, n = 120) => { if (!o || typeof o !== "object") return null; const value = str(o.value ?? o.name, n); return value ? { value, confidence: cap(o.confidence), why: str(o.why, 400) } : null; };
  function clampClassification(res) {
    res = res && typeof res === "object" ? res : {};
    const c = res.classification && typeof res.classification === "object" ? res.classification : {};
    const cat = field(c.category, 20); if (cat) { cat.value = cat.value.toLowerCase().replace(/s$/, "").replace(/^rocks? ?(&|and)? ?minerals?$|^mineral$/, "rock"); if (!CATS.includes(cat.value)) cat.value = null; }
    const era = c.era && typeof c.era === "object" ? { human_period: str(c.era.human_period, 80) || null, geologic_period: str(c.era.geologic_period, 80) || null, range: str(c.era.range, 80) || null, confidence: cap(c.era.confidence), why: str(c.era.why, 400) } : null;
    const classification = { category: cat && cat.value ? cat : null, type: field(c.type), material: field(c.material), era: era && (era.human_period || era.geologic_period || era.range) ? era : null };
    const origin = (Array.isArray(res.origin) ? res.origin : []).slice(0, 3).map(o => {
      if (!o || typeof o !== "object") return null;
      if (Object.keys(o).some(k => /^(lat|lon|lng|latitude|longitude|coords?|gps)$/i.test(k))) return null;
      const region = coarse(o.region), setting = coarse(o.setting); if (!region && !setting) return null;
      return { region: region || null, setting: setting || null, confidence: cap(o.confidence), why: coarse(o.why) ? str(o.why, 300) : "", source: "AI suggestion" };
    }).filter(Boolean);
    return { classification, origin };
  }
  const api = { clampClassification, cap, coarse, LEVELS };
  root.AiSchema = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
