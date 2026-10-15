// node tests/ai_schema_test.js : Stage 3 clamping (no network, no OpenAI)
const A = require("../supabase/functions/_shared/ai_schema.js"); let fails = 0;
const chk = (n, ok, i = "") => { console.log((ok ? "PASS " : "FAIL ") + n, i); if (!ok) fails++; };
const r = A.clampClassification({
  classification: { category: { value: "Rocks", confidence: "High" }, type: { value: "Tube agate", confidence: "very high", why: "tubes" }, material: { value: "Chalcedony", confidence: "Moderate" }, era: { geologic_period: "Miocene", confidence: "Low" } },
  origin: [{ region: "Graveyard Point, Idaho", setting: "Miocene tuff seams", confidence: "High" }, { region: "30.3521, -97.3702", confidence: "Moderate" }, { lat: 30.35, lon: -97.37, region: "Elgin" },
           { region: "1234 Oak Ln, Elgin", confidence: "Low" }, { setting: "N 30.35 W 97.37" }] });
chk("category normalized to rock", r.classification.category.value === "rock");
chk("High capped to Moderate", r.classification.category.confidence === "Moderate" && r.classification.type.confidence === "Moderate");
chk("era kept", r.classification.era.geologic_period === "Miocene");
chk("only the coarse origin survives", r.origin.length === 1 && r.origin[0].region === "Graveyard Point, Idaho", JSON.stringify(r.origin));
chk("origin confidence capped", r.origin[0].confidence === "Moderate");
const e = A.clampClassification({ classification: { category: { value: "spaceship" } }, origin: "nope" });
chk("bad category -> null", e.classification.category === null); chk("bad origin -> []", Array.isArray(e.origin) && !e.origin.length);
chk("empty input safe", A.clampClassification(null).origin.length === 0);
process.exit(fails ? 1 : 0);
