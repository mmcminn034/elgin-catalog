// node tests/ai_schema_test.js : Stage 3 clamping (no network, no OpenAI). 0-100% with the AI ceiling of 95.
const A = require("../supabase/functions/_shared/ai_schema.js"); let fails = 0;
const chk = (n, ok, i = "") => { console.log((ok ? "PASS " : "FAIL ") + n, i); if (!ok) fails++; };
const r = A.clampClassification({
  classification: { category: { value: "Rocks", confidence_pct: 99 }, type: { value: "Tube agate", confidence: "very high", why: "tubes", factors: [{ sign: "+", reason: "tubes visible in photo 1" }, { sign: "-", reason: "found at 30.3521, -97.3702" }] }, material: { value: "Chalcedony", confidence_pct: 62 }, era: { geologic_period: "Miocene", confidence: "Low" } },
  origin: [{ region: "Graveyard Point, Idaho", setting: "Miocene tuff seams", confidence_pct: 97 }, { region: "30.3521, -97.3702", confidence: "Moderate" }, { lat: 30.35, lon: -97.37, region: "Elgin" },
           { region: "1234 Oak Ln, Elgin", confidence: "Low" }, { setting: "N 30.35 W 97.37" }] });
chk("category normalized to rock", r.classification.category.value === "rock");
chk("99% capped to 95 (High band)", r.classification.category.confidence_pct === 95 && r.classification.category.confidence === "High");
chk("old label 'very high' -> 85", r.classification.type.confidence_pct === 85);
chk("62% kept, Moderate band", r.classification.material.confidence_pct === 62 && r.classification.material.confidence === "Moderate");
chk("factors kept, coordinate factor dropped", r.classification.type.factors.length === 1 && r.classification.type.factors[0].sign === "+", JSON.stringify(r.classification.type.factors));
chk("era kept with pct", r.classification.era.geologic_period === "Miocene" && r.classification.era.confidence_pct === 20);
chk("only the coarse origin survives", r.origin.length === 1 && r.origin[0].region === "Graveyard Point, Idaho", JSON.stringify(r.origin));
chk("origin pct capped at 95", r.origin[0].confidence_pct === 95);
chk("flat object_type string accepted", A.clampClassification({ classification: { object_type: "Dart point" } }).classification.type.value === "Dart point");
const e = A.clampClassification({ classification: { category: { value: "spaceship" } }, origin: "nope" });
chk("bad category -> null", e.classification.category === null); chk("bad origin -> []", Array.isArray(e.origin) && !e.origin.length);
chk("empty input safe", A.clampClassification(null).origin.length === 0);
chk("legacy cap() label helper", A.cap("High") === "High" && A.cap("Moderate") === "Moderate" && A.cap("") === "Low");
console.log(fails ? `${fails} FAIL` : "ALL PASS"); process.exit(fails ? 1 : 0);
