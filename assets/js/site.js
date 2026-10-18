/* Site improvements (2026-10-18): session-expiry message, saved-find banner, first-time onboarding,
   Settings → Export my data / Delete my account. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const C = window.ROLLING_OAK_CLOUD || {}, MOCK = window.ROLLING_OAK_MOCK;
  const st = () => (window.Cloud ? Cloud.state() : {}), uid = () => (st().user || {}).id || null;
  const toast = (m, o) => (window.App && App.toast ? App.toast(m, o) : alert(m));

  /* ---------- session expiry ---------- */
  const WAS = "ro-was-signed-in", BYE = "ro-user-signout";
  function expiredBanner() { if ($("#sessBanner")) return; const d = document.createElement("div"); d.id = "sessBanner"; d.className = "sess-banner"; d.setAttribute("role", "alert");
    d.innerHTML = `<p>⏱ Your session expired, please sign in again.</p><div class="row"><button type="button" class="btn small primary" data-auth-open="signin">Sign in</button><button type="button" class="btn small ghost" aria-label="Dismiss">✕</button></div>`;
    d.querySelector(".ghost").onclick = () => d.remove(); d.querySelector("[data-auth-open]").onclick = () => { d.remove(); const b = $("#authBtn"); if (b) b.click(); };
    document.body.appendChild(d); }
  function watchSession() { if (!window.Cloud || !Cloud.client || MOCK) return; const sb = Cloud.client(); if (!sb) return;
    let had = false;
    sb.auth.onAuthStateChange((ev, s) => {
      if (s && s.user) { had = true; try { localStorage.setItem(WAS, "1"); sessionStorage.removeItem(BYE); } catch {} const b = $("#sessBanner"); if (b) b.remove(); return; }
      const mine = (() => { try { return sessionStorage.getItem(BYE) === "1"; } catch { return false; } })();
      const was = (() => { try { return localStorage.getItem(WAS) === "1"; } catch { return false; } })();
      if ((ev === "SIGNED_OUT" && had && !mine) || (ev === "INITIAL_SESSION" && was && !mine)) expiredBanner();   // refresh failed / token expired / session revoked
      if (ev === "SIGNED_OUT" || ev === "INITIAL_SESSION") { had = false; try { localStorage.removeItem(WAS); } catch {} } }); }
  if (window.Cloud && Cloud.signOut) { const so = Cloud.signOut; Cloud.signOut = (...a) => { try { sessionStorage.setItem(BYE, "1"); localStorage.removeItem(WAS); } catch {} return so(...a); }; }

  /* ---------- after saving a find: a clear "saved" screen with the suggestion and Keep / Correct ---------- */
  function savedBanner(o, aiTxt) { const m = $("#modal"), body = $("#mBody"); if (!m || !body) return; const old = $("#savedBanner"); if (old) old.remove();
    const unavailable = /unavailable|isn't set up|out of credits/i.test(aiTxt || "");
    const d = document.createElement("div"); d.id = "savedBanner"; d.className = "saved-banner" + (unavailable ? " warn" : ""); d.setAttribute("role", "status");
    d.innerHTML = `<p><strong>✓ Saved: ${esc(o.title || o.object_type || "your find")}</strong> <span class="chip">${esc(o.catalog_id)}</span></p>
      <p>${o.suggestion_1 ? `Top suggestion: <strong>${esc(o.suggestion_1)}</strong>${o.confidence ? ` (${esc(o.confidence)})` : ""}. ` : ""}Review it below, then <strong>✓ Keep</strong> or <strong>✎ Correct</strong> it.</p>
      ${aiTxt ? `<p class="${unavailable ? "ai-unavail" : "help"}">🤖 ${esc(aiTxt)}</p>` : ""}`;
    body.parentNode.insertBefore(d, body);
    const clear = () => { d.remove(); m.removeEventListener("click", onClose, true); }, onClose = e => { if (e.target.closest("#mClose, [data-close-modal]")) clear(); };
    m.addEventListener("click", onClose, true); window.addEventListener("hashchange", function h() { if (!/^#\/record\//.test(location.hash)) { clear(); window.removeEventListener("hashchange", h); } }); }

  /* ---------- first-time onboarding (signed in, shown until dismissed, once per account) ---------- */
  const OB = () => "ro-onboard:" + uid();
  function onboarding() { const host = $("#view-catalog"); if (!host || host.hidden || !uid()) return; let done = false; try { done = localStorage.getItem(OB()) === "done"; } catch {}
    const ex = $("#onboard"); if (done) { if (ex) ex.remove(); return; }
    const mine = (window.App ? App.all : []).filter(r => window.Access ? Access.canEdit(r) : true), cats = window.Access ? Access.cols().filter(c => c.role === "owner") : [];
    const step = (ok, n, t, act) => `<li class="${ok ? "ok" : ""}"><span class="how-n" aria-hidden="true">${ok ? "✓" : n}</span><div><strong>${t}</strong>${act}</div></li>`;
    const last = mine.slice().sort((a, b) => String(b.saved_ts || b.created_at || "").localeCompare(String(a.saved_ts || a.created_at || "")))[0];
    const html = `<div class="onboard-h"><h2>Welcome! Three steps to your first find</h2><button type="button" class="btn small ghost" data-ob="x" aria-label="Dismiss the welcome steps">Dismiss ✕</button></div>
      <ol class="onboard-steps">${step(cats.length > 0, 1, "Create a catalog", cats.length ? ` <span class="help">You have ${cats.map(c => "“" + esc(c.name) + "”").join(", ")}.</span> <button type="button" class="btn small outline" data-newcat-btn>＋ Another</button>` : ` <button type="button" class="btn small primary" data-newcat-btn>＋ New catalog</button>`)}
        ${step(mine.length > 0, 2, "Add your first find", ` <a class="btn small ${mine.length ? "outline" : "primary"}" href="#/add">＋ Add find</a>`)}
        ${step(false, 3, "See the result", last ? ` <a class="btn small primary" href="#/record/${esc(last.catalog_id)}">Open ${esc(last.title || last.object_type || last.catalog_id)}</a> <span class="help">Ranked AI suggestions; Keep or Correct.</span>` : ` <span class="help">After saving, you'll see the AI suggestion with Keep / Correct.</span>`)}</ol>`;
    let box = ex; if (!box) { box = document.createElement("section"); box.id = "onboard"; box.className = "onboard"; box.setAttribute("aria-label", "Getting started"); const bar = $("#catBar"); (bar ? bar.parentNode : host).insertBefore(box, bar ? bar.nextSibling : host.firstChild); }
    if (box.dataset.k !== html) { box.innerHTML = html; box.dataset.k = html; }
    box.querySelector("[data-ob=x]").onclick = () => { try { localStorage.setItem(OB(), "done"); } catch {} box.remove(); }; }

  /* ---------- Settings: export + delete ---------- */
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) { // store-only ZIP (photos are already JPEG-compressed)
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    for (const f of files) { const name = enc.encode(f.name), d = f.data, crc = crc32(d), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, name.length, true);
      parts.push(h.buffer, name, d); const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cen.push(c.buffer, name); off += 30 + name.length + d.length; }
    const csize = cen.reduce((n, p) => n + (p.byteLength || p.length), 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, e.buffer], { type: "application/zip" }); }
  const save = (name, blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
  const csvCell = v => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function gather() { const sb = Cloud.client(), me = uid(); if (!sb || !me) throw new Error("Sign in first.");
    const sel = async (t, q) => { const r = await q(sb.from(t).select("*")); if (r.error) throw new Error(t + ": " + r.error.message); return r.data || []; };
    const cats = await sel("collections", x => x.eq("owner", me)), finds = await sel("finds", x => x.eq("owner", me).order("catalog_id")), ids = finds.map(f => f.catalog_id);
    const photos = ids.length ? await sel("photos", x => x.in("catalog_id", ids).order("sort")) : [], locs = await sel("find_locations", x => x.eq("owner", me));
    const comments = await sel("comments", x => x.eq("user_id", me)), corrections = await sel("corrections", x => x.eq("owner", me)), feedback = await sel("feedback", x => x.eq("user_id", me));
    const paths = photos.flatMap(p => [p.storage_path]).filter(Boolean), signedMap = {};
    for (let i = 0; i < paths.length; i += 100) { const r = await sb.storage.from(C.privateBucket || "find-photos-private").createSignedUrls(paths.slice(i, i + 100), 7 * 86400); (r.data || []).forEach(x => { if (x.signedUrl) signedMap[x.path] = x.signedUrl; }); }
    const base = (C.siteUrl || location.href.split("#")[0]).replace(/\/?$/, "/");
    photos.forEach(p => { p.url = p.storage_path ? signedMap[p.storage_path] || null : p.repo_path ? base + p.repo_path : null; });
    return { exported_at: new Date().toISOString(), account: { id: me, email: st().user.email || null }, note: "Photo links from the private bucket expire after 7 days. Exact locations are included only in this personal export.", catalogs: cats, finds, photos, find_locations: locs, comments, corrections, feedback }; }
  async function exportData(kind) { const msg = $("#expMsg"); msg.textContent = "Preparing your export…";
    try { const d = await gather(), day = new Date().toISOString().slice(0, 10);
      if (kind === "json") save(`unearthed-finds-export-${day}.json`, new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
      if (kind === "csv") { const catName = Object.fromEntries(d.catalogs.map(c => [c.id, c.name])), loc = Object.fromEntries(d.find_locations.map(l => [l.catalog_id, l])), ph = {};
        d.photos.forEach(p => (ph[p.catalog_id] = ph[p.catalog_id] || []).push(p.url || ""));
        const cols = ["catalog_id", "catalog", "title", "category", "object_type", "material", "length_mm", "width_mm", "thickness_mm", "weight_g", "status", "visibility", "public_id", "suggestion_1", "suggestion_2", "suggestion_3", "confidence", "key_features", "owner_observations", "context_notes", "date_found", "region", "exact_location", "lat", "lon", "photo_urls", "created_at", "updated_at"];
        const rows = d.finds.map(f => cols.map(c => c === "catalog" ? catName[f.collection_id] || "" : c === "exact_location" ? (loc[f.catalog_id] || {}).location : c === "lat" || c === "lon" ? (loc[f.catalog_id] || {})[c] : c === "photo_urls" ? (ph[f.catalog_id] || []).join(" ") : f[c]).map(csvCell).join(","));
        save(`unearthed-finds-export-${day}.csv`, new Blob(["\ufeff" + cols.join(",") + "\n" + rows.join("\n")], { type: "text/csv" })); }
      if (kind === "zip") { const files = [{ name: "export.json", data: new TextEncoder().encode(JSON.stringify(d, null, 2)) }]; let n = 0;
        for (const p of d.photos) { if (!p.url) continue; msg.textContent = `Downloading photos… ${++n} of ${d.photos.length}`; try { const r = await fetch(p.url); if (r.ok) files.push({ name: `photos/${p.catalog_id}/${String(p.sort).padStart(2, "0")}.jpg`, data: new Uint8Array(await r.arrayBuffer()) }); } catch {} }
        save(`unearthed-finds-export-${day}.zip`, zip(files)); }
      msg.textContent = `✓ Export ready: ${d.catalogs.length} catalog(s), ${d.finds.length} find(s), ${d.photos.length} photo(s).`; }
    catch (e) { msg.textContent = "Export failed: " + e.message; } }
  async function deleteAccount() { const f = $("#delForm"), msg = $("#delMsg"); if (f.confirm.value !== "DELETE") { msg.textContent = "Type DELETE in capital letters to confirm."; return; }
    if (!confirm("Last check: permanently delete your account and ALL your catalogs, finds, photos and locations? This can't be undone.")) return;
    msg.textContent = "Deleting…"; const sb = Cloud.client(); const { data: { session } } = await sb.auth.getSession(); if (!session) { msg.textContent = "Your session expired, please sign in again."; return; }
    try { const r = await fetch(C.url + "/functions/v1/delete-account", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: C.anonKey || C.key || "" }, body: JSON.stringify({ confirm: "DELETE" }) });
      const b = await r.json().catch(() => ({})); if (!r.ok || !b.ok) { msg.textContent = b.error || "Deletion failed. Nothing was changed."; return; }
      try { sessionStorage.setItem(BYE, "1"); localStorage.removeItem(WAS); Object.keys(localStorage).filter(k => k.startsWith("ro-")).forEach(k => localStorage.removeItem(k)); } catch {}
      try { indexedDB.deleteDatabase("elgin-catalog"); } catch {}
      try { await sb.auth.signOut({ scope: "local" }); } catch {}
      document.body.innerHTML = `<main class="wrap" style="padding:3rem 1rem"><h1>Your account was deleted</h1><p>Your catalogs, finds, photos and locations have been permanently removed.</p><p><a class="btn primary" href="./">Back to UnEarthed Finds</a></p></main>`; }
    catch (e) { msg.textContent = "Couldn't reach the server: " + e.message; } }
  function settingsExtra(host) { if (!host || $("#acctData", host)) return; const u = st().user; if (!u) return;
    const admin = window.Membership && Membership.isAdmin && Membership.isAdmin();
    const sec = document.createElement("div"); sec.id = "acctData"; sec.className = "set-grid";
    sec.innerHTML = `<section class="set-card"><h2>Export my data</h2><p class="help">Everything you've entered: catalogs, finds, notes, corrections and exact locations (only in your own export), with photo links. Photo links last 7 days.</p>
        <div class="row"><button type="button" class="btn" data-exp="json">⤓ JSON</button><button type="button" class="btn" data-exp="csv">⤓ CSV</button><button type="button" class="btn" data-exp="zip">⤓ ZIP with photos</button></div><p class="help" id="expMsg" role="status"></p></section>
      <section class="set-card danger-card"><h2>Delete my account</h2>${admin ? `<p class="help">🛡 This is the site owner account. It's protected and can't be deleted from the app.</p>` : `<p class="help">Permanently deletes your account, your catalogs, finds, photos and exact locations. This can't be undone. Export your data first if you want a copy.</p>
        <form id="delForm" class="m-form"><label class="field"><span>Type <strong>DELETE</strong> to confirm</span><input name="confirm" autocomplete="off" spellcheck="false" placeholder="DELETE"></label><div class="row"><button class="btn danger" id="delBtn" disabled>Delete my account permanently</button></div><p class="help" id="delMsg" role="alert"></p></form>`}</section>`;
    host.appendChild(sec);
    sec.querySelectorAll("[data-exp]").forEach(b => b.onclick = () => exportData(b.dataset.exp));
    const f = $("#delForm", sec); if (f) { f.confirm.oninput = () => { $("#delBtn").disabled = f.confirm.value !== "DELETE"; }; f.onsubmit = e => { e.preventDefault(); deleteAccount(); }; } }

  function render(view) { if (view === "catalog") setTimeout(onboarding, 50); if (view === "settings") setTimeout(() => settingsExtra($("#settingsBody")), 0); }
  document.addEventListener("access:change", () => { if (!$("#view-catalog").hidden) onboarding(); });
  document.addEventListener("DOMContentLoaded", () => { const go = () => watchSession(); if (window.Cloud && Cloud.whenReady) Cloud.whenReady().then(go, go); else go(); });
  window.Site = { savedBanner, onboarding, settingsExtra, render, expiredBanner, _zip: zip };
})();
