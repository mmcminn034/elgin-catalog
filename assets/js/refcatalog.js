/* Free public Reference Catalog (#/reference, #/reference/<id>): open to everyone, signed in or not.
   Museum- and institution-held artifacts, fossils and minerals whose images are CC0 / public domain / CC BY / CC BY-SA.
   Data: Supabase reference_media rows with data->>'public' = '1' (written by tools/reference/import_public_catalog.py; anon read via migration 027). Separate from user finds. Every card carries its license and attribution line.
   Locations are county/state level at most. Look-alike references for research, not identifications. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || "")) ? u : "#";
  const CATS = [["", "All"], ["artifact", "Artifacts"], ["fossil", "Fossils"], ["mineral", "Minerals"]];
  const PAGE = 48;
  let data = null, st = { cat: "", q: "", tx: false, inst: "", n: PAGE };
  /* Source of truth: Supabase reference_media rows with data->>'public' = '1' (anon read: migration 027).
     TEMPORARY bridge until 027 is applied: if the database returns no public rows, the last static export is shown instead.
     Remove BRIDGE and data/reference/public-catalog.json once database reads are verified live. */
  const BRIDGE = "data/reference/public-catalog.json";
  let origin = "";
  const fromRow = r => { const c = (r.data && r.data.catalog) || {};
    return { ...c, id: r.id, category: r.kind, name: c.name || r.title, thumb: r.thumb_url, source: r.source, source_url: r.source_url, license: r.license, license_url: r.license_url, attribution: r.attribution }; };
  async function fromDb() {
    const MOCK = window.ROLLING_OAK_MOCK;
    if (MOCK && MOCK.refcatalog) { if (MOCK.refcatalog === "error") throw new Error("mock error"); return MOCK.refcatalog.map(fromRow); }
    if (window.Cloud && Cloud.whenReady) { try { await Promise.race([Cloud.whenReady(), new Promise(r => setTimeout(r, 4000))]); } catch (_) {} }
    const c = window.Cloud && Cloud.client && Cloud.client(); if (!c || MOCK) return [];
    let out = [], from = 0;
    for (;;) {
      const { data: rows, error } = await c.from("reference_media").select("id,source,kind,title,thumb_url,source_url,license,license_url,attribution,data").eq("data->>public", "1").order("id").range(from, from + 999);
      if (error) throw error;
      out = out.concat(rows || []); if (!rows || rows.length < 1000) break; from += 1000;
    }
    return out.map(fromRow);
  }
  async function load(force) {
    if (data && !force) return data;
    let items = [], err = null;
    try { items = await fromDb(); origin = "db"; } catch (e) { err = e; }
    if (!items.length) { try { const r = await fetch(BRIDGE, { cache: "no-cache" }); if (r.ok) { const j = await r.json(); items = j.items || []; origin = "bridge"; data = { generated: j.generated, items }; } } catch (_) {} }
    if (!items.length) { data = null; throw err || new Error("no records"); }
    const rank = { artifact: 0, fossil: 1, mineral: 2 };
    items.sort((a, b) => (rank[a.category] - rank[b.category]) || (!a.tx - !b.tx) || (!a.us - !b.us) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    data = { generated: (data && data.generated) || "", items };
    items.forEach(x => { x._s = (x.search || [x.name, x.source_title, x.type, x.material, x.period, x.age, x.formation, x.region, x.institution, x.catalog_number, x.description].join(" ")).toLowerCase(); });
    return data;
  }
  const facts = x => [x.type, x.material && x.material !== x.name ? x.material : "", x.period || x.age, x.region].filter(Boolean);
  const card = x => `<li class="rc-card"><a href="#/reference/${encodeURIComponent(x.id)}" class="rc-link" data-rc="${esc(x.id)}">
      <img src="${esc(x.thumb)}" alt="${esc(x.name)}" loading="lazy" decoding="async" width="240" height="240">
      <span class="rc-cat chip">${esc({ artifact: "Artifact", fossil: "Fossil", mineral: "Mineral" }[x.category])}</span>
      <strong class="rc-name">${esc(x.name)}</strong><span class="rc-facts">${esc(facts(x).join(" · "))}</span>
      <span class="rc-inst">${esc(x.institution)}</span></a>
      <p class="rc-credit">${esc(x.license)} · <a href="${esc(safeUrl(x.source_url))}" target="_blank" rel="noopener nofollow">Source</a></p></li>`;
  function filtered() {
    const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    return (data.items || []).filter(x => (!st.cat || x.category === st.cat) && (!st.tx || x.tx) && (!st.inst || x.institution === st.inst) && words.every(w => x._s.includes(w)));
  }
  function draw() {
    const list = filtered(), box = $("#rcGrid"); if (!box) return;
    const counts = Object.fromEntries(CATS.map(([k]) => [k, (data.items || []).filter(x => !k || x.category === k).length]));
    $$("#rcTabs [data-cat]").forEach(b => { b.setAttribute("aria-selected", String(b.dataset.cat === st.cat)); $(".n", b).textContent = counts[b.dataset.cat]; });
    $("#rcCount").textContent = `${list.length} record${list.length === 1 ? "" : "s"}${st.q || st.tx || st.inst ? " match" : ""}`;
    box.innerHTML = list.length ? list.slice(0, st.n).map(card).join("") : '<li class="help">No records match. Try another word or clear the filters.</li>';
    $("#rcMore").hidden = list.length <= st.n;
  }
  function detail(id) {
    const x = (data.items || []).find(i => i.id === id), dlg = $("#rcDlg"); if (!x || !dlg) return;
    const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : "";
    $("#rcDlgBody").innerHTML = `<img src="${esc(x.thumb)}" alt="${esc(x.name)}" class="rc-big"><div><p class="kicker">${esc({ artifact: "Artifact", fossil: "Fossil", mineral: "Mineral" }[x.category])}</p><h2 id="rcDlgH">${esc(x.name)}</h2>
      <dl class="rc-dl">${row("Type", x.type)}${row("Material", x.material)}${row("Period", x.period)}${row("Age / date", x.age)}${row("Formation", x.formation)}${row("Culture area", x.culture)}${row("Region", x.region || "Not stated")}${row("Held by", x.institution)}${row("Catalog no.", x.catalog_number)}${row("Notes", x.description)}${x.source_title && x.source_title !== x.name ? row("Museum's title", x.source_title) : ""}</dl>
      <p class="rc-attr"><strong>Credit:</strong> ${esc(x.attribution)}</p>
      <p><a href="${esc(safeUrl(x.source_url))}" target="_blank" rel="noopener nofollow">View the original record (${esc(x.source)})</a>${x.license_url ? ` · <a href="${esc(safeUrl(x.license_url))}" target="_blank" rel="noopener nofollow">${esc(x.license)} license</a>` : ""}</p>
      <p class="help">Image resized to a thumbnail${/SA/.test(x.license) ? "; this thumbnail is shared under the same license" : ""}. Location shown at county/state level only. Reference for research, not an identification of anyone's find.</p></div>`;
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  }
  async function render(param) {
    const el = $("#referenceBody"); if (!el) return;
    if (!$("#rcGrid")) {
      el.innerHTML = '<p class="help" role="status">Loading the Reference Catalog…</p>';
      try { await load(); } catch (_) {
        el.innerHTML = `<p class="kicker">Explore · Free &amp; public</p><h1 id="rc-h">Reference Catalog</h1><div class="dir-note rc-error" role="alert"><p>The Reference Catalog can't load right now. This is usually a brief connection problem. Nothing is lost.</p><p><button type="button" class="btn outline" id="rcRetry">Try again</button></p></div>`;
        $("#rcRetry").onclick = () => render(param); return; }
      const insts = [...new Set((data.items || []).map(x => x.institution))].sort();
      el.innerHTML = `<p class="kicker">Explore · Free &amp; public</p><h1 id="rc-h">Reference Catalog</h1>
        <p class="lede">Real artifacts, fossils and minerals held by museums and research collections, with photos that are free to share (public domain, CC0, CC BY or CC BY-SA). Texas and the US first. Free for everyone, no account needed.</p>
        <p class="dir-note" role="note">These are institutional reference records, separate from members' finds. Every record names the institution, the license and the photo credit, and links to the original. Locations are county/state level at most. Use them to compare, not as an identification.</p>
        <div class="rc-tabs" id="rcTabs" role="tablist" aria-label="Category">${CATS.map(([k, l]) => `<button type="button" class="rc-tab" role="tab" data-cat="${k}" aria-selected="${k === st.cat}"><span class="cl">${l}</span> <span class="n">0</span></button>`).join("")}</div>
        <div class="toolbar dir-filters" role="search"><label class="field grow"><span class="sr-only">Search the reference catalog</span><input id="rcQ" type="search" placeholder="Search name, type, material, period, county, museum…" value="${esc(st.q)}"></label>
          <label class="field"><span class="sr-only">Institution</span><select id="rcInst"><option value="">All institutions</option>${insts.map(i => `<option>${esc(i)}</option>`).join("")}</select></label>
          <label class="check"><input type="checkbox" id="rcTx"${st.tx ? " checked" : ""}> Texas only</label></div>
        <p class="help" id="rcCount" aria-live="polite"></p><ul class="rc-grid" id="rcGrid"></ul>
        <p><button type="button" class="btn outline" id="rcMore" hidden>Show more</button></p>
        <p class="help">Sources: Yale Peabody Museum, Smithsonian NMNH, The Met, Cleveland Museum of Art, GBIF-published museum collections and museum-credited Wikimedia Commons photos. Full list and licenses: About → Reference sources.</p>
        <dialog id="rcDlg" class="rc-dlg" aria-labelledby="rcDlgH"><form method="dialog"><button class="btn small outline rc-close" aria-label="Close">✕</button></form><div id="rcDlgBody" class="rc-dlg-body"></div></dialog>`;
      $$("#rcTabs [data-cat]").forEach(b => b.onclick = () => { st.cat = b.dataset.cat; st.n = PAGE; draw(); });
      let t; $("#rcQ").oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.n = PAGE; draw(); }, 150); };
      $("#rcInst").onchange = e => { st.inst = e.target.value; st.n = PAGE; draw(); };
      $("#rcTx").onchange = e => { st.tx = e.target.checked; st.n = PAGE; draw(); };
      $("#rcMore").onclick = () => { st.n += PAGE; draw(); };
      $("#rcGrid").addEventListener("click", e => { const a = e.target.closest("[data-rc]"); if (!a) return; e.preventDefault(); history.replaceState(null, "", "#/reference/" + encodeURIComponent(a.dataset.rc)); detail(a.dataset.rc); });
      $("#rcDlg").addEventListener("close", () => { if (/^#\/reference\/./.test(location.hash)) history.replaceState(null, "", "#/reference"); });
    }
    draw();
    if (param) detail(decodeURIComponent(param));
  }
  const onRoute = () => { const m = location.hash.match(/^#\/reference(?:\/(.+))?$/); if (m) render(m[1]); };
  addEventListener("hashchange", onRoute); document.addEventListener("DOMContentLoaded", () => setTimeout(onRoute, 0));
  window.RefCatalog = { render, load, filtered: () => (data ? filtered() : []), origin: () => origin };
})();
