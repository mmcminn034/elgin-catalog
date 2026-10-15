// Assemble the exact analyze-find model input offline (same shared modules as the edge function).
// node tools/reference/prompt_example.js <request-body.json> <verified_examples.json> > ai_prompt_example.txt
const fs = require("fs"), P = require("../../assets/js/prompt.js"), R = require("../../assets/js/retrieve.js");
const body = JSON.parse(fs.readFileSync(process.argv[2])), ex = JSON.parse(fs.readFileSync(process.argv[3]));
const pub = JSON.parse(fs.readFileSync(__dirname + "/../../data/reference/public-types.json")), SITE = "https://unearthedfinds.com/";
const target = { ...(body.record || {}), catalog_id: body.catalog_id, category: body.kind, region: body.region };
const top = R.rankSimilar(target, ex.length ? ex : body.examples || [], { k: 3 });
const similar = top.map(t => ({ catalog_id: t.example.catalog_id, confirmed_type: t.example.confirmed_type, region: t.example.region, era: t.example.era, material: t.example.material, length_mm: t.example.length_mm, notes: t.example.notes || t.example.features, why_similar: t.why, photo: SITE + "images/" + t.example.catalog_id + "/01.jpg" }));
const extRefs = P.rankReferences({ ...(body.record || {}) }, pub.types, pub.meta.trait_patterns, { k: 5, region: body.region_hint || {}, category: body.kind, hintNames: body.rules_top || [] }).map(P.refBrief);
const context = { external_references: extRefs, reference_status: "ok", kind: body.kind, record: body.record, region: target.region, region_check: body.region_check ?? null, reference_types: body.kb, checklist_features: body.checklist, similar_verified_examples: similar };
const photos = (body.photos || []).slice(0, 6), parts = [P.buildUserText(context, photos.length)];
photos.forEach((p, i) => { parts.push(`photo_index ${i}: ${p.label || "photo"}`, `[image_url] ${p.url}`); });
similar.forEach(x => parts.push(`REFERENCE (not the find; do not mark): ${x.catalog_id}, verified as ${x.confirmed_type}`, `[image_url] ${x.photo}`));
process.stdout.write(`# analyze-find model input for ${body.catalog_id}, assembled ${new Date().toISOString().slice(0, 10)} from the preview/reference-layer code\n# (prompt.js SYSTEM + buildUserText; verified examples = live verified_examples rows for this category; references = data/reference/public-types.json).\n# Images are sent as image_url parts; shown here as [image_url] lines. Model call: temperature 0.2, response_format json_object (see index.ts); output is clamped server-side by score.js clampCandidates.\n\n===== SYSTEM =====\n${P.SYSTEM}\n\n===== USER (content parts in order) =====\n${parts.join("\n")}\n`);
