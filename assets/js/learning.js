/* Rolling Oak Stage 1: feedback loop, verified references, accuracy signals, retrieval panel,
   3-level visibility, clean public find page and share menu. Research suggestions only. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DISCLAIMER = "Research suggestions only, not identifications. No authenticity or value claims. Confidence is capped at Moderate.";
  const REGION = C.defaultRegion || "Bastrop County, Texas";
  const VERDICTS = { match: ["👍", "Matches well"], close: ["🤏", "Close but not quite"], wrong: ["👎", "Wrong ID"] };
  const st = () => (window.Cloud ? Cloud.state() : { user: null });
  const canEdit = () => { const s = st(); if (!s.user) return !s.online; return window.Features && Features.isEditor ? Features.isEditor() : false; };
  /* public region: county / general area only, never coordinates */
  const coarse = t => t && !/\d+\.\d{2,}/.test(t) && !/^\s*\d+\s+\w/.test(t) ? t : null;
  const regionOf = r => coarse(r.region) || REGION;
  const vis = r => r.visibility || (r.is_public === false ? "editors" : r._src === "local" && !r.photos?.some(p => /^https?:|^images\//.test(p.path || "")) ? "private" : "public");
  const VIS = { private: ["🔒", "Private", "Only you (and the collection owner)"], editors: ["👥", "Shared with editors", "Collection owner, editors and viewers"], public: ["🌐", "Public", "Anyone with the link; location shown as county only"] };

  /* ---------- feedback store (Supabase + local fallback) ---------- */
  const LS = "ro-feedback";
  const localFb = () => { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } };
  let remoteStats = null;
  async function addFeedback(row) { row = { ...row, created_at: new Date().toISOString() }; const l = localFb(); l.push(row); try { localStorage.setItem(LS, JSON.stringify(l.slice(-2000))); } catch {}
    if (window.Cloud && Cloud.addFeedback) await Cloud.addFeedback(row); remoteStats = null; return row; }
  const key = t => String(t || "").toLowerCase().replace(/\s*\(.*$/, "").trim();
  async function stats() { if (!remoteStats && window.Cloud && Cloud.typeAccuracy) remoteStats = await Cloud.typeAccuracy() || [];
    const m = new Map(); const add = (t, v, n = 1) => { const k = key(t); if (!k) return; const o = m.get(k) || { type: t.replace(/\s*\(.*$/, ""), match: 0, close: 0, wrong: 0 }; o[v] += n; m.set(k, o); };
    if (remoteStats && remoteStats.length) remoteStats.forEach(x => { add(x.candidate_type, "match", +x.matches); add(x.candidate_type, "close", +x.close); add(x.candidate_type, "wrong", +x.wrong); });
    else localFb().forEach(f => add(f.candidate_type, f.verdict));
    return [...m.values()].map(o => ({ ...o, n: o.match + o.close + o.wrong, rate: (o.match + 0.5 * o.close) / Math.max(1, o.match + o.close + o.wrong) })).sort((a, b) => b.n - a.n); }
  const LEVELS = ["Insufficient data", "Low", "Low-moderate", "Moderate"];
  /* confidence modifier from past agreement: never raises above Moderate */
  function modify(conf, s) { if (!s || s.n < 3) return { conf, note: s ? `${s.n} feedback so far, too few to adjust confidence` : "" };
    let i = Math.max(0, LEVELS.indexOf(conf)); if (s.rate < 0.5) { i = Math.max(1, i - 1); return { conf: LEVELS[i], note: `lowered: past suggestions of this type agreed only ${Math.round(s.rate * 100)}% of the time (n=${s.n})` }; }
    return { conf, note: `${Math.round(s.rate * 100)}% agreement on this type (n=${s.n})${s.rate >= 0.8 ? ", historically reliable, but still capped at Moderate" : ""}` }; }

  /* ---------- low-confidence prompts ---------- */
  const VIEWS = { artifact: ["front", "back", "edge", "base", "scale"], fossil: ["front", "back", "edge", "scale"], rock: ["front", "back", "scale"] };
  const PROMPT = { base: "Needs a better base view: square-on photo of the base/stem, raking light, to show grinding, notches and stem shape", scale: "Needs a scale photo: ruler or coin flat beside the piece, camera straight above", edge: "Needs an edge profile: side-on shot showing thickness, cross-section and any beveling", back: "Needs a back view: flip it over; flaking on both faces is diagnostic", front: "Needs a clear front view in even daylight" };
  function prompts(r) { const kind = App.kindOf(r), have = new Set((r.photos || []).map(p => (p.view || p.tag || "").toLowerCase()).concat((r.photos || []).map(p => /scale/i.test(p.label || "") ? "scale" : ""))), out = new Map();
    (VIEWS[kind] || []).filter(v => !have.has(v)).forEach(v => out.set(v, PROMPT[v]));
    if (window.Analysis) Analysis.checklist(r, kind).filter(([, s]) => s === "unknown").forEach(([f]) => { const l = f.toLowerCase();
      const v = /base|stem|grind|notch|haft/.test(l) ? "base" : /edge|section|bevel|thick|profile|serrat/.test(l) ? "edge" : /size|length|measure/.test(l) ? "scale" : null; if (v && !out.has(v)) out.set(v, PROMPT[v] + ` (checklist: “${f}” is still unknown)`); });
    if (!/^measured/i.test(r.measure_method || "") && !out.has("scale")) out.set("scale", PROMPT.scale + " (measurements are still estimates)");
    return [...out.entries()].map(([k, t]) => ({ key: k, text: t })); }
  function engineConf(r) { const rk = Analysis.rank(r, App.kindOf(r)); const top = rk[0], sec = rk[1]; return !top ? "Insufficient data" : top.score >= 7 && top.score - (sec?.score || 0) >= 2 ? "Moderate" : top.score >= 4 ? "Low-moderate" : "Low"; }
  const lowConf = r => { const c = engineConf(r); return c !== "Moderate" || /low/i.test(r.confidence || "") || !r.photos?.length; };

  /* ---------- verified references ---------- */
  const verified = r => window.Analysis && Analysis.all().find(e => e.catalog_id === r.catalog_id);
  const badge = r => verified(r) ? `<span class="vbadge" title="Verified reference: ${esc(verified(r).confirmed_type)}">✓ Verified reference</span>` : "";
  async function promote(r, type, notes) { const kind = App.kindOf(r);
    const extra = { region: regionOf(r), era: r.era || App.eraOf(r), notes: notes || [r.key_features, r.owner_observations].filter(Boolean).join(". "), photo_ids: (r.photos || []).map((p, i) => p.id || `${r.catalog_id}/${i}`), material: r.material || "", is_public: vis(r) === "public" };
    return Analysis.learn(r, kind, type, "owner verified reference", extra); }

  /* ---------- similar verified examples (RAG, client side) ---------- */
  function similar(r, k = 3) { if (!window.Retrieve || !window.Analysis) return []; const kind = App.kindOf(r) || r.category;
    const ids = Analysis.rank(r, kind).slice(0, 3).map(x => x.c.id); return Retrieve.rankSimilar({ ...r, category: kind, region: regionOf(r), era: r.era }, Analysis.all().map(e => ({ region: REGION, ...e })), { k, candidateIds: ids }); }
  function similarHtml(r) { const s = similar(r);
    if (!s.length) return `<div class="sim"><h4>Most similar verified examples</h4><p class="help">No verified references are similar yet. Mark well-documented finds as verified references to build the library.</p></div>`;
    const chip = w => { const m = w.match(/^(same candidate type|shared traits|same material|same region|similar length|comparable length|same era)\s*(?:\((.*)\)|: (.*))?$/i) || [, w];
      const k = (m[1] || "").toLowerCase(), v = m[2] || m[3] || ""; const ic = { "same candidate type": "🎯", "shared traits": "🔎", "same material": "🪨", "same region": "📍", "similar length": "📏", "comparable length": "📏", "same era": "⏳" }[k] || "•";
      return `<span class="why-chip ${/material|region/.test(k) ? "match" : ""}">${ic} ${esc(k ? k[0].toUpperCase() + k.slice(1) : w)}${v ? `: ${esc(v)}` : ""}</span>`; };
    return `<div class="sim"><h4>Most similar verified examples</h4><ol class="sim-list">${s.map(x => { const e = x.example, f = App.all.find(y => y.catalog_id === e.catalog_id), p = f && App.pics(f)[0], w = x.why.join(" ");
      return `<li class="sim-item"><a href="#/find/${esc(e.catalog_id)}" class="sim-card" aria-label="${esc(e.catalog_id)}, verified ${esc(e.confirmed_type)}, similarity ${x.score}">${p ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : '<span class="sim-ph" aria-hidden="true">◆</span>'}
        <span class="sim-txt"><span class="sim-top"><strong>${esc(e.catalog_id)}</strong> <span class="vbadge">✓ ${esc(e.confirmed_type)}</span> <span class="chip">similarity ${x.score}</span></span>
        <span class="sim-badges">${/same region/.test(w) ? '<span class="mbadge">📍 Region match</span>' : ""}${/same material/.test(w) ? '<span class="mbadge">🪨 Material match</span>' : ""}${/length/.test(w) ? '<span class="mbadge">📏 Size close</span>' : ""}</span>
        <span class="why-chips" aria-label="Why similar">${x.why.map(chip).join("")}</span>
        <span class="sim-meta muted">${esc(e.region || REGION)}${e.era ? " · " + esc(e.era) : ""} · verified by ${esc(e.verified_by_name || (/owner/i.test(e.source || "") ? "the owner" : e.source || "the owner"))}${e.confirmed_on ? " on " + esc(e.confirmed_on) : ""}</span>
        <span class="sim-link">View example →</span></span></a></li>`; }).join("")}</ol>
      <p class="help">Retrieved from owner-verified references (type, traits, material, size, region, era). Also sent to the AI as comparison context.</p></div>`; }

  /* ---------- feedback UI ---------- */
  function typeOptions(kind) { return ((Analysis.kb()[kind] || {}).types || []).map(t => `<option value="${esc(t.name)}">`).join(""); }
  function feedbackBox(host, r, cand, source) { if (!host || !cand) return; const kind = App.kindOf(r), id = "fb" + Math.random().toString(36).slice(2, 7);
    host.innerHTML = `<div class="fb" role="group" aria-label="Feedback on ${esc(cand)}"><p class="fb-q">Does <strong>${esc(cand)}</strong> fit this find?</p>
      <div class="fb-btns">${Object.entries(VERDICTS).map(([v, [ic, t]]) => `<button type="button" class="btn fb-${v}" data-verdict="${v}" aria-pressed="false">${ic} ${t}</button>`).join("")}</div>
      <div class="fb-more" hidden><div class="row"><label class="field grow"><span>Better type (optional)</span><input name="better" list="${id}" placeholder="Pick from the reference list or type your own"></label><datalist id="${id}">${typeOptions(kind)}</datalist></div>
        <label class="field"><span>Correction / notes (optional)</span><textarea name="corr" rows="2" placeholder="e.g. Stem is expanding, not straight; looks more like Bulverde"></textarea></label>
        <button type="button" class="btn primary fb-send">Send feedback</button></div><p class="help fb-msg" role="status"></p></div>`;
    let verdict = null; const box = $(".fb", host);
    $$("[data-verdict]", box).forEach(b => b.onclick = () => { verdict = b.dataset.verdict; $$("[data-verdict]", box).forEach(x => x.setAttribute("aria-pressed", x === b)); $(".fb-more", box).hidden = false; if (verdict !== "match") $("[name=better]", box).focus(); });
    $(".fb-send", box).onclick = async () => { if (!verdict) return; const better = $("[name=better]", box).value.trim(), corr = $("[name=corr]", box).value.trim();
      await addFeedback({ catalog_id: r.catalog_id, photo_index: null, candidate_type: cand, verdict, correction: corr || null, better_type: better || null, source, user_id: st().user?.id || null });
      $(".fb-msg", box).textContent = `✓ Thanks, recorded “${VERDICTS[verdict][1]}”${better ? ` (better: ${better})` : ""}. ${st().user ? "Saved to the shared feedback table." : "Saved in this browser."}`; $(".fb-more", box).hidden = true; }; }

  /* ---------- visibility ---------- */
  function visSelect(r) { const v = vis(r); return `<label class="field vis"><span>Visibility</span><select data-act="vis3" aria-describedby="visHelp-${esc(r.catalog_id)}">${Object.entries(VIS).map(([k, [ic, t]]) => `<option value="${k}" ${k === v ? "selected" : ""}>${ic} ${t}</option>`).join("")}</select><small class="help" id="visHelp-${esc(r.catalog_id)}">${esc(VIS[v][2])}</small></label>`; }
  async function setVis(r, v) { await App.patch(r.catalog_id, { visibility: v, is_public: v === "public" }); if (window.Cloud && Cloud.setFindVisibility) await Cloud.setFindVisibility(r.catalog_id, v); App.toast(`${r.catalog_id}: ${VIS[v][1]}`); }

  /* ---------- share menu ---------- */
  const pageUrl = r => (C.siteUrl || location.href.split("#")[0]) + (r._src === "seed" ? `share/${r.catalog_id}.html` : `#/find/${r.catalog_id}`);
  function shareMenu(anchor, r) { $$(".share-menu").forEach(m => m.remove()); const url = pageUrl(r), title = `${r.catalog_id} · ${r.object_type || "Find"} · Rolling Oak Catalog`;
    const m = document.createElement("div"); m.className = "share-menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Share " + r.catalog_id);
    m.innerHTML = `${vis(r) !== "public" ? `<p class="help warn">${VIS[vis(r)][0]} This find is ${esc(VIS[vis(r)][1].toLowerCase())}; the link only works for people who can see it.</p>` : ""}
      <button type="button" role="menuitem" class="btn" data-sh="copy">🔗 Copy link</button>${navigator.share ? '<button type="button" role="menuitem" class="btn" data-sh="native">📤 Share…</button>' : ""}<button type="button" role="menuitem" class="btn" data-sh="pdf">📄 PDF summary</button><input class="sh-url" readonly value="${esc(url)}" aria-label="Link">`;
    anchor.after(m); m.querySelector("[data-sh]").focus();
    m.onclick = async e => { const b = e.target.closest("[data-sh]"); if (!b) return; const a = b.dataset.sh;
      if (a === "copy") { try { await navigator.clipboard.writeText(url); App.toast("Link copied"); } catch { m.querySelector(".sh-url").select(); App.toast("Press Ctrl/⌘+C to copy"); } }
      if (a === "native") { try { await navigator.share({ title, text: DISCLAIMER, url }); } catch {} }
      if (a === "pdf") pdf(r); m.remove(); };
    const close = e => { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener("click", close, true); } }; setTimeout(() => document.addEventListener("click", close, true));
    m.addEventListener("keydown", e => { if (e.key === "Escape") { m.remove(); anchor.focus(); } }); return m; }
  function pdf(r) { if (App.current) App.closeModal(); location.hash = "#/find/" + r.catalog_id; setTimeout(() => { document.body.classList.add("print-summary"); const done = () => { document.body.classList.remove("print-summary"); removeEventListener("afterprint", done); }; addEventListener("afterprint", done); window.print(); if (!("onafterprint" in window)) setTimeout(done, 1000); }, 400); }

  /* ---------- public find page (#/find/ID) ---------- */
  async function renderPublic(id) { const host = $("#publicFind"); if (!host) return; const r = App.all.find(x => x.catalog_id === id);
    if (!r) { host.innerHTML = App.all.length ? `<p>Find <strong>${esc(id)}</strong> isn't in this catalog, or it isn't public.</p><a class="btn" href="#/catalog">Browse the catalog</a>` : '<p class="help">Loading…</p>'; return; }
    const v = vis(r); if (v !== "public" && !canEdit()) { host.innerHTML = `<div class="gate"><p>🔒 ${esc(id)} isn't public. If you're a collection member, sign in to see it.</p><button type="button" class="btn primary" data-signin>Sign in</button></div>`; return; }
    const kind = App.kindOf(r), ps = App.pics(r), sugg = [r.suggestion_1, r.suggestion_2, r.suggestion_3].filter(Boolean), conf = engineConf(r), rk = Analysis.rank(r, kind), size = [r.length_mm && `L ${r.length_mm}`, r.width_mm && `W ${r.width_mm}`, r.thickness_mm && `T ${r.thickness_mm}`].filter(Boolean).join(" × ");
    document.title = `${r.catalog_id} · ${r.object_type || "Find"} — Rolling Oak Catalog`;
    host.innerHTML = `<article class="pub" aria-labelledby="pubH">${v !== "public" ? `<p class="notice-inline">${VIS[v][0]} Preview: this find is <strong>${esc(VIS[v][1])}</strong> and not visible to the public.</p>` : ""}
      <header class="pub-head"><p class="kicker">${esc(App.KINDS[kind].label)} · ${esc(regionOf(r))}</p><h1 id="pubH">${esc(r.catalog_id)} <span class="pub-type">${esc(r.object_type || "Find")}</span></h1>
        <div class="pub-chips">${badge(r)}<span class="chip">📍 ${esc(regionOf(r))} (general area)</span><span class="chip">${esc(App.eraOf(r))}${App.eraOf(r) !== "Undetermined" ? " · tentative" : ""}</span>${r.status ? `<span class="chip">${esc(r.status)}</span>` : ""}</div>
        <div class="pub-actions no-print"><button type="button" class="btn primary" id="pubShare">🔗 Share</button><a class="btn" href="#/record/${esc(r.catalog_id)}">Open full record</a><a class="btn ghost" href="#/catalog">← Catalog</a></div></header>
      <p class="disclaimer" role="note">⚠ ${DISCLAIMER}</p>
      <section class="pub-photos" aria-label="Photos with evidence marks">${ps.map((p, i) => `<figure class="pub-fig"><div class="mk-wrap"><img src="${esc(p.src)}" alt="${esc(r.catalog_id)} ${esc(p.label)}" ${i ? 'loading="lazy"' : ""}></div><figcaption>${esc(p.label)}${App.marksFor(r, i).length ? ` · ${App.marksFor(r, i).length} evidence marks` : ""}</figcaption>${App.marksFor(r, i).length ? `<details class="pub-legend"><summary>What the marks show</summary>${Marks.legend(App.marksFor(r, i), r, kind)}</details>` : ""}</figure>`).join("") || '<p class="help">No photos yet.</p>'}</section>
      <section class="pub-sum"><h2>Analysis summary</h2><dl class="kv">
        <dt>Possibilities</dt><dd>${sugg.length ? `<ol class="rank">${sugg.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : "None recorded"}</dd>
        <dt>Engine ranking</dt><dd>${rk.slice(0, 3).map(x => esc(x.c.name)).join(" · ") || "Insufficient data"} <span class="chip">${esc(conf)}</span></dd>
        <dt>Recorded confidence</dt><dd>${esc(r.confidence || "Not set")} <span class="muted">(max Moderate)</span></dd>
        <dt>Material</dt><dd>${esc(r.material || "—")}</dd><dt>Size (mm)</dt><dd>${esc(size || "—")} <span class="muted">${esc(r.measure_method || "")}</span></dd>
        <dt>Key features</dt><dd>${esc(r.key_features || "—")}</dd>${r.open_questions ? `<dt>Open questions</dt><dd>${esc(r.open_questions)}</dd>` : ""}
        <dt>Location</dt><dd>${esc(regionOf(r))}. Exact find spots are never published.</dd></dl>
        ${verified(r) ? `<p class="match">✓ Owner-verified reference: ${esc(verified(r).confirmed_type)}</p>` : ""}</section>
      <footer class="pub-foot"><p class="help">Rolling Oak Catalog · ${esc(C.siteUrl || "")}#/find/${esc(r.catalog_id)} · Printed ${new Date().toLocaleDateString("en-US")}</p><p class="help">${DISCLAIMER} Respect landowner permission and Texas antiquities law; don't dig sites.</p></footer></article>`;
    $$(".pub-fig").forEach((f, i) => { const img = $("img", f), w = $(".mk-wrap", f), ms = App.marksFor(r, i); if (ms.length) Marks.overlay(w, img, ms, true); });
    $("#pubShare").onclick = e => shareMenu(e.currentTarget, r); }

  /* ---------- About: how the AI learns ---------- */
  async function renderAbout() { const h = $("#learnPanel"); if (!h) return; const s = await stats(), ex = Analysis.all();
    h.innerHTML = `<h3>How the AI learns</h3><ol class="learn-steps"><li><strong>Suggest.</strong> The rule engine (and, for Supporters, the vision model) ranks possible types from the reference knowledge base.</li><li><strong>Retrieve.</strong> The most similar owner-verified references (type, traits, material, size, region, era) are pulled in as comparison context.</li><li><strong>Feedback.</strong> “Matches well / Close / Wrong ID” and corrections are stored per type.</li><li><strong>Adjust.</strong> Types that often get “Wrong ID” have their confidence lowered; nothing is ever raised above Moderate.</li><li><strong>Verify.</strong> Owners/editors promote well-documented finds to verified references, which grows the library.</li></ol>
      <p><strong>${ex.length}</strong> verified reference${ex.length === 1 ? "" : "s"} · <strong>${s.reduce((a, x) => a + x.n, 0)}</strong> feedback responses.</p>
      ${s.length ? `<table class="chk acc"><caption class="sr-only">Agreement rate per type</caption><thead><tr><th>Type</th><th>👍 Match</th><th>🤏 Close</th><th>👎 Wrong</th><th>Agreement</th><th>Effect on confidence</th></tr></thead><tbody>${s.map(x => `<tr><td>${esc(x.type)}</td><td>${x.match}</td><td>${x.close}</td><td>${x.wrong}</td><td><span class="acc-bar" aria-hidden="true"><i style="width:${Math.round(x.rate * 100)}%"></i></span> ${Math.round(x.rate * 100)}%</td><td>${x.n < 3 ? "needs ≥3 responses" : x.rate < 0.5 ? "lowered one level" : "none (capped at Moderate)"}</td></tr>`).join("")}</tbody></table><p class="help">Agreement = (matches + ½ close) ÷ responses.</p>` : '<p class="help">No feedback yet. Use the 👍 / 🤏 / 👎 buttons on any find\'s AI analysis tab.</p>'}
      <p class="help">${DISCLAIMER}</p>`; }

  /* ---------- decorate the detail modal ---------- */
  async function decorate(i, r, body) { const panel = $("[role=tabpanel]", body); if (!panel) return; const kind = App.kindOf(r);
    if (i === 0) { const host = document.createElement("div"); host.className = "s1-top";
      const pr = lowConf(r) ? prompts(r) : [];
      host.innerHTML = `${badge(r) ? `<p>${badge(r)} <span class="muted">${esc(verified(r).confirmed_type)}</span></p>` : ""}${pr.length ? `<div class="lowconf" role="note"><h4>📷 Low confidence: better photos would help</h4><ul>${pr.map(p => `<li data-need="${p.key}">${esc(p.text)}</li>`).join("")}</ul><a class="btn" href="#/add">Open the guided shot list</a></div>` : ""}
        ${canEdit() ? `<div class="vref"><label class="switch"><input type="checkbox" id="vrefToggle" ${verified(r) ? "checked" : ""}> <span>Mark as verified reference</span></label>
          <div class="vref-form" ${verified(r) ? "hidden" : "hidden"}><div class="row"><label class="field grow"><span>Verified type</span><input id="vrefType" list="vrefList" value="${esc(verified(r)?.confirmed_type || String(r.suggestion_1 || "").replace(/\s*\(.*$/, ""))}"></label><datalist id="vrefList">${typeOptions(kind)}</datalist>
          <label class="field"><span>Region (county-level)</span><input id="vrefRegion" value="${esc(regionOf(r))}"></label></div><label class="field"><span>Key morphological notes</span><textarea id="vrefNotes" rows="2">${esc([r.key_features, r.owner_observations].filter(Boolean).join(". "))}</textarea></label>
          <p class="help">Saved: type, material (${esc(r.material || "—")}), region, era (${esc(r.era || App.eraOf(r))}), notes and ${(r.photos || []).length} linked photo ids. Never an exact location.</p><button type="button" class="btn primary" id="vrefSave">Save verified reference</button></div></div>` : ""}`;
      const bar = $(".find-actions", panel); (bar || panel.firstChild) ? (bar ? bar.after(host) : panel.prepend(host)) : panel.prepend(host);
      if (bar) { const old = $("[data-act=vis]", bar); if (old) old.closest("label").remove(); if (canEdit()) { bar.insertAdjacentHTML("beforeend", visSelect(r)); $("[data-act=vis3]", bar).onchange = e => setVis(r, e.target.value); }
        const sb = $("[data-act=share]", bar); if (sb) { const n = sb.cloneNode(true); sb.replaceWith(n); n.onclick = () => shareMenu(n, r); } }
      const t = $("#vrefToggle", host); if (t) { const f = $(".vref-form", host);
        t.onchange = async () => { if (t.checked) { f.hidden = false; $("#vrefType").focus(); } else { f.hidden = true; await Analysis.forget(r.catalog_id); App.toast(`${r.catalog_id} removed from verified references`); App.refresh(); App.reselect(); } };
        $("#vrefSave").onclick = async () => { const ty = $("#vrefType").value.trim(), rg = $("#vrefRegion").value.trim(); if (!ty) return App.toast("Enter the verified type");
          if (!coarse(rg)) return App.toast("Region must be county-level, e.g. Bastrop County, Texas (no coordinates or addresses)");
          await promote({ ...r, region: rg }, ty, $("#vrefNotes").value.trim()); if (rg !== r.region) await App.patch(r.catalog_id, { region: rg }); App.toast(`✓ ${r.catalog_id} is now a verified reference`); App.refresh(); App.reselect(); }; } }
    if (i === 2) { const rk = Analysis.rank(r, kind), s = await stats(), top = rk[0], cand = top ? top.c.name : String(r.suggestion_1 || "").replace(/\s*\(.*$/, "");
      const kc = key(cand), ss = s.find(x => key(x.type) === kc) || s.find(x => key(x.type).split(/[\/ ]/).includes(kc.split(/[\/ ]/)[0])), m = modify(engineConf(r), ss); const host = document.createElement("div"); host.className = "s1-an";
      host.innerHTML = `<p class="disclaimer" role="note">⚠ ${DISCLAIMER}</p><div class="acc-sig"><strong>Confidence signal:</strong> engine ${esc(engineConf(r))}${m.conf !== engineConf(r) ? ` → <strong>${esc(m.conf)}</strong>` : ""} <span class="muted">${esc(m.note || "no feedback on this type yet")}</span></div>
        <div class="fb-host"></div>${similarHtml(r)}`;
      const ai = $(".ai-box", panel); ai ? ai.after(host) : panel.prepend(host); feedbackBox($(".fb-host", host), r, cand, "engine"); } }

  /* hook: after AI accept, ask for feedback on the AI's top candidate */
  function afterAi(r, candidates) { const body = $("#aiBody"); if (!body || !candidates?.length) return; const h = document.createElement("div"); h.className = "ai-fb"; body.appendChild(h); feedbackBox(h, r, candidates[0].name, "ai"); }
  window.Learn = { decorate, renderPublic, renderAbout, similarHtml, similar, feedbackBox, afterAi, prompts, lowConf, stats, modify, badge, verified, vis, regionOf, coarse, shareMenu, pdf, addFeedback, DISCLAIMER };
})();
