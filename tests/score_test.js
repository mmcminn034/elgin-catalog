// node tests/score_test.js — scoring math: caps, 100% rule, high/low cases, label back-compat
const S = require("../assets/js/score.js"); let fails = 0;
const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n, i); if (!c) fails++; };
const high = S.compute({ traitHits: 5, size: "in", measured: true, regionMatch: true, verifiedAgree: 2, feedback: { match: 2 }, keeps: 1, margin: 4, photos: 6, diagnostics: 4, sources: [{ name: "projectilepoints.net", url: "https://www.projectilepoints.net/Points/Nolan.html" }] });
ok("high case reaches the 95 cap", high.pct === 95 && high.capped, high.pct); ok("high band High + green", high.band === "High" && high.color === "green");
ok("cap factor explained", high.factors.some(f => /Capped at 95/.test(f.label)));
const ver = S.compute({ traitHits: 5, size: "in", measured: true, margin: 4, photos: 6, ownerVerified: true, refAgrees: true }); ok("owner Verified + agrees -> 100", ver.pct === 100);
const verNo = S.compute({ traitHits: 5, size: "in", measured: true, margin: 4, photos: 6, ownerVerified: true, refAgrees: false }); ok("Verified but disagrees stays <= 95", verNo.pct <= 95, verNo.pct);
const low = S.compute({ traitHits: 0, size: "out", estimateOnly: true, conflicts: 2, margin: 0.3, photos: 1, feedback: { wrong: 2 } }); ok("low case near 1", low.pct <= 5 && low.color === "red", low.pct);
const mid = S.compute({ traitHits: 3, size: "unknown", margin: 1.6, photos: 3 }); ok("mid case 40-60", mid.pct >= 40 && mid.pct <= 60, mid.pct + " " + mid.band);
ok("factors sum explains score", Math.abs(mid.factors.reduce((a, f) => a + (f.sign === "+" ? f.pts : -f.pts), 0) - mid.pct) <= 1);
const ai = S.compute({ mode: "ai", aiPct: 99, traitHits: 5, size: "in", measured: true }); ok("AI capped at 95", ai.pct === 95);
ok("config override", S.compute({ traitHits: 5, size: "in", measured: true, regionMatch: true, verifiedAgree: 3, margin: 4, photos: 6, diagnostics: 4 }, { rulesCap: 90 }).pct === 90);
ok("labels map back", S.fromLabel("Moderate (capped)") === 65 && S.fromLabel("Low-moderate") === 40 && S.fromLabel("Low") === 20 && S.fromLabel("72%") === 72 && S.fromLabel("") === null);
ok("bands", S.band(85) === "High" && S.band(65) === "Moderate" && S.band(35) === "Low-moderate" && S.band(10) === "Low");
console.log(fails ? `${fails} FAIL` : "ALL PASS"); process.exit(fails ? 1 : 0);
