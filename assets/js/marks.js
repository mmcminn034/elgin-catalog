/* Rolling Oak Catalog: evidence marks (annotated photos) + markup tool.
   Marks are stored normalized (0–1) so they scale with any image size.
   arrow/line/measure/box: coords [x1,y1,x2,y2]; circle: [cx,cy,r] (r as a fraction of width). */
(() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const TYPES = ["arrow", "circle", "line", "measure", "box"];
  /* ---------- reasoning link text ---------- */
  function reason(m, r, kind) {
    const l = m.links_to; if (!l || !l.ref) return "";
    if (l.kind === "candidate" && window.Analysis) { const x = Analysis.rank(r, kind).find(x => x.c.id === l.ref), t = (Analysis.kb()[kind]?.types || []).find(t => t.id === l.ref);
      return t ? `Supports ${t.name}${x ? ` (score ${x.score})` : ""}${t.period ? ` · ${t.period}, ${t.dates}` : ""}` : l.ref; }
    if (l.kind === "feature" && window.Analysis) { const s = (Analysis.checklist(r, kind).find(([f]) => f === l.ref) || [])[1]; return `Checklist: ${l.ref}${s ? `: ${s}` : ""}`; }
    return l.ref;
  }
  /* ---------- SVG ---------- */
  function shape(m, i, W, H, opts = {}) {
    const c = m.coords || [], sw = Math.max(2, W * 0.005), X = v => v * W, Y = v => v * H, n = i + 1;
    let g = "", bx = 0, by = 0;
    const dbl = el => `<g class="mk-under" style="stroke-width:${sw * 2.4}">${el}</g><g class="mk-over" style="stroke-width:${sw}">${el}</g>`;
    if (m.type === "circle") { const r = c[2] * W; g = dbl(`<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="${r}"/>`); bx = X(c[0]) + r * 0.8; by = Y(c[1]) - r * 0.8; }
    else if (m.type === "box") { const x = Math.min(c[0], c[2]), y = Math.min(c[1], c[3]); g = dbl(`<rect x="${X(x)}" y="${Y(y)}" width="${Math.abs(c[2] - c[0]) * W}" height="${Math.abs(c[3] - c[1]) * H}" rx="${sw * 2}"/>`); bx = X(x); by = Y(y); }
    else { const [x1, y1, x2, y2] = c.map((v, k) => k % 2 ? Y(v) : X(v)); let ex = "";
      if (m.type === "measure") { const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2, t = sw * 4, dx = Math.cos(a) * t, dy = Math.sin(a) * t; ex = `<line x1="${x1 - dx}" y1="${y1 - dy}" x2="${x1 + dx}" y2="${y1 + dy}"/><line x1="${x2 - dx}" y1="${y2 - dy}" x2="${x2 + dx}" y2="${y2 + dy}"/>`; }
      g = dbl(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${m.type === "arrow" ? 'marker-end="url(#mkArrow)"' : ""} ${m.type === "measure" ? `stroke-dasharray="${sw * 3} ${sw * 2}"` : ""}/>${ex}`);
      bx = m.type === "arrow" ? x1 : (x1 + x2) / 2; by = m.type === "arrow" ? y1 : (y1 + y2) / 2; }
    const R = Math.max(11, W * 0.018);
    return `<g class="mk" data-mk="${i}" tabindex="${opts.focusable ? 0 : -1}" aria-label="Mark ${n}: ${esc(m.label)}">${g}<g class="mk-badge"><circle cx="${bx}" cy="${by}" r="${R}"/><text x="${bx}" y="${by}" font-size="${R * 1.15}" dy=".36em" text-anchor="middle">${n}</text></g></g>`;
  }
  function svg(marks, W, H, opts = {}) {
    const a = Math.max(8, W * 0.012);
    return `<svg class="mk-svg" viewBox="0 0 ${W} ${H}" ${opts.inline ? `width="100%"` : 'preserveAspectRatio="none"'} role="img" aria-label="${marks.length} evidence marks">${opts.image ? `<image href="${esc(opts.image)}" width="${W}" height="${H}"/>` : ""}
      <defs><marker id="mkArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="${a / Math.max(2, W * 0.005)}" markerHeight="${a / Math.max(2, W * 0.005)}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#F2B36A" stroke="#1A1512" stroke-width="1"/></marker></defs>
      ${marks.map((m, i) => shape(m, i, W, H, opts)).join("")}${opts.draft ? shape(opts.draft, marks.length, W, H) : ""}</svg>`;
  }
  const legend = (marks, r, kind) => marks.length ? `<ol class="mk-legend">${marks.map((m, i) => { const rs = reason(m, r, kind); return `<li data-mk="${i}" tabindex="0"><span class="mk-n">${i + 1}</span><div><strong>${esc(m.label)}</strong><span class="chip">${esc(m.type)}</span>${m.explanation ? `<p>${esc(m.explanation)}</p>` : ""}${rs ? `<p class="mk-link">→ ${esc(rs)}</p>` : ""}</div></li>`; }).join("")}</ol>` : '<p class="help">No evidence marks on this photo yet.</p>';
  function pairHover(root) {
    const set = (i, on) => root.querySelectorAll(`[data-mk="${i}"]`).forEach(e => e.classList.toggle("hl", on));
    ["pointerover", "focusin"].forEach(ev => root.addEventListener(ev, e => { const t = e.target.closest("[data-mk]"); if (t) set(t.dataset.mk, true); }));
    ["pointerout", "focusout"].forEach(ev => root.addEventListener(ev, e => { const t = e.target.closest("[data-mk]"); if (t) set(t.dataset.mk, false); }));
    root.addEventListener("click", e => { const t = e.target.closest("[data-mk]"); if (!t || root.classList.contains("editing")) return; const on = !t.classList.contains("hl"); root.querySelectorAll(".hl").forEach(x => x.classList.remove("hl")); if (on) set(t.dataset.mk, true); });
  }
  const dims = img => new Promise(res => img.complete && img.naturalWidth ? res([img.naturalWidth, img.naturalHeight]) : img.addEventListener("load", () => res([img.naturalWidth, img.naturalHeight]), { once: true }));

  /* ---------- evidence viewer (detail view) ---------- */
  // ctx: { r, kind, photos:[{src,label}], get(i)->marks, save(i, marks)->Promise, enlarge(i) }
  function mount(host, ctx) {
    let pi = Math.max(0, ctx.photos.findIndex((_, i) => ctx.get(i).length)), on = true, edit = false, tool = "arrow", sel = -1, draft = null, start = null;
    const draw = async () => {
      const p = ctx.photos[pi], ms = ctx.get(pi), lk = window.Analysis ? [...(Analysis.kb()[ctx.kind]?.diagnostics || []).map(d => ["feature", d[0], "Feature: " + d[0]]), ...Analysis.rank(ctx.r, ctx.kind).map(x => ["candidate", x.c.id, "Candidate: " + x.c.name])] : [];
      host.innerHTML = `<div class="ev ${edit ? "editing" : ""}"><div class="ev-bar"><label class="field"><span>Photo</span><select class="ev-photo">${ctx.photos.map((q, i) => `<option value="${i}" ${i === pi ? "selected" : ""}>${i + 1}. ${esc(q.label)}${ctx.get(i).length ? ` (${ctx.get(i).length} marks)` : ""}</option>`).join("")}</select></label>
        <label class="check ev-toggle"><input type="checkbox" class="ev-on" ${on ? "checked" : ""}> Evidence marks</label><span class="grow"></span>
        <button type="button" class="btn ev-edit">${edit ? "Done editing" : "✎ Edit marks"}</button><button type="button" class="btn ev-big">Enlarge</button></div>
        ${edit ? `<div class="ev-tools" role="toolbar" aria-label="Mark tools">${TYPES.map(t => `<button type="button" class="btn ${t === tool ? "primary" : ""}" data-tool="${t}" aria-pressed="${t === tool}">${t}</button>`).join("")}<span class="help">Click-drag on the photo to draw. Circles: drag from centre outward.</span></div>` : ""}
        <div class="ev-main"><div class="mk-wrap"><img src="${esc(p.src)}" alt="${esc(ctx.r.catalog_id)} ${esc(p.label)}">${on || edit ? '<div class="mk-layer"></div>' : ""}</div>
        <aside class="ev-side" aria-label="Evidence legend"><h4>Evidence marks${ms.length ? ` (${ms.length})` : ""}</h4>${on || edit ? legend(ms, ctx.r, ctx.kind) : '<p class="help">Marks hidden.</p>'}
        ${edit && sel >= 0 && ms[sel] ? `<form class="ev-form"><h4>Edit mark ${sel + 1}</h4><label class="field"><span>Type</span><select name="type">${TYPES.map(t => `<option ${t === ms[sel].type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label class="field"><span>Label</span><input name="label" value="${esc(ms[sel].label)}" required></label><label class="field"><span>Explanation</span><textarea name="explanation" rows="3">${esc(ms[sel].explanation)}</textarea></label>
          <label class="field"><span>Links to reasoning</span><select name="link"><option value="">(none)</option>${lk.map(([k, v, t]) => `<option value="${k}|${esc(v)}" ${ms[sel].links_to && ms[sel].links_to.kind === k && ms[sel].links_to.ref === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <div class="row"><button class="btn primary">Save mark</button><button type="button" class="btn ev-del">Delete</button></div></form>` : edit ? `<p class="help">${ms.length ? "Select a numbered mark in the legend to edit it, or draw a new one." : "Draw your first mark on the photo."}</p>` : ""}
        ${edit ? '<div class="row"><button type="button" class="btn ev-export">Export marks JSON</button></div>' : ""}</aside></div></div>`;
      const img = host.querySelector(".mk-wrap img"), [W, H] = await dims(img), layer = host.querySelector(".mk-layer");
      const paint = () => { if (layer) layer.innerHTML = svg(ms, W, H, { draft, focusable: true }); }; paint();
      host.querySelector(".ev-photo").onchange = e => { pi = +e.target.value; sel = -1; draw(); };
      host.querySelector(".ev-on").onchange = e => { on = e.target.checked; draw(); };
      host.querySelector(".ev-edit").onclick = () => { edit = !edit; sel = -1; draw(); };
      host.querySelector(".ev-big").onclick = () => ctx.enlarge(pi);
      host.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => { tool = b.dataset.tool; draw(); });
      if (edit) { host.querySelectorAll(".mk-legend li").forEach(li => li.onclick = () => { sel = +li.dataset.mk; draw(); });
        const pt = e => { const b = layer.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
        const mk = (a, b) => tool === "circle" ? { type: "circle", coords: [a[0], a[1], Math.hypot((b[0] - a[0]), (b[1] - a[1]) * H / W)] } : { type: tool, coords: [a[0], a[1], b[0], b[1]] };
        layer.onpointerdown = e => { if (e.target.closest(".mk")) { sel = +e.target.closest(".mk").dataset.mk; return draw(); } e.preventDefault(); layer.setPointerCapture(e.pointerId); start = pt(e); draft = { ...mk(start, start), label: "" }; paint(); };
        layer.onpointermove = e => { if (!start) return; draft = { ...mk(start, pt(e)), label: "" }; paint(); };
        layer.onpointerup = async e => { if (!start) return; const end = pt(e), d = Math.hypot(end[0] - start[0], end[1] - start[1]); const m = { ...mk(start, end), label: "New mark", explanation: "" }; start = null; draft = null;
          if (d < 0.01) return paint(); const list = [...ms, m]; await ctx.save(pi, list); sel = list.length - 1; draw(); };
        const f = host.querySelector(".ev-form"); if (f) { f.onsubmit = async e => { e.preventDefault(); const list = ctx.get(pi).map(x => ({ ...x })), m = list[sel], [k, ...v] = f.link.value.split("|");
          m.type = f.type.value; if (m.type === "circle" && m.coords.length === 4) m.coords = [(m.coords[0] + m.coords[2]) / 2, (m.coords[1] + m.coords[3]) / 2, Math.abs(m.coords[2] - m.coords[0]) / 2]; if (m.type !== "circle" && m.coords.length === 3) m.coords = [m.coords[0] - m.coords[2], m.coords[1], m.coords[0] + m.coords[2], m.coords[1]];
          m.label = f.label.value.trim() || "Mark"; m.explanation = f.explanation.value.trim(); if (k) m.links_to = { kind: k, ref: v.join("|") }; else delete m.links_to; await ctx.save(pi, list); draw(); };
          host.querySelector(".ev-del").onclick = async () => { const list = ctx.get(pi).filter((_, j) => j !== sel); sel = -1; await ctx.save(pi, list); draw(); }; }
        const ex = host.querySelector(".ev-export"); if (ex) ex.onclick = () => ctx.exportMarks(); }
      pairHover(host.querySelector(".ev"));
    };
    draw();
  }
  /* ---------- lightbox overlay ---------- */
  async function overlay(wrap, img, marks, on) { let l = wrap.querySelector(".mk-layer"); if (!l) { l = document.createElement("div"); l.className = "mk-layer"; wrap.appendChild(l); }
    l.innerHTML = ""; if (!on || !marks.length) return; const [W, H] = await dims(img); l.innerHTML = svg(marks, W, H); }
  /* ---------- print ---------- */
  function printSvg(src, marks, W, H) { return svg(marks, W, H, { image: src, inline: true }); }
  window.Marks = { mount, overlay, legend, printSvg, pairHover, dims };
})();
