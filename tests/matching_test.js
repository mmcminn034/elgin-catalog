// node tests/matching_test.js: attributes, region priors, output sanitizers, confidence calibration, cache key, cost estimate, prompt additions
const M = require("../assets/js/matching.js"), P = require("../assets/js/prompt.js"), fs = require("fs"); let fails = 0;
const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n, i); if (!c) fails++; };
// attributes
ok("required artifact fields are material + flaking", JSON.stringify(M.missingRequired({}, "artifact")) === JSON.stringify(["Material", "Flake scars"]));
ok("'unknown' counts as an answer", M.missingRequired({ material: "unknown", flaking: "unknown" }, "artifact").length === 0);
const c = M.clean({ material: "chert", flaking: "no flake scars visible", length_mm: "42.5", width_mm: "-3", bogus: "x", base: "not in list" }, "artifact");
ok("clean keeps valid options and numbers only", c.material === "chert" && c.length_mm === 42.5 && !("width_mm" in c) && !("bogus" in c) && !("base" in c), JSON.stringify(c));
ok("attrsText mentions owner-supplied", /OWNER|owner/i.test(M.attrsText(c, "artifact")) && /Material: chert/.test(M.attrsText(c, "artifact")));
ok("no attribute asks for coordinates or addresses", !JSON.stringify(M.ATTRS).match(/latitude|longitude|gps|address|coordinates/i));
// priors
const pr = JSON.parse(fs.readFileSync(__dirname + "/../data/learn/priors.json"));
ok("priors found for Texas", !!M.priorsFor(pr, { admin1: "Texas" })); ok("no priors outside covered regions", M.priorsFor(pr, { admin1: "Dordogne" }) === null);
ok("priors text says context only", /context only/i.test(M.priorsText(M.priorsFor(pr, { admin1: "Texas" }))));
// extras: sanitize
const ex = M.extras({ artifact_likelihood: { verdict: "nonsense", confidence_pct: 250, evidence_for: ["a", "at 30.12345, -97.12345 near"], evidence_against: [] }, diagnostic_checklist: [{ feature: "x", status: "weird", note: "n" }], photo_quality: { usable: false, issues: ["blur"] } }, 3);
ok("bad verdict -> uncertain", ex.artifact_likelihood.verdict === "uncertain"); ok("pct capped at 95", ex.artifact_likelihood.confidence_pct === 95);
ok("coordinates scrubbed", !JSON.stringify(ex).match(/30\.12345/)); ok("bad checklist status -> not_visible", ex.diagnostic_checklist[0].status === "not_visible"); ok("photo_quality.usable false kept", ex.photo_quality.usable === false);
ok("missing sections still yield safe defaults", M.extras({}, 1).artifact_likelihood.verdict === "uncertain" && Array.isArray(M.extras({}, 1).diagnostic_checklist));
// calibration
const base = () => ({ candidates: [{ name: "Pedernales", confidence_pct: 90, factors: [] }, { name: "Natural rock / geofact (not an artifact)", confidence_pct: 70 }], artifact_likelihood: {}, photo_quality: {} });
let r = base(); r.artifact_likelihood = { verdict: "likely_natural" }; let k = M.calibrate(r, { nPhotos: 4 });
ok("likely_natural caps artifact types at 35", k.candidates[0].confidence_pct === 35); ok("natural candidate untouched", k.candidates[1].confidence_pct === 70);
ok("each change is a '-' factor sourced 'calibration'", k.candidates[0].factors.some(f => f.sign === "-" && f.source === "calibration"));
r = base(); r.artifact_likelihood = { verdict: "uncertain" }; ok("uncertain caps at 60", M.calibrate(r, { nPhotos: 4 }).candidates[0].confidence_pct === 60);
r = base(); r.photo_quality = { usable: false }; ok("unusable photos cap at 45", M.calibrate(r, { nPhotos: 4 }).candidates[0].confidence_pct === 45);
r = base(); ok("single photo caps at 50", M.calibrate(r, { nPhotos: 1 }).candidates[0].confidence_pct === 50);
r = base(); ok("poor feedback history subtracts 10", M.calibrate(r, { nPhotos: 4, history: { pedernales: { n: 6, agree: 0.2 } } }).candidates[0].confidence_pct === 80);
r = base(); ok("history needs >=3 responses", M.calibrate(r, { nPhotos: 4, history: { pedernales: { n: 2, agree: 0 } } }).candidates[0].confidence_pct === 90);
r = base(); r.artifact_likelihood = { verdict: "likely_artifact" }; k = M.calibrate(r, { nPhotos: 4 }); ok("good case unchanged", k.candidates[0].confidence_pct === 90 && k.notes.length === 0);
for (const v of ["likely_natural", "uncertain", "likely_artifact"]) { r = base(); r.artifact_likelihood = { verdict: v }; r.photo_quality = { usable: false }; const o = M.calibrate(r, { nPhotos: 1, history: { pedernales: { n: 9, agree: 0.1 } } }); ok("never raises a percentage (" + v + ")", o.candidates.every((x, i) => x.confidence_pct <= r.candidates[i].confidence_pct)); }
// cache key
const a = { catalog_id: "X", kind: "artifact", photos: ["https://a/1.jpg?token=1"], record: { m: 1 }, attrs: { material: "chert" }, region: "Texas" };
ok("cache key stable", M.cacheKey(a) === M.cacheKey({ ...a })); ok("cache key ignores signed-URL query strings", M.cacheKey(a) === M.cacheKey({ ...a, photos: ["https://a/1.jpg?token=2"] }));
ok("cache key changes with attributes", M.cacheKey(a) !== M.cacheKey({ ...a, attrs: { material: "quartzite" } })); ok("cache key changes with photos", M.cacheKey(a) !== M.cacheKey({ ...a, photos: ["https://a/2.jpg"] }));
// cost estimate (public list prices read 2026-10-27; see docs/ai-costs.md)
ok("detail policy: first two photos high, rest low", [0, 1, 2, 5].map(M.detailFor).join() === "high,high,low,low");
const est = m => M.estimateCost({ model: m }).usd; ok("4o-mini per-ID between $0.005 and $0.02", est("gpt-4o-mini") > 0.005 && est("gpt-4o-mini") < 0.02, String(est("gpt-4o-mini")));
ok("gpt-4o costs more than mini", est("gpt-4o") > est("gpt-4o-mini") * 2); ok("low detail is cheaper than high", M.estimateCost({ model: "gpt-4o-mini", detail: "low" }).usd < M.estimateCost({ model: "gpt-4o-mini", detail: "high" }).usd);
ok("tile math: 4o-mini low = 2833", M.imageTokens("gpt-4o-mini", 1600, 1200, "low") === 2833); ok("tile math: 4o 1600x1200 high = 85+170*4 = 765", M.imageTokens("gpt-4o", 1600, 1200, "high") === 765, String(M.imageTokens("gpt-4o", 1600, 1200, "high")));
// prompt additions
ok("system prompt asks for artifact_likelihood + natural-rock candidate", /artifact_likelihood/.test(P.SYSTEM) && /Natural rock \/ geofact/.test(P.SYSTEM) && /diagnostic_checklist/.test(P.SYSTEM) && /photo_quality/.test(P.SYSTEM));
ok("system prompt has no Central Texas type lists (priors ride in the user message)", !/pedernales|scallorn|perdiz|bulverde/i.test(P.SYSTEM));
const t = P.buildUserText({ attrs_text: "OWNER-SUPPLIED OBSERVATIONS\nMaterial: chert", priors_text: "REGION PRIORS (context only)", history_text: "PAST FEEDBACK", record: {} }, 2);
ok("user text carries attributes, priors and history", /Material: chert/.test(t) && /REGION PRIORS/.test(t) && /PAST FEEDBACK/.test(t));
process.exit(fails ? 1 : 0);
