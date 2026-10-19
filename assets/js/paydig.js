/* Pay Dig Sites directory (#/paydig): public, read-only for everyone; owner adds/edits/removes rows from Owner admin.
   Table pay_dig_sites (migration 022: public read, admin-only write enforced by RLS); static fallback data/pay-dig-sites.json.
   Town-level locations only. Fees only as published by the operator. UnEarthed Finds does not operate these sites. */
(() => {
  "use strict";
  const MOCK = window.ROLLING_OAK_MOCK || null;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sb = () => (window.Cloud && Cloud.client ? Cloud.client() : null);
  const toast = m => window.App ? App.toast(m) : alert(m);
  const TYPES = ["Fossils", "Minerals & Gems", "Mixed"];
  const DISCLAIMER = "Fees, hours, and rules change. Always confirm with the operator before visiting. UnEarthed Finds does not operate these sites.";
  const safeUrl = u => /^https?:\/\//i.test(String(u || "")) ? u : "#";
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  let cache = null;
  async function sites(force, all) { if (cache && !force) return cache; let rows = null;
    if (MOCK && MOCK.paydig) rows = MOCK.paydig;
    else if (!MOCK && sb()) { try { let b = sb().from("pay_dig_sites").select("*").order("state").order("sort").limit(1000); const r = await b; if (!r.error && r.data && r.data.length) rows = r.data; } catch (_) {} }
    if (!rows) { try { rows = await (await fetch("data/pay-dig-sites.json", { cache: "no-cache" })).json(); } catch (_) { rows = []; } }
    return (cache = rows); }
  const item = s => `<li class="pd-item${s.active === false ? " draft" : ""}" data-state="${esc(s.state)}" data-type="${esc(s.type)}" data-slug="${esc(s.slug)}"><div class="pd-h"><strong>${esc(s.name)}</strong> <span class="chip">${esc(s.type)}</span>${/^FLAGGED/.test(s.status_note || "") ? ' <span class="chip warn">Check status</span>' : ""}${s.active === false ? ' <span class="chip">Hidden</span>' : ""}</div>
      <p class="muted">${esc(s.area)}, ${esc(s.state)}</p>${s.finds ? `<p><span class="pd-k">Finds:</span> ${esc(s.finds)}</p>` : ""}<p><span class="pd-k">Fees:</span> ${esc(s.fee_note || "See operator site")}</p>${s.status_note ? `<p><span class="pd-k">Status:</span> ${esc(s.status_note)}</p>` : ""}
      <p><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener nofollow">Operator site (${esc(host(s.url))})</a> <span class="help">· Source: <a href="${esc(safeUrl(s.source_url))}" target="_blank" rel="noopener nofollow">${esc(host(s.source_url))}</a> · verified ${esc(s.last_verified || "")}</span></p></li>`;
  async function render() { const el = $("#paydigBody"); if (!el) return; el.innerHTML = '<p class="help">Loading…</p>';
    const rows = (await sites()).filter(s => s.active !== false), states = [...new Set(rows.map(s => s.state))].sort();
    el.innerHTML = `<p class="kicker">Explore</p><h1 id="pd-h">Pay Dig Sites</h1><p class="lede">Fee-dig mines, quarries and parks in the US where the public can dig and keep finds under the operator's rules.</p>
      <p class="dir-note pd-disclaimer" role="note">${esc(DISCLAIMER)}</p>
      <div class="dir-filters"><label class="field"><span>State</span><select id="pdState"><option value="">All states (${rows.length})</option>${states.map(st => `<option>${esc(st)}</option>`).join("")}</select></label>
        <div class="dir-fields" role="group" aria-label="Type">${[["", "All types"], ...TYPES.map(t => [t, t])].map(([v, l], i) => `<button type="button" class="btn small${i ? " outline" : ""}" data-pd-type="${esc(v)}" aria-pressed="${i ? "false" : "true"}">${esc(l)}</button>`).join("")}</div></div>
      <p class="help" id="pdCount" role="status"></p><ul class="pd-list" id="pdList"></ul>
      <p class="help">Locations are listed at town level only. Listings are not endorsements or partnerships. Spotted a change? Use the <a href="#/contact">Contact</a> page.</p>`;
    let st = "", ty = "";
    const draw = () => { const L = rows.filter(s => (!st || s.state === st) && (!ty || s.type === ty)); $("#pdList").innerHTML = L.map(item).join("") || '<li class="muted">No sites match these filters yet.</li>'; $("#pdCount").textContent = `${L.length} site${L.length === 1 ? "" : "s"}`; };
    $("#pdState").onchange = e => { st = e.target.value; draw(); };
    $$("[data-pd-type]", el).forEach(b => b.onclick = () => { ty = b.dataset.pdType; $$("[data-pd-type]", el).forEach(x => { const on = x === b; x.setAttribute("aria-pressed", on); x.classList.toggle("outline", !on); }); draw(); });
    draw(); }

  /* ---------- owner admin: add / edit / delete (RLS rejects anyone else) ---------- */
  const FIELDS = [["name", "Name", 1], ["state", "State", 1], ["area", "City / area (town level only)", 1], ["finds", "Primary finds"], ["fee_note", "Fee note (only what the operator publishes, else 'See operator site')"], ["url", "Official URL", 1], ["status_note", "Status note"], ["source_url", "Source URL", 1], ["last_verified", "Last verified (YYYY-MM-DD)", 1]];
  const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  async function save(row, isNew) { if (MOCK) { const L = MOCK.paydig = MOCK.paydig || []; const i = L.findIndex(x => x.slug === row.slug); if (i >= 0) L[i] = { ...L[i], ...row }; else L.push(row); return {}; }
    if (!sb()) return { error: "Offline" }; const r = isNew ? await sb().from("pay_dig_sites").insert(row) : await sb().from("pay_dig_sites").update(row).eq("slug", row.slug); return r.error ? { error: r.error.message } : {}; }
  async function del(slug) { if (MOCK) { MOCK.paydig = (MOCK.paydig || []).filter(x => x.slug !== slug); return {}; } const r = await sb().from("pay_dig_sites").delete().eq("slug", slug); return r.error ? { error: r.error.message } : {}; }
  async function adminMount(hostEl) { if (!hostEl || $("#pdAdmin", hostEl)) return; const box = document.createElement("section"); box.id = "pdAdmin"; box.className = "m-card"; hostEl.appendChild(box);
    const draw = async () => { const rows = await sites(true, true);
      box.innerHTML = `<h2>Pay Dig Sites <span class="chip">${rows.length}</span></h2><p class="help">Public page: <a href="#/paydig">#/paydig</a>. Town-level locations only; fees only as the operator publishes them.</p>
        <details id="pdAddWrap"><summary class="btn small">Add a site</summary>${form({})}</details>
        <ul class="pd-admin-list">${rows.map(s => `<li data-slug="${esc(s.slug)}"><strong>${esc(s.name)}</strong> <span class="muted">${esc(s.area)}, ${esc(s.state)} · ${esc(s.type)}${s.active === false ? " · hidden" : ""}</span> <button type="button" class="btn small ghost" data-pd-edit>Edit</button> <button type="button" class="btn small outline" data-pd-del>Delete</button></li>`).join("")}</ul>`;
      const bind = (f, isNew) => f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const row = { slug: d.slug || slugify(d.name + "-" + d.state), type: d.type, active: !!d.active };
        FIELDS.forEach(([k]) => row[k] = (d[k] || "").trim() || null); row.fee_note = row.fee_note || "See operator site";
        if (!/^https?:\/\//.test(row.url || "") || !/^https?:\/\//.test(row.source_url || "")) return toast("URLs must start with https://");
        const r = await save(row, isNew); toast(r.error || "Saved"); if (!r.error) { cache = null; draw(); } };
      bind($("form", box), true);
      $$("[data-pd-edit]", box).forEach(b => b.onclick = () => { const li = b.closest("li"), s = rows.find(x => x.slug === li.dataset.slug); if ($("form", li)) return; li.insertAdjacentHTML("beforeend", form(s)); bind($("form", li), false); });
      $$("[data-pd-del]", box).forEach(b => b.onclick = async () => { const slug = b.closest("li").dataset.slug; if (!confirm("Delete this pay-dig site from the public directory?")) return; const r = await del(slug); toast(r.error || "Deleted"); if (!r.error) { cache = null; draw(); } }); };
    const form = s => `<form class="m-form pd-form">${s.slug ? `<input type="hidden" name="slug" value="${esc(s.slug)}">` : ""}${FIELDS.map(([k, l, req]) => `<label class="field"><span>${esc(l)}</span><input name="${k}" value="${esc(s[k] || (k === "last_verified" ? new Date().toISOString().slice(0, 10) : ""))}"${req ? " required" : ""}${k === "last_verified" ? ' pattern="\\d{4}-\\d{2}-\\d{2}"' : ""}></label>`).join("")}
      <label class="field"><span>Type</span><select name="type">${TYPES.map(t => `<option${t === s.type ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="active"${s.active === false ? "" : " checked"}> Visible on the public page</label><button class="btn small primary">Save</button></form>`;
    draw(); }

  const onRoute = () => { if (/^#\/paydig/.test(location.hash)) render(); };
  addEventListener("hashchange", onRoute); document.addEventListener("DOMContentLoaded", () => setTimeout(onRoute, 0));
  window.PayDig = { render, sites, adminMount, DISCLAIMER };
})();
