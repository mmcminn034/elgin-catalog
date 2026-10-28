/* UnEarthed Finds: AI pre-flight and result extras. Before the AI runs, the owner sees photo-capture guidance, an in-browser photo-quality check (resolution, focus, light),
   and a short attribute form (material and flaking are required; "unknown" counts as an answer). The answers are sent to the model as OWNER-SUPPLIED facts.
   After the run, AiPre.resultHtml() shows whether the piece looks worked at all, the diagnostic checklist, photo-quality advice, and calibration notes.
   Research suggestions only. Never exact locations: the form has a general "setting" choice and nothing else about place. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = "ro-ai-attrs", SHOTS = [["Both faces", "front and back, same distance and light"], ["Edge profile", "side-on, to show thickness and the outline of the edge"], ["Base and tip ends", "square-on; the base shape is often the deciding clue"], ["Close-up of flaking", "fill the frame with the worked area"], ["Scale", "a ruler or coin flat beside it"], ["Side light", "one low lamp or window to the side; no direct flash"]];
  const store = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } };
  const saved = (r) => ({ ...(store()[r.catalog_id] || {}), ...((r.extra && r.extra.attrs) || {}) });
  /* --- photo-quality check in the browser (never uploads anything): resolution, focus (Laplacian variance), brightness --- */
  const issuesOf = q => { const o = []; if (!q) return o; if (Math.min(q.w, q.h) < 800) o.push(`low resolution (${q.w}×${q.h}px); 1200px or more on the short side is better`);
    if (q.lap != null && q.lap < 40) o.push("may be out of focus; tap the stone to focus and hold still");
    if (q.mean != null && q.mean < 55) o.push("quite dark; use more light from the side"); if (q.mean != null && q.mean > 215) o.push("washed out or glare; avoid direct flash"); return o; };
  function quality(src) { return new Promise(res => { const im = new Image(), done = v => res(v), t = setTimeout(() => done(null), 9000); im.crossOrigin = "anonymous";
    im.onload = () => { clearTimeout(t); const w = im.naturalWidth, h = im.naturalHeight, q = { w, h, mean: null, lap: null };
      try { const s = Math.min(1, 320 / Math.max(w, h)), cw = Math.max(8, Math.round(w * s)), ch = Math.max(8, Math.round(h * s)), c = document.createElement("canvas"); c.width = cw; c.height = ch; const x = c.getContext("2d"); x.drawImage(im, 0, 0, cw, ch);
        const d = x.getImageData(0, 0, cw, ch).data, g = new Float32Array(cw * ch); let sum = 0; for (let i = 0; i < g.length; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; } q.mean = sum / g.length;
        let n = 0, m1 = 0, m2 = 0; for (let y = 1; y < ch - 1; y++) for (let xx = 1; xx < cw - 1; xx++) { const i = y * cw + xx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - cw] - g[i + cw]; n++; m1 += l; m2 += l * l; } q.lap = n ? m2 / n - (m1 / n) ** 2 : null; } catch { /* cross-origin pixels unreadable: size only */ }
      done(q); }; im.onerror = () => { clearTimeout(t); done(null); }; im.src = src; }); }
  const field = (d, v) => d.num ? `<label class="field"><span>${esc(d.label)}</span><input type="number" min="0" step="any" inputmode="decimal" name="${d.k}" value="${v == null ? "" : esc(v)}"></label>`
    : `<label class="field"><span>${esc(d.label)}${d.required ? ' <b aria-label="required">*</b>' : ""}</span><select name="${d.k}" ${d.required ? "required" : ""}><option value="">${d.required ? "Choose…" : "Not sure / skip"}</option>${d.options.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  const guess = (d, r) => { const t = String(r[d.k] || "").toLowerCase(); if (!t || d.num) return null; return d.options.find(o => t.includes(o.split(/[ \/(]/)[0].toLowerCase()) && o !== "other" && o !== "unknown") || null; };
  /* Resolves { attrs, photoIssues } when the owner presses Run, or null when cancelled. */
  function ask(host, r, kind, ps) {
    return new Promise(resolve => { const M = window.Matching, defs = M.ATTRS[kind] || M.ATTRS.artifact, sv = saved(r), dlg = host.closest("dialog");
      const val = d => sv[d.k] != null ? sv[d.k] : d.num ? (r[d.k] || null) : guess(d, r);
      host.innerHTML = `<div class="ai-pre" id="aiPre"><h3>Before the AI looks</h3>
        <details open class="ai-pre-shots"><summary>Photos that help it match (${SHOTS.length} views)</summary><ul>${SHOTS.map(([a, b]) => `<li><strong>${esc(a)}</strong>: ${esc(b)}</li>`).join("")}</ul><p class="help">Details and examples: <a href="#/learn">Learn → How to photograph a find</a>. Dry stones photograph better; do not scrub them.</p></details>
        <div id="aiPreQ" class="help" role="status">Checking your ${ps.length} photo${ps.length === 1 ? "" : "s"}…</div>
        <form id="aiPreForm" novalidate><p class="help">Tell the AI what you can see. It treats these as your observations, not proof. Fields marked <b>*</b> are required (“unknown” counts as an answer).</p><div class="ai-pre-grid">${defs.map(d => field(d, val(d))).join("")}</div>
          <p class="err" id="aiPreErr" role="alert" hidden></p><div class="row"><button type="submit" class="btn primary" id="aiGo">🤖 Run AI analysis</button><button type="button" class="btn" id="aiPreCancel">Cancel</button></div>
          <p class="help">Sends this find's photos and the answers above to the AI model. Your exact find location is never sent. AI output is a research suggestion only.</p></form></div>`;
      const photoIssues = []; Promise.all(ps.map(p => quality(new URL(p.src, location.href).href).then(q => ({ p, q })))).then(list => { const q = $("#aiPreQ", host); if (!q) return;
        const bad = list.map(({ p, q }) => ({ p, is: issuesOf(q) })).filter(x => x.is.length), checked = list.filter(x => x.q).length; bad.forEach(x => photoIssues.push((x.p.label || "photo") + ": " + x.is.join("; ")));
        q.innerHTML = !checked ? "Photo check unavailable in this browser, so the AI will judge the photos itself." : bad.length ? `⚠ <strong>Photo check:</strong><ul>${bad.map(x => `<li>${esc(x.p.label || "photo")}: ${esc(x.is.join("; "))}</li>`).join("")}</ul>You can retake these first, or run anyway (the AI will say if the photos are too weak to match).` : `✓ Photo check: ${checked} of ${ps.length} look sharp and bright enough.`;
        if (ps.length < 2) q.insertAdjacentHTML("beforeend", "<br>⚠ Only one photo: matches are capped lower with a single view. Add the back, edge and base."); });
      const onClose = () => resolve(null); dlg && dlg.addEventListener("close", onClose, { once: true });
      $("#aiPreCancel", host).onclick = () => { dlg && dlg.removeEventListener("close", onClose); resolve(null); dlg && dlg.close(); };
      $("#aiPreForm", host).onsubmit = e => { e.preventDefault(); const f = e.target, raw = {}; defs.forEach(d => { raw[d.k] = f.elements[d.k] ? f.elements[d.k].value : ""; });
        const attrs = M.clean(raw, kind), miss = M.missingRequired(attrs, kind), err = $("#aiPreErr", host);
        if (miss.length) { err.hidden = false; err.textContent = "Please answer: " + miss.join(", ") + "."; const first = defs.find(d => d.required && !attrs[d.k]); f.elements[first.k] && f.elements[first.k].focus(); return; }
        dlg && dlg.removeEventListener("close", onClose); remember(r, attrs); resolve({ attrs, photoIssues }); }; });
  }
  /* remember the answers: this browser always; the find's `extra.attrs` (merged, never replaced) when signed in */
  function remember(r, attrs) { try { const s = store(); s[r.catalog_id] = attrs; localStorage.setItem(LS, JSON.stringify(s)); } catch { /* storage full */ }
    try { const sb = window.Cloud && Cloud.client && Cloud.client(); if (sb && !window.ROLLING_OAK_MOCK && r.catalog_id) { const extra = { ...(r.extra || {}), attrs }; r.extra = extra; sb.from("finds").update({ extra }).eq("catalog_id", r.catalog_id).then(() => {}, () => {}); } } catch { /* offline: local copy kept */ } }
  const VERD = { likely_artifact: ["✅", "Looks worked (likely an artifact)", "ok"], possible_artifact: ["🟡", "Possibly worked", "warn"], uncertain: ["❔", "Uncertain whether it is worked at all", "warn"], likely_natural: ["🪨", "Looks more like a natural rock (geofact)", "warn"] };
  function resultHtml(out) { const al = out.artifact_likelihood, parts = [];
    if (al) { const v = VERD[al.verdict] || VERD.uncertain, li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join("");
      parts.push(`<div class="ai-artif ${v[2]}"><h3>Is it worked at all?</h3><p><strong>${v[0]} ${esc(v[1])}</strong>${al.confidence_pct ? ` <span class="chip">${esc(al.confidence_pct)}% sure</span>` : ""}</p>${(al.evidence_for || []).length ? `<p class="help">Points toward worked:</p><ul>${li(al.evidence_for)}</ul>` : ""}${(al.evidence_against || []).length ? `<p class="help">Points toward natural:</p><ul>${li(al.evidence_against)}</ul>` : ""}<p class="help">Natural rocks break and wear in ways that imitate tools. See <a href="#/learn">Learn: Is it an artifact?</a> and ask an expert before drawing conclusions.</p></div>`); }
    const pq = out.photo_quality; if (pq && (pq.usable === false || (pq.issues || []).length || (pq.retake || []).length)) parts.push(`<div class="ai-pq"><h3>Photo quality</h3>${pq.usable === false ? '<p class="err" role="alert">The photos are too weak for a firm match.</p>' : ""}${(pq.issues || []).length ? `<ul>${pq.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${(pq.retake || []).length ? `<p><strong>Retake:</strong></p><ul>${pq.retake.map(x => `<li>📷 ${esc(x)}</li>`).join("")}</ul>` : ""}</div>`);
    const dc = out.diagnostic_checklist; if ((dc || []).length) parts.push(`<details class="ai-dc"><summary>Diagnostic features the model checked (${dc.length})</summary><table class="chk"><thead><tr><th>Feature</th><th>Status</th><th>Note</th></tr></thead><tbody>${dc.map(x => `<tr><td>${esc(x.feature)}</td><td><span class="st ${x.status === "present" ? "present" : x.status === "absent" ? "absent" : "unknown"}">${x.status === "present" ? "✓ Present" : x.status === "absent" ? "✕ Absent" : "? Can't tell"}</span></td><td>${esc(x.note || "")}</td></tr>`).join("")}</tbody></table></details>`);
    if ((out.calibration_notes || []).length) parts.push(`<p class="help ai-cal">Confidence was lowered after the answer: ${out.calibration_notes.map(esc).join(" · ")}</p>`);
    if ((out.reference_images_used || []).length) parts.push(`<p class="help">Reference photos shown to the model (open licence, for comparison only): ${out.reference_images_used.map(m => `<a href="${esc(m.source_url)}" target="_blank" rel="noopener">${esc(m.title)}</a> (${esc(m.license)})`).join(", ")}</p>`);
    return parts.join(""); }
  /* data that rides with a Keep/Correct response, so a feedback row is a labeled example (no locations, no photos) */
  const feedbackMeta = (out, attrs, model, version) => ({ prompt_version: version || null, model: model || null, pct: out && out.candidates && out.candidates[0] ? out.candidates[0].confidence_pct : null, verdict: out && out.artifact_likelihood ? out.artifact_likelihood.verdict : null, photos: out && out.photo_quality ? (out.photo_quality.views_seen || []).length : null, attrs: attrs || {} });
  window.AiPre = { ask, resultHtml, feedbackMeta, issuesOf, quality, saved };
})();
