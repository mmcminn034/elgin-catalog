// node tests/prompt_test.js — external reference retrieval + AI output clamp
const P = require("../assets/js/prompt.js"), S = require("../assets/js/score.js"), fs = require("fs"); let fails = 0;
const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n, i); if (!c) fails++; };
const pub = JSON.parse(fs.readFileSync(__dirname + "/../data/reference/public-types.json")), cat = JSON.parse(fs.readFileSync(__dirname + "/../data/catalog.json"));
const r = cat.find(x => x.catalog_id === "ELG-001");
const tx = P.rankReferences(r, pub.types, pub.meta.trait_patterns, { k: 5, region: { admin1: "Texas", country: "US", continent: "North America" }, category: "artifact" });
ok("top 5 references returned", tx.length === 5, tx.map(x => x.entry.name + ":" + x.score).join(", "));
ok("Nolan or Travis retrieved for ELG-001", tx.some(x => /nolan|travis/i.test(x.entry.name)));
const fr = P.rankReferences(r, pub.types, pub.meta.trait_patterns, { k: 5, region: { admin1: "Dordogne", country: "FR", continent: "Europe" }, category: "artifact" });
ok("region is a bonus, not a filter (still worldwide)", fr.length > 0 && fr.some(x => /nolan|travis/i.test(x.entry.name)));
const b = P.refBrief(tx[0]); ok("brief carries attribution + license", /retrieved/.test(b.source) && /http/.test(b.source));
const text = P.buildUserText({ external_references: [b], record: {} }, 3); ok("user text labels EXTERNAL REFERENCE", text.includes("EXTERNAL REFERENCE (published typology, not the find)") && text.includes("photo_index 0..2"));
ok("system prompt region-neutral", !/Central Texas/.test(P.SYSTEM) && /do not assume/.test(P.SYSTEM) && /confidence_pct/.test(P.SYSTEM));
const c = S.clampCandidates([{ name: "A", confidence_pct: 99, factors: [{ sign: "+", reason: "found at 30.1234, -97.5678", source: "x" }] }, { name: "B", confidence: "Moderate" }, { name: "C", confidence_pct: "abc" }, { name: "D" }, { name: "E" }]);
ok("AI pct capped at 95", c[0].confidence_pct === 95 && c[0].confidence === "High"); ok("coordinates scrubbed from factors", !/30\.1234/.test(c[0].factors[0].reason));
ok("old label accepted", c[1].confidence_pct === 65); ok("garbage -> low default", c[2].confidence_pct === 20); ok("max 3 candidates", c.length === 3);
console.log(fails ? `${fails} FAIL` : "ALL PASS"); process.exit(fails ? 1 : 0);
