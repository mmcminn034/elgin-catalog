/* Rolling Oak Catalog — transparent analysis engine + local learning library.
   Scores candidates from the reference knowledge base (data/reference/*.json) and
   owner-verified examples (data/learned/learned-examples.json + this browser's IndexedDB).
   Everything runs in the browser; nothing is uploaded. Results are research possibilities, never identifications. */
(() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const KB = {}, FILES = { artifact: "points", fossil: "fossils", rock: "rocks" };
  let seedEx = [], localEx = [], db = null;
  const STOP = new Set("with from that this have been were into very some more than also each about like only near both other their there these those which while edge edges".split(" "));
  const tokens = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
  const jacc = (a, b) => { let i = 0; a.forEach(x => b.has(x) && i++); return a.size + b.size ? i / (a.size + b.size - i) : 0; };
  const num = v => { const m = String(v || "").match(/\d+(\.\d+)?/g); return m ? m.map(Number).reduce((s, x) => s + x, 0) / m.length : null; };
  const textOf = r => ["object_type", "key_features", "suggestion_1", "suggestion_2", "suggestion_3", "owner_observations", "material", "color", "condition", "hardness", "luster", "streak", "preservation", "context_notes", "geologic_period", "formation"].map(k => r[k] || "").join(" ").toLowerCase();
  const stripNeg = t => t.replace(/\b(not|no|without|never)\s+[a-z-]+(\s+[a-z-]+)?/g, " ");
  const has = (t, w) => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(t);
  const names = c => c.name.toLowerCase().split(/[\/(),]| e\.g\. /).map(s => s.trim()).filter(s => s.length > 3);
  const all = () => { const m = new Map(seedEx.map(e => [e.catalog_id, e])); localEx.forEach(e => m.set(e.catalog_id, e)); return [...m.values()]; };

  /* ---------- storage ---------- */
  const idb = (mode, fn) => new Promise((res, rej) => { if (!db) return res(null); const r = fn(db.transaction("examples", mode).objectStore("examples")); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function init() {
    await Promise.all(Object.entries(FILES).map(async ([k, f]) => { try { KB[k] = await (await fetch(`data/reference/${f}.json`, { cache: "no-cache" })).json(); } catch { KB[k] = { types: [], diagnostics: [] }; } }));
    try { seedEx = (await (await fetch("data/learned/learned-examples.json", { cache: "no-cache" })).json()).examples || []; } catch { seedEx = []; }
    try { db = await new Promise((res, rej) => { const r = indexedDB.open("rolling-oak-learning", 1); r.onupgradeneeded = () => r.result.createObjectStore("examples", { keyPath: "catalog_id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      localEx = await idb("readonly", s => s.getAll()) || []; } catch { db = null; }
  }
  function typeIds(kind, label) { const l = String(label || "").toLowerCase(); return (KB[kind]?.types || []).filter(c => names(c).some(n => l.includes(n))).map(c => c.id); }
  async function learn(r, kind, label, source, extra) {
    if (!label) return null;
    const e = { catalog_id: r.catalog_id, category: kind, confirmed_type: label, type_ids: typeIds(kind, label),
      features: [r.object_type, r.key_features, r.owner_observations, r.material].filter(Boolean).join(" "), length_mm: r.length_mm || "", material: r.material || "",
      confirmed_on: new Date().toLocaleDateString("en-CA"), source, ...(extra || {}) };
    await idb("readwrite", s => s.put(e)); localEx = await idb("readonly", s => s.getAll()) || [...localEx.filter(x => x.catalog_id !== e.catalog_id), e]; return e;
  }
  async function forget(id) { await idb("readwrite", s => s.delete(id)); localEx = await idb("readonly", s => s.getAll()) || []; }
  const exportJSON = () => JSON.stringify({ format: "rolling-oak-learned-examples/v1", exported: new Date().toISOString(), note: "Owner-verified identifications. Commit to data/learned/learned-examples.json to share across devices.", examples: all() }, null, 2);
  async function importJSON(text) { const d = JSON.parse(text), ex = (d.examples || d).filter(e => e && e.catalog_id && e.confirmed_type);
    for (const e of ex) await idb("readwrite", s => s.put(e)); localEx = await idb("readonly", s => s.getAll()) || localEx; return ex.length; }
  const counts = () => { const c = {}; all().forEach(e => (e.type_ids.length ? e.type_ids : ["(" + e.confirmed_type + ")"]).forEach(id => c[id] = (c[id] || 0) + 1)); return c; };

  /* ---------- scoring ---------- */
  function rank(r, kind) {
    const kb = KB[kind] || { types: [] }, raw = textOf(r), t = stripNeg(raw), sugg = [r.suggestion_1, r.suggestion_2, r.suggestion_3].map(s => String(s || "").toLowerCase()), L = num(r.length_mm), me = tokens(textOf({ ...r, suggestion_1: "", suggestion_2: "", suggestion_3: "" })), cnt = counts();
    return kb.types.map(c => { let s = 0; const why = [], against = [];
      const si = sugg.findIndex(x => x && names(c).some(n => x.includes(n))); if (si >= 0) { s += [4, 2.5, 1.5][si]; why.push(`listed as your #${si + 1} possibility`); }
      const hit = c.traits.filter(w => has(t, w)); s += Math.min(hit.length, 5); if (hit.length) why.push("matches traits: " + hit.join(", "));
      const miss = (c.excludes || []).filter(w => has(t, w)); s -= 2 * miss.length; if (miss.length) against.push("conflicts with: " + miss.join(", "));
      if (L && c.length_mm) { if (L >= c.length_mm[0] && L <= c.length_mm[1]) { s += 1; why.push(`length ~${Math.round(L)} mm is within the typical ${c.length_mm[0]}–${c.length_mm[1]} mm`); } else { s -= 1.5; against.push(`length ~${Math.round(L)} mm is outside the typical ${c.length_mm[0]}–${c.length_mm[1]} mm`); } }
      else if (c.length_mm && kind === "artifact") against.push("size not yet measured, so size fit is unknown");
      const ex = all().filter(e => e.category === kind && e.type_ids.includes(c.id)), matches = [];
      ex.forEach(e => { if (e.catalog_id === r.catalog_id) { s += 3; matches.push({ id: e.catalog_id, self: true }); return; } const j = jacc(me, tokens(e.features)); if (j >= 0.12) { s += Math.min(3, 6 * j); matches.push({ id: e.catalog_id, sim: j }); } });
      return { c, score: Math.round(s * 10) / 10, why, against, matches, verified: cnt[c.id] || 0 };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  const confLabel = (top, second) => !top ? "Insufficient data" : top.score >= 7 && top.score - (second?.score || 0) >= 2 ? "Moderate" : top.score >= 4 ? "Low-moderate" : "Low";

  /* ---------- rich analysis ---------- */
  const REFS = {
    artifact: [["Texas Beyond History", "https://www.texasbeyondhistory.net"], ["Texas Historical Commission", "https://thc.texas.gov/"], ["TxDOT: publishes Central Texas archeology reports and typology-based chronologies", "https://www.txdot.gov/"], ["Lohse, Black & Cholak 2014, Toward an Improved Archaic Radiocarbon Chronology for Central Texas", "https://www.academia.edu/9156814/Toward_an_Improved_Archaic_Radiocarbon_Chronology_for_Central_Texas"], ["Turner, Hester & McReynolds, Stone Artifacts of Texas Indians (field guide, book)", "https://www.texasbeyondhistory.net/"], ["Texas Archeological Research Laboratory (TARL)", "https://liberalarts.utexas.edu/tarl/"]],
    fossil: [["UT Bureau of Economic Geology", "https://www.beg.utexas.edu/"], ["Paleontological Society", "https://www.paleosoc.org/"], ["Texas Memorial Museum / Non-vertebrate Paleontology Lab", "https://www.jsg.utexas.edu/npl/"]],
    rock: [["Mindat.org mineral database", "https://www.mindat.org/"], ["UT Bureau of Economic Geology", "https://www.beg.utexas.edu/"], ["Texas Memorial Museum / Non-vertebrate Paleontology Lab", "https://www.jsg.utexas.edu/npl/"]] };
  const VIEWS = { artifact: ["front", "back", "edge", "base", "scale"], fossil: ["front", "back", "edge", "scale"], rock: ["front", "back", "scale"] };
  function checklist(r, kind) { const raw = textOf(r);
    return (KB[kind]?.diagnostics || []).map(([f, p, a]) => { const st = a && new RegExp(a, "i").test(raw) ? "absent" : new RegExp(p, "i").test(stripNeg(raw)) ? "present" : "unknown"; return [f, st]; }); }
  function sec(title, body, open) { return `<details class="an" ${open ? "open" : ""}><summary>${title}</summary><div>${body}</div></details>`; }
  function render(r, kind) {
    const rk = rank(r, kind), top = rk[0], conf = confLabel(rk[0], rk[1]), unk = '<span class="unk">Unknown</span>', kb = KB[kind] || {}, cnt = counts();
    const ident = rk.length ? `<ol class="cands">${rk.slice(0, 3).map((x, i) => `<li><div class="cand-h"><strong>${esc(x.c.name)}</strong><span class="chip">score ${x.score}</span>${x.verified ? `<span class="chip ver">✓ ${x.verified} verified example${x.verified > 1 ? "s" : ""}</span>` : ""}</div>
      ${x.why.length ? `<p class="why"><strong>Why:</strong> ${esc(x.why.join("; "))}.</p>` : ""}${x.against.length ? `<p class="whynot"><strong>Why not / caution:</strong> ${esc(x.against.join("; "))}.</p>` : ""}
      ${x.matches.length ? `<p class="match">🧠 ${x.matches.some(m => m.self) ? "This find is a verified example of this type. " : ""}${x.matches.filter(m => !m.self).length ? `Matches ${x.matches.filter(m => !m.self).length} of your verified examples: ${x.matches.filter(m => !m.self).map(m => `${esc(m.id)} (${Math.round(m.sim * 100)}% feature overlap)`).join(", ")}` : ""}</p>` : ""}</li>`).join("")}</ol>
      <p class="help">Engine confidence: <strong>${conf}</strong>. Capped at Moderate: photo-and-notes analysis cannot confirm an identification.</p>` : `<p>${unk}: no reference types match the recorded features yet. Add key features, measurements and photos.</p>`;
    const age = kind === "rock" ? `<p>Geologic age of the source rock: ${top?.c.formation ? esc(top.c.formation) : unk}</p>` : top ? (top.c.generic ? `<p>${esc(top.c.name)} forms occur in many periods, so this find is <strong>not datable from form alone</strong>.</p>` : `<p>If ${esc(top.c.name)}: <strong>${esc(top.c.period)}</strong>, ${esc(top.c.dates)} (approximate).</p>`) + (rk[1] && !rk[1].c.generic && rk[1].c.period !== top.c.period ? `<p class="muted">Alternative ${esc(rk[1].c.name)}: ${esc(rk[1].c.period)}, ${esc(rk[1].c.dates)}.</p>` : "") : `<p>${unk}</p>`;
    const rocks = KB.rock?.types || [], mt = String(r.material || "").toLowerCase(), lith = kind === "rock" ? top?.c : rocks.find(x => names(x).some(n => mt.includes(n.split(" ")[0])));
    const material = `<p>Recorded material: <strong>${esc(r.material || "not recorded")}</strong>${/\?|likely|or /i.test(r.material || "") ? " (owner-flagged as uncertain)" : ""}.</p>${lith ? `<p>Reference: ${esc(lith.name)}, hardness ${esc(lith.hardness)}, ${esc(lith.luster.toLowerCase())} luster, ${esc(lith.streak.toLowerCase())} streak. ${esc(lith.formation)}</p>` : ""}${kind === "artifact" ? `<p>Heat treatment: ${/heat/i.test(textOf(r)) ? "noted in record" : unk + " (look for a glossy luster or pink/red color change on flake scars)"}. Specific chert source: ${unk}; sourcing needs expert comparison.</p>` : ""}`;
    const t = textOf(r), proc = kind === "artifact" ? `<ul>${[/bifac|biface/.test(t) && "Bifacially flaked (worked on both faces).", /retouch/.test(t) && "Edges show secondary retouch (fine shaping/resharpening).", /flake scars/.test(t) && "Multiple flake scars indicate deliberate knapping.", /cortex/.test(t) && "Cortex present: made from a nodule or cobble, not far reduced.", /snap|break/.test(t) && "Snap break: common from use, manufacture or trampling; cause unknown.", /serrat/.test(t) && "Serrated edge, deliberately shaped.", /notch/.test(t) && "Notching for hafting or a spokeshave-style working edge."].filter(Boolean).map(x => `<li>${x}</li>`).join("") || `<li>${unk}: describe flaking pattern and edges.</li>`}</ul>`
      : kind === "fossil" ? `<p>Preservation: ${r.preservation ? esc(r.preservation) : unk}. ${top ? "Typical setting for " + esc(top.c.name) + ": " + esc(top.c.dates) + "." : ""}</p>` : `<p>${top?.c.formation ? esc(top.c.formation) : unk}</p>`;
    const use = kind === "artifact" ? `<p>Function: ${top ? (top.c.generic ? esc(top.c.name) + " suggests cutting, scraping or tool-making activity." : "Dart/arrow points were hafted projectile tips and were often also used and resharpened as knives.") : unk}</p><p>Use-wear: ${unk}. Polish, edge rounding and micro-chipping need magnification (10× loupe or better) to assess.</p><p>Condition: ${esc(r.condition || "not recorded")}.</p>`
      : kind === "fossil" ? `<p>Completeness: ${esc(r.condition || "not recorded")}. Wear/abrasion from stream transport: ${/worn|rounded|abraded/.test(t) ? "noted" : unk}.</p>` : `<p>Weathering / rind: ${/cortex|rind|weather/.test(t) ? "noted" : unk}.</p>`;
    const region = `<p>${esc(kb.context || "")}</p>${kind === "fossil" || kind === "rock" ? `<p class="muted">${esc(kb.meta?.note || "")}</p>` : ""}`;
    const comp = top ? `<ul>${(top.c.compare || []).map(([n, d]) => `<li><strong>${esc(n)}</strong>: ${esc(d)}</li>`).join("")}${rk.slice(1, 3).map(x => `<li><strong>${esc(x.c.name)}</strong> (scored ${x.score})</li>`).join("")}</ul>` : `<p>${unk}</p>`;
    const cl = `<table class="chk"><thead><tr><th>Feature</th><th>Status</th></tr></thead><tbody>${checklist(r, kind).map(([f, s]) => `<tr><td>${esc(f)}</td><td><span class="st ${s}">${s === "present" ? "✓ Present" : s === "absent" ? "✕ Absent" : "? Unknown"}</span></td></tr>`).join("")}</tbody></table><p class="help">Detected from the record's text; “Unknown” means the record doesn't say yet.</p>`;
    const have = new Set((r.photos || []).map(p => (p.view || p.tag || "").toLowerCase())), gaps = [
      !/^measured/i.test(r.measure_method || "") && "Measure length, width and thickness with a caliper or flat ruler (current: " + esc(r.measure_method || "not measured") + ").",
      !r.weight_g && "Weigh it on a kitchen or jewelry scale (grams).",
      ...VIEWS[kind].filter(v => !have.has(v)).map(v => `Take a <strong>${v}</strong> view${v === "scale" ? " with a ruler beside the piece" : ""}.`),
      kind === "artifact" && "Close-up of the base/stem edges under raking light (grinding vs chipping).",
      kind === "fossil" && "Close-up of any suture lines, ribbing or hinge area; note the rock it came from.",
      kind === "rock" && "Do and record field tests: scratch glass (hardness), streak on unglazed tile, vinegar fizz test.",
      r.open_questions && "Owner open question: " + esc(r.open_questions)].filter(Boolean);
    const refs = `<ul>${REFS[kind].map(([n, u]) => `<li><a href="${u}" rel="noopener" target="_blank">${esc(n)}</a></li>`).join("")}</ul>`;
    const confirm = `<div class="confirm"><h4>Confirm or correct the identification</h4><p class="help">Your confirmation becomes a verified example the engine learns from (stored in this browser; export it from About → How the AI learns).</p><div class="row"><label class="field grow"><span>Identification you confirm</span><input id="cfType" list="cfList" value="${esc(rk[0]?.c.name || r.suggestion_1 || "")}"></label><datalist id="cfList">${(kb.types || []).map(c => `<option value="${esc(c.name)}">`).join("")}</datalist><button type="button" class="btn primary" data-confirm>Save as verified</button>${all().some(e => e.catalog_id === r.catalog_id) ? '<button type="button" class="btn" data-forget>Remove verified example</button>' : ""}</div>${all().find(e => e.catalog_id === r.catalog_id) ? `<p class="match">✓ Verified example: ${esc(all().find(e => e.catalog_id === r.catalog_id).confirmed_type)}</p>` : ""}</div>`;
    return `<div class="analysis">${sec("1. Identification: ranked candidates", ident, true)}${sec("2. Age / period", age)}${sec("3. Material / lithology", material)}${sec(kind === "artifact" ? "4. Manufacture" : "4. Formation process", proc)}${sec(kind === "artifact" ? "5. Use-wear & function" : "5. Preservation & condition", use)}${sec("6. Central Texas context", region)}${sec("7. Comparable types & how to tell them apart", comp)}${sec("8. Diagnostic features checklist", cl, true)}${sec("9. Documentation gaps & next photos", `<ul>${gaps.map(g => `<li>${g}</li>`).join("")}</ul>`, true)}${sec("10. References & further reading", refs)}</div>${confirm}`;
  }
  function suggestHtml(r, kind) { const rk = rank(r, kind); if (!rk.length) return '<p class="help">No reference matches yet. Add more key features (outline, base, notches, texture).</p>';
    return `<ol class="cands">${rk.slice(0, 3).map(x => `<li><strong>${esc(x.c.name)}</strong> <span class="chip">score ${x.score}</span>${x.verified ? ` <span class="chip ver">✓ ${x.verified} verified</span>` : ""}<br><span class="muted">${esc(x.why.join("; ") || "weak match")}${x.against.length ? " · caution: " + esc(x.against.join("; ")) : ""}</span>${x.matches.filter(m => !m.self).length ? `<br><span class="match">🧠 Matches ${x.matches.length} of your verified examples: ${x.matches.map(m => esc(m.id)).join(", ")}</span>` : ""}</li>`).join("")}</ol><button type="button" class="btn" id="useSuggest">Use these as my 3 possibilities</button>`; }
  function panelHtml() { const ex = all(), c = counts(), name = id => { for (const k in KB) { const t = (KB[k].types || []).find(x => x.id === id); if (t) return t.name; } return id; };
    return `<p><strong>${ex.length}</strong> verified example${ex.length === 1 ? "" : "s"} (${seedEx.length} shared/published, ${localEx.length} in this browser).</p>
      ${Object.keys(c).length ? `<table class="chk"><thead><tr><th>Type</th><th>Verified examples</th></tr></thead><tbody>${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([id, n]) => `<tr><td>${esc(name(id))}</td><td>${n}</td></tr>`).join("")}</tbody></table>` : ""}
      <ul class="hist">${ex.map(e => `<li><strong>${esc(e.catalog_id)}</strong>: ${esc(e.confirmed_type)} <span class="muted">(${esc(e.confirmed_on)}, ${esc(e.source)})</span></li>`).join("")}</ul>
      <div class="row"><button type="button" class="btn" id="exLearn">Export learned-examples.json</button><label class="btn">Import learned-examples.json<input type="file" id="imLearn" accept="application/json,.json" class="sr-only"></label></div>`; }
  function setShared(list) { const m = new Map(seedEx.map(e => [e.catalog_id, e])); list.forEach(e => m.set(e.catalog_id, e)); seedEx = [...m.values()]; }
  window.Analysis = { init, setShared, checklist, rank, render, suggestHtml, panelHtml, learn, forget, exportJSON, importJSON, all, kb: () => KB };
})();
