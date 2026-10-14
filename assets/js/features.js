/* Rolling Oak Catalog: next-level features. Private map, location capture, QR labels, profiles,
   public collection page, members, membership/pricing, AI photo analysis UI, sharing, PWA install. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const LIB = { leafletCss: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css", leaflet: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
    clusterCss: "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css", clusterCss2: "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
    cluster: "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js", qr: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js" };
  const TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png", ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const loaded = {}; const script = src => loaded[src] = loaded[src] || new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error("Could not load " + src)); }; document.head.appendChild(s); });
  const css = href => { if (!$(`link[href="${href}"]`)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); } };
  const leaflet = async (cluster) => { css(LIB.leafletCss); await script(LIB.leaflet); if (cluster) { css(LIB.clusterCss); css(LIB.clusterCss2); await script(LIB.cluster); } return window.L; };
  let prof = null, cols = [], ready = null;
  const st = () => (window.Cloud ? Cloud.state() : { user: null, online: false });
  const isMember = () => !!prof && prof.membership === "member" && (!prof.membership_expires || new Date(prof.membership_expires) > new Date());
  const isEditor = () => cols.some(c => c.role === "owner" || c.role === "editor");
  let readyFor; async function init() { const uid = st().user && st().user.id; if (ready && readyFor === uid) return ready; readyFor = uid; return ready = (async () => { if (st().user) { prof = await Cloud.profile(); cols = await Cloud.collections(); } nav(); })(); }
  function nav() { $$(".needs-user").forEach(a => a.hidden = !st().user); $$(".needs-editor").forEach(a => a.hidden = !(st().user && isEditor())); }
  const shareUrl = r => (C.siteUrl || location.href.split("#")[0]) + (r && r._src === "seed" ? `share/${r.catalog_id}.html` : `#/find/${r.catalog_id}`);
  const findUrl = id => (C.siteUrl || location.href.split("#")[0]) + "#/find/" + id;
  const signInFirst = msg => `<div class="gate"><p>${msg}</p><button type="button" class="btn primary" data-signin>Sign in</button></div>`;
  document.addEventListener("click", e => { if (e.target.closest("[data-signin]")) { const b = $("#authBtn"); if (b && !b.hidden) b.click(); else App.toast("Sign-in is unavailable offline"); } });

  /* ---------- 📍 location capture (private only) ---------- */
  const fmt = (la, lo, a) => `${la.toFixed(6)}, ${lo.toFixed(6)} (±${Math.round(a)} m)`;
  function captureWidget(host, input) {
    if (!host || !input) return;
    const draw = async (msg, kind) => {
      const ll = Cloud && Cloud.parseLatLon ? Cloud.parseLatLon(input.value) : null, acc = (input.value.match(/±\s*(\d+)/) || [])[1];
      host.innerHTML = `<div class="cap ${ll ? "has" : ""}"><button type="button" class="btn primary cap-btn">📍 ${ll ? "Retake location" : "Capture location"}</button>${ll ? '<button type="button" class="btn cap-clear">Clear</button>' : ""}
        ${ll ? `<div class="cap-read" aria-live="polite"><strong>${ll[0].toFixed(6)}, ${ll[1].toFixed(6)}</strong>${acc ? ` <span class="chip">±${acc} m</span>` : ""}<span class="help">Saved to the private location only.</span></div><div class="cap-map" aria-label="Map preview of captured location"></div>` : ""}
        <p class="${kind === "err" ? "err" : "help"} cap-msg" role="status">${msg || (ll ? "" : "Uses your phone's GPS. Stored only in the private, owner-only location. Never shown publicly.")}</p></div>`;
      host.querySelector(".cap-btn").onclick = capture; const cl = host.querySelector(".cap-clear"); if (cl) cl.onclick = () => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); draw("Location cleared."); };
      if (ll) { try { const L = await leaflet(false), el = host.querySelector(".cap-map"); if (!el) return; const m = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, attributionControl: true }).setView(ll, 16);
        L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(m); L.circleMarker(ll, { radius: 7, color: "#1A1512", weight: 2, fillColor: "#F2B36A", fillOpacity: 1 }).addTo(m); if (acc) L.circle(ll, { radius: +acc, color: "#2F8F8A", weight: 1, fillOpacity: .12 }).addTo(m); } catch { const el = host.querySelector(".cap-map"); if (el) el.textContent = "Map preview unavailable offline."; } }
    };
    const capture = () => { if (!navigator.geolocation) return draw("This device or browser can't share its location.", "err");
      draw("📡 Getting a high-accuracy fix… stand still with a clear view of the sky.");
      navigator.geolocation.getCurrentPosition(p => { const { latitude, longitude, accuracy } = p.coords; input.value = fmt(latitude, longitude, accuracy);
          const sh = input.form && input.form.location_sharing; if (sh) sh.value = "Private"; input.dispatchEvent(new Event("input", { bubbles: true }));
          draw(accuracy > 50 ? `Captured, but accuracy is ±${Math.round(accuracy)} m. Retake outdoors for a better fix.` : "Captured. Remember to save."); },
        err => draw(err.code === 1 ? "Location permission was denied. Allow location for this site in your browser settings (iPhone: Settings → Safari → Location), then tap Capture again. You can also type the spot instead."
          : err.code === 3 ? "Timed out waiting for GPS. Move into the open and try again." : "Location unavailable right now. Try again in a moment.", "err"),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }); };
    draw();
  }

  /* ---------- private find map ---------- */
  let map = null, layer = null;
  async function renderMap() {
    const gate = $("#mapGate"), ui = $("#mapUi"); ui.hidden = true;
    if (!st().user) { gate.innerHTML = signInFirst("🔒 The find map is private. Sign in as a collection owner or editor to see it."); return; }
    await init(); if (!isEditor()) { gate.innerHTML = '<div class="gate"><p>🔒 Only collection owners and editors can see find locations. Ask the collection owner to make you an editor.</p></div>'; return; }
    gate.innerHTML = ""; ui.hidden = false;
    const eras = [...new Set(App.all.map(App.eraOf))].sort(); const es = $("#mapEra"); if (es.options.length <= 1) es.innerHTML += eras.map(e => `<option>${esc(e)}</option>`).join("");
    let L; try { L = await leaflet(true); } catch { $("#findMap").innerHTML = '<p class="help">Map library unavailable offline.</p>'; return; }
    if (!map) { map = L.map("findMap", { scrollWheelZoom: true }).setView([30.35, -97.37], 13); L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map);
      ["#mapCat", "#mapEra", "#mapCluster"].forEach(s => $(s).addEventListener("change", pins)); }
    setTimeout(() => map.invalidateSize(), 50); await pins(true);
  }
  async function pins(fit) {
    const L = window.L, cat = $("#mapCat").value, era = $("#mapEra").value, cloud = await Cloud.locations();
    const localPts = App.all.filter(r => r.find_location_private && Cloud.parseLatLon(r.find_location_private)).map(r => { const ll = Cloud.parseLatLon(r.find_location_private); return { catalog_id: r.catalog_id, lat: ll[0], lon: ll[1] }; });
    const pts = [...new Map([...cloud, ...localPts].map(p => [p.catalog_id, p])).values()].map(p => ({ ...p, r: App.all.find(r => r.catalog_id === p.catalog_id) })).filter(p => p.r && (!cat || App.kindOf(p.r) === cat) && (!era || App.eraOf(p.r) === era));
    if (layer) map.removeLayer(layer); layer = $("#mapCluster").checked && L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false }) : L.layerGroup();
    const color = { artifact: "#A8481E", fossil: "#2F8F8A", rock: "#7C8B6A" };
    pts.forEach(p => { const k = App.kindOf(p.r), icon = L.divIcon({ className: "pin", html: `<span style="background:${color[k]}">${esc(p.catalog_id.split("-")[1])}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker([p.lat, p.lon], { icon, title: p.catalog_id }).bindPopup(`<strong>${esc(p.catalog_id)}</strong><br>${esc(p.r.object_type || "")}<br><span class="muted">${esc(App.KINDS[k].label)} · ${esc(App.eraOf(p.r))}</span><br><button type="button" class="btn" data-open="${esc(p.catalog_id)}">Open record</button>`).addTo(layer); });
    layer.addTo(map); $("#mapCount").textContent = `${pts.length} pin${pts.length === 1 ? "" : "s"}`;
    if (fit && pts.length) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 17 });
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) App.openModal(b.dataset.open); });

  /* ---------- QR labels ---------- */
  const FMT = { avery5160: { cols: 3, per: 30, cls: "s5160" }, tag: { cols: 5, per: 60, cls: "stag" } };
  let picked = null;
  async function renderLabels() {
    const all = App.all; if (!picked) picked = new Set(all.map(r => r.catalog_id));
    $("#labPick").innerHTML = all.map(r => `<label class="check"><input type="checkbox" value="${esc(r.catalog_id)}" ${picked.has(r.catalog_id) ? "checked" : ""}> ${esc(r.catalog_id)} <span class="muted">${esc(r.object_type || "")}</span></label>`).join("");
    $("#labPick").onchange = e => { e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value); sheet(); };
    $("#labAll").onclick = () => { picked = new Set(all.map(r => r.catalog_id)); renderLabels(); }; $("#labNone").onclick = () => { picked = new Set(); renderLabels(); };
    $("#labFmt").onchange = sheet; $("#labSkip").oninput = sheet;
    $("#labPrint").onclick = () => { document.body.classList.add("print-labels"); window.print(); };
    await sheet();
  }
  window.addEventListener("afterprint", () => document.body.classList.remove("print-labels"));
  async function sheet() {
    const f = FMT[$("#labFmt").value], skip = Math.max(0, Math.min(f.per - 1, +$("#labSkip").value || 0)), rs = App.all.filter(r => picked.has(r.catalog_id));
    let qr; try { await script(LIB.qr); qr = window.qrcode; } catch { qr = null; }
    const code = id => { if (!qr) return '<span class="noqr">QR unavailable offline</span>'; const q = qr(0, "M"); q.addData(findUrl(id)); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }).replace("<svg ", `<svg role="img" aria-label="QR code for ${id}" `); };
    const cells = [...Array(skip).fill(null), ...rs]; const pages = []; for (let i = 0; i < Math.max(1, cells.length); i += f.per) pages.push(cells.slice(i, i + f.per));
    $("#labSheet").className = "sheet " + f.cls;
    $("#labSheet").innerHTML = pages.map(pg => `<div class="page">${pg.map(r => r ? `<div class="lab"><div class="lab-qr">${code(r.catalog_id)}</div><div class="lab-t"><div class="lab-brand"><img src="assets/brand/icon-small.svg" alt="">Rolling Oak Catalog</div><div class="lab-id">${esc(r.catalog_id)}</div><div class="lab-type">${esc(r.object_type || App.KINDS[App.kindOf(r)].label)}</div><div class="lab-date">${esc(r.date_found ? "Found " + r.date_found : "Elgin, Texas")}</div></div></div>` : '<div class="lab empty"></div>').join("")}</div>`).join("");
  }

  /* ---------- profile ---------- */
  async function renderProfile() {
    const b = $("#profileBody"); if (!st().user) { b.innerHTML = signInFirst("Sign in to create your public collector profile."); return; }
    await init(); const p = prof || {};
    b.innerHTML = `<form id="profForm" class="prof"><div class="prof-av"><img id="avImg" src="${esc(p.avatar_url || "assets/brand/icon.svg")}" alt="Your avatar"><label class="btn">Change photo<input type="file" accept="image/*" id="avFile" class="sr-only"></label></div>
      <div class="prof-f"><label class="field"><span>Display name</span><input name="display_name" value="${esc(p.display_name)}" maxlength="60" required></label>
      <label class="field"><span>Bio</span><textarea name="bio" rows="4" maxlength="500" placeholder="What you collect, where, and why">${esc(p.bio)}</textarea></label>
      <label class="check"><input type="checkbox" name="is_public" ${p.is_public !== false ? "checked" : ""}> Show my profile publicly</label>
      <p>Membership: <span class="badge ${isMember() ? "Reviewed" : "Draft"}">${isMember() ? "Supporter member" : "Free"}</span> ${isMember() ? "" : '<a href="#/pricing">Become a member</a>'}</p>
      <div class="row"><button class="btn primary">Save profile</button><a class="btn" href="#/c/${esc((cols[0] || C.defaultCollection).slug)}">View public collection</a></div></div></form>`;
    $("#avFile").onchange = async e => { const f = e.target.files[0]; if (!f) return; const url = await App.stripExif(f), blob = await (await fetch(url)).blob(), r = await Cloud.uploadAvatar(blob); if (r.error) return App.toast(r.error); $("#avImg").src = r.url; p.avatar_url = r.url; App.toast("Photo updated. Save to keep it."); };
    $("#profForm").onsubmit = async e => { e.preventDefault(); const f = e.target, np = { display_name: f.display_name.value.trim(), bio: f.bio.value.trim(), avatar_url: p.avatar_url || null, is_public: f.is_public.checked };
      const r = await Cloud.saveProfile(np); if (r.error) return App.toast(r.error); prof = { ...p, ...np }; App.toast("Profile saved"); };
  }

  /* ---------- public collection page ---------- */
  async function renderCollection(slug) {
    slug = slug || C.defaultCollection.slug; const b = $("#collectionBody");
    const d = (window.Cloud && await Cloud.publicCollection(slug)) || (slug === C.defaultCollection.slug ? { collection: C.defaultCollection, owner: { display_name: C.defaultCollection.owner_name, bio: "" } } : null);
    if (!d) { b.innerHTML = "<h1>Collection not found</h1><p>It may be private or the link may be wrong.</p>"; return; }
    const c = d.collection, o = d.owner || {}, finds = App.all.filter(r => r.is_public !== false && (!c.id || !r.collection_id || r.collection_id === c.id)), counts = ["artifact", "fossil", "rock"].map(k => [k, finds.filter(r => App.kindOf(r) === k).length]);
    b.innerHTML = `<header class="col-hero"><p class="kicker">Public collection</p><h1 id="col-h">${esc(c.name)}</h1><p class="lede">${esc(c.description || "")}</p>
      <div class="owner-card"><img src="${esc(o.avatar_url || "assets/brand/icon.svg")}" alt=""><div><strong>${esc(o.display_name || "Collector")}</strong>${o.bio ? `<p>${esc(o.bio)}</p>` : ""}</div></div>
      <dl class="stats">${counts.map(([k, n]) => `<div><dt>${esc(App.KINDS[k].label)}</dt><dd>${n}</dd></div>`).join("")}</dl>
      <div class="row"><button type="button" class="btn" id="shareCol">🔗 Share this collection</button></div></header>
      <div class="grid col-grid">${finds.map(r => { const p = App.pics(r)[0]; return `<button class="card" data-open="${esc(r.catalog_id)}">${p ? `<div class="card-img"><img src="${esc(p.thumb)}" alt="" loading="lazy"><span class="cid-big">${esc(r.catalog_id)}</span></div>` : ""}<h3>${esc(r.object_type || "")}</h3><div class="meta">${esc(App.KINDS[App.kindOf(r)].label)} · ${esc(App.eraOf(r))}</div></button>`; }).join("")}</div>`;
    $("#shareCol").onclick = () => share((C.siteUrl || "") + "#/c/" + slug, c.name + " · Rolling Oak Catalog");
  }

  /* ---------- members ---------- */
  async function renderMembers() {
    const b = $("#membersBody"); if (!st().user) { b.innerHTML = signInFirst("Sign in to manage who can view and edit your collection."); return; }
    await init(); if (!cols.length) { b.innerHTML = '<p>You are not a member of any collection yet. If someone invited you, sign in with the invited email address.</p>'; return; }
    const c = cols[0], own = c.role === "owner", d = await Cloud.members(c.id);
    b.innerHTML = `<div class="mem-head"><h2>${esc(c.name)}</h2><span class="badge Reviewed">You: ${esc(c.role)}</span>${own ? `<label class="field"><span>Visibility</span><select id="colVis"><option value="1" ${c.is_public ? "selected" : ""}>Public</option><option value="0" ${c.is_public ? "" : "selected"}>Private</option></select></label>` : ""}</div>
      <table class="chk mem"><thead><tr><th>Member</th><th>Role</th></tr></thead><tbody>${d.members.map(m => `<tr><td>${m.avatar_url ? `<img class="mini-av" src="${esc(m.avatar_url)}" alt="">` : ""}${esc(m.display_name || m.email || m.user_id)}</td><td>${own && m.role !== "owner" ? `<select data-uid="${esc(m.user_id)}" aria-label="Role for ${esc(m.display_name || "member")}">${["editor", "viewer"].map(r => `<option ${r === m.role ? "selected" : ""}>${r}</option>`).join("")}</select>` : esc(m.role)}</td></tr>`).join("")}
      ${d.invites.filter(i => i.status === "pending").map(i => { const who = i.email || i.phone || ""; return `<tr class="pending"><td>${i.phone && !i.email ? "📱 " + esc(window.AuthOptions ? AuthOptions.pretty(i.phone) : i.phone) : "✉ " + esc(who)} <span class="chip">invited</span></td><td>${esc(i.role)} ${own ? `<button type="button" class="btn" data-revoke="${esc(who)}">Revoke</button>` : ""}</td></tr>`; }).join("")}</tbody></table>
      <p class="help">Owners and editors can edit finds, photos and marks and can see private locations and the map. Viewers can see everything except exact locations.</p>
      ${own ? `<form id="invForm" class="row inv"><label class="field grow"><span>${C.authPhone ? "Invite by email or mobile number" : "Invite by email"}</span><input type="${C.authPhone ? "text" : "email"}" name="email" required autocomplete="off" placeholder="${C.authPhone ? "name@example.com or (512) 555-0123" : "name@example.com"}"></label><label class="field"><span>Role</span><select name="role"><option>editor</option><option>viewer</option></select></label><button class="btn primary">Send invite</button></form><p class="help">Email invites get a sign-in email.${C.authPhone ? " Phone invites get no text from us. Tell them to sign in with that number." : ""} They join automatically the first time they sign in with that address or number.</p>` : ""}`;
    if (own) { $("#invForm").onsubmit = async e => { e.preventDefault(); const f = e.target; const v = f.email.value.trim(), isMail = /.+@.+\..+/.test(v), tel = !isMail && C.authPhone && window.AuthOptions ? AuthOptions.toE164(v) : null;
      if (!isMail && !tel) return App.toast(C.authPhone ? "Enter an email or a valid mobile number" : "Enter a valid email");
      const r = await Cloud.invite(c.id, tel || v, f.role.value); App.toast(r.error ? (r.error.message || r.error) : tel ? `Invite saved for ${AuthOptions.pretty(tel)}. They join when they sign in with it.` : "Invite sent to " + v); renderMembers(); };
      $$("[data-revoke]").forEach(x => x.onclick = async () => { await Cloud.revokeInvite(c.id, x.dataset.revoke); renderMembers(); });
      $$("select[data-uid]").forEach(s => s.onchange = async () => { const r = await Cloud.setRole(c.id, s.dataset.uid, s.value); App.toast(r.error || "Role updated"); });
      $("#colVis").onchange = async e => { const r = await Cloud.setVisibility("collections", c.id, e.target.value === "1"); c.is_public = e.target.value === "1"; App.toast(r.error || "Collection is now " + (c.is_public ? "public" : "private")); }; }
  }

  /* ---------- pricing / membership ---------- */
  async function renderPricing() {
    await init(); const lim = C.freeFindLimit || 50;
    $("#pricingBody").innerHTML = `<p class="kicker">Membership</p><h1 id="price-h">Free for collectors. Supporters keep it growing.</h1>
      <div class="plans"><div class="plan"><h2>Free</h2><p class="price">$0</p><ul>${[`Up to ${lim} finds`, "Artifacts, fossils & rocks catalog", "Rule-based analysis + learning from your verified IDs", "Evidence marks & markup tool", "Phone add flow, location capture & private map", "QR labels, sharing & public collection page", "Shared editing with family (owner/editor/viewer)"].map(x => `<li>✓ ${x}</li>`).join("")}</ul></div>
      <div class="plan feat"><span class="plan-tag">Supporter</span><h2>Supporter membership</h2><p class="price">${esc(C.membershipPrice || "$10/year")}</p><ul>${["Everything in Free", "<strong>Unlimited finds</strong>", "<strong>AI photo analysis</strong>: ranked candidates + suggested evidence marks you review before saving", "Helps pay for hosting and development"].map(x => `<li>✓ ${x}</li>`).join("")}</ul>
      <button type="button" class="btn primary lg" id="joinBtn">${isMember() ? "✓ You're a member" : "Become a member"}</button><p class="help" id="joinMsg"></p></div></div>
      <p class="help">AI results are research possibilities, never identifications, authenticity or value claims. Cancel anytime; your catalog stays yours.</p>`;
    $("#joinBtn").disabled = isMember();
    $("#joinBtn").onclick = () => { const s = st(); if (!s.user) { $("#joinMsg").textContent = "Sign in first so the membership attaches to your account."; const b = $("#authBtn"); if (b && !b.hidden) b.click(); return; }
      const link = C.stripePaymentLink || ""; if (!/^https:\/\/(buy|checkout)\.stripe\.com\//.test(link)) { $("#joinMsg").textContent = "Membership checkout opens soon. Thanks for your interest!"; return; }
      const u = new URL(link); u.searchParams.set("client_reference_id", s.user.id); if (s.user.email) u.searchParams.set("prefilled_email", s.user.email); location.href = u.toString(); };
  }

  /* ---------- per-find decorations ---------- */
  async function share(url, title) { try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(url); App.toast("Link copied"); } catch { window.prompt("Copy this link:", url); } }
  function decorate(i, r, body) {
    const panel = body.querySelector("[role=tabpanel]"); if (!panel) return; const s = st(), editor = s.user && isEditor();
    if (i === 0) { const bar = document.createElement("div"); bar.className = "find-actions";
      bar.innerHTML = `<button type="button" class="btn" data-act="share">🔗 Share</button><button type="button" class="btn" data-act="review">🧑‍🔬 Request expert review</button><a class="btn" href="#/labels">🏷 QR label</a>
        ${editor ? `<label class="field vis"><span>Visibility</span><select data-act="vis"><option value="1" ${r.is_public !== false ? "selected" : ""}>Public</option><option value="0" ${r.is_public === false ? "selected" : ""}>Private</option></select></label>` : ""}<div class="rev-form" hidden></div>`;
      panel.prepend(bar);
      bar.querySelector('[data-act=share]').onclick = () => share(shareUrl(r), `${r.catalog_id} · ${r.object_type || ""} · Rolling Oak Catalog`);
      bar.querySelector('[data-act=review]').onclick = () => { const f = bar.querySelector(".rev-form"); if (!s.user) { f.hidden = false; f.innerHTML = signInFirst("Sign in to request an expert review of this find."); return; }
        f.hidden = false; f.innerHTML = `<label class="field"><span>What would you like an expert to look at?</span><textarea rows="3" id="revNote" placeholder="e.g. Is the stem ground? Which point type?"></textarea></label><button type="button" class="btn primary" id="revSend">Send request</button>`;
        $("#revSend").onclick = async () => { const res = await Cloud.requestReview(r.catalog_id, $("#revNote").value.trim()); f.innerHTML = res.error ? `<p class="err">${esc(res.error)}</p>` : '<p class="help ok">✓ Review requested. You\'ll see the answer on this record.</p>'; }; };
      const v = bar.querySelector('[data-act=vis]'); if (v) v.onchange = async () => { await App.patch(r.catalog_id, { is_public: v.value === "1" }); App.toast(`${r.catalog_id} is now ${v.value === "1" ? "public" : "private"}`); };
    }
    if (i === 2) { const box = document.createElement("div"); box.className = "ai-box";
      box.innerHTML = isMember() ? `<button type="button" class="btn primary" id="aiRun">🤖 Analyze photos with AI</button><span class="help">Sends this find's photos to the AI model. You review every suggestion before anything is saved.</span>`
        : `<strong>🤖 AI photo analysis</strong> <span class="chip">Supporters</span><p class="help">A vision model looks at the photos and suggests ranked candidates plus evidence marks for you to accept or edit. <a href="#/pricing">See membership</a></p>`;
      panel.prepend(box); const b = box.querySelector("#aiRun"); if (b) b.onclick = () => analyze(r); }
    if (i === 3) { const inp = panel.querySelector('input[name="find_location_private"]'); if (inp && editor !== false) { const h = document.createElement("div"); h.className = "cap-host"; inp.closest(".field").after(h); captureWidget(h, inp); } }
  }

  /* ---------- AI analysis dialog ---------- */
  async function analyze(r) {
    const dlg = $("#aiDlg"), body = $("#aiBody"), kind = App.kindOf(r), ps = App.pics(r).map((p, i) => ({ ...p, i })).filter(p => !String(p.src).startsWith("data:")).slice(0, 6);
    $("#aiClose").onclick = () => dlg.close(); dlg.showModal();
    if (!ps.length) { body.innerHTML = '<p>Upload photos (sign in and sync) first. AI analysis needs photos hosted online.</p>'; return; }
    body.innerHTML = '<p class="help" role="status">🤖 Analyzing photos… this can take 20–40 seconds.</p>';
    const KB = Analysis.kb()[kind] || {}, payload = { catalog_id: r.catalog_id, kind, photos: ps.map(p => ({ url: new URL(p.src, C.siteUrl || location.href).href, label: p.label })),
      record: { object_type: r.object_type, material: r.material, key_features: r.key_features, owner_observations: r.owner_observations, length_mm: r.length_mm, measure_method: r.measure_method },
      kb: (KB.types || []).map(t => ({ id: t.id, name: t.name, period: t.period, dates: t.dates, traits: t.traits, length_mm: t.length_mm })), checklist: (KB.diagnostics || []).map(d => d[0]), examples: Analysis.all().filter(e => e.category === kind), similar: window.Learn ? Learn.similar(r, 3).map(x => ({ catalog_id: x.example.catalog_id, confirmed_type: x.example.confirmed_type, why: x.why })) : [], region: window.Learn ? Learn.regionOf(r) : "" };
    const res = await Cloud.analyze(payload);
    if (res.error) { body.innerHTML = `<p class="err">AI analysis isn't available: ${esc(res.error)}</p>`; return; }
    const out = res.data.result || res.data, marksBy = new Map((out.marks || []).map(m => [m.photo_index, m.marks || []]));
    body.innerHTML = `<p class="recat"><span>⚠ ${esc(out.caveat || "AI suggestions are research possibilities, not identifications.")}</span></p>
      <h3>Ranked candidates</h3><ol class="cands">${(out.candidates || []).map((c, k) => `<li><label class="check"><input type="checkbox" data-cand="${k}" checked> <strong>${esc(c.name)}</strong> <span class="chip">${esc(c.confidence)}</span></label><p class="why"><strong>Why:</strong> ${esc(c.why)}</p>${c.why_not ? `<p class="whynot"><strong>Why not:</strong> ${esc(c.why_not)}</p>` : ""}</li>`).join("")}</ol>
      ${[...marksBy].map(([pi, ms]) => { const p = ps[pi]; if (!p) return ""; return `<h3>Suggested marks · ${esc(p.label)}</h3><div class="ai-photo"><div class="mk-wrap" data-pi="${pi}"><img src="${esc(p.src)}" alt="${esc(p.label)}"></div>
        <ol class="ai-marks">${ms.map((m, k) => `<li><label class="check"><input type="checkbox" data-mk="${pi}:${k}" checked> <span class="mk-n">${k + 1}</span></label><input class="ai-lbl" data-lbl="${pi}:${k}" value="${esc(m.label)}" aria-label="Label for mark ${k + 1}"><p class="help">${esc(m.explanation)}</p></li>`).join("")}</ol></div>`; }).join("")}
      ${(out.gaps || []).length ? `<h3>What would help</h3><ul>${out.gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
      ${out.measurements && (out.measurements.length_mm || out.measurements.note) ? `<h3>Measurements from the scale photo</h3><p>${["length_mm", "width_mm", "thickness_mm"].filter(k => out.measurements[k]).map(k => `${k.split("_")[0]} ≈ ${esc(out.measurements[k])} mm`).join(" · ") || "Not measurable"} ${out.measurements.note ? `<span class="muted">${esc(out.measurements.note)}</span>` : ""}</p><p class="help">Approximate: read from the photo, not a caliper.</p>` : ""}
      ${(out.next_photos || []).length ? `<h3>Next photos to take</h3><ul>${out.next_photos.map(g => `<li>📷 ${esc(g)}</li>`).join("")}</ul>` : ""}
      ${(out.alternatives || []).length ? `<p class="muted"><strong>Also consider:</strong> ${out.alternatives.map(esc).join(", ")}</p>` : ""}
      ${(out.similar_used || []).length ? `<p class="help">Compared against verified references: ${out.similar_used.map(x => esc(x.catalog_id + " " + x.confirmed_type)).join(", ")}</p>` : ""}
      <div id="aiFb"></div>
      <div class="row"><button type="button" class="btn primary" id="aiAccept">Accept selected</button><button type="button" class="btn" id="aiDiscard">Discard</button></div>`;
    for (const [pi, ms] of marksBy) { const w = body.querySelector(`.mk-wrap[data-pi="${pi}"]`); if (w) Marks.overlay(w, w.querySelector("img"), ms, true); }
    $("#aiDiscard").onclick = () => dlg.close();
    if (window.Learn && (out.candidates || []).length) Learn.feedbackBox($("#aiFb"), r, out.candidates[0].name, "ai");
    $("#aiAccept").onclick = async () => {
      const cands = (out.candidates || []).filter((_, k) => body.querySelector(`[data-cand="${k}"]`).checked), patch = {};
      if (cands.length) { cands.slice(0, 3).forEach((c, k) => patch["suggestion_" + (k + 1)] = c.name); patch.confidence = cands[0].confidence;
        patch.owner_observations = [r.owner_observations, `AI photo analysis reviewed and accepted by owner on ${new Date().toLocaleDateString("en-CA")}.`].filter(Boolean).join(" "); }
      if (Object.keys(patch).length) await App.patch(r.catalog_id, patch);
      for (const [pi, ms] of marksBy) { const keep = ms.map((m, k) => ({ ...m, label: (body.querySelector(`[data-lbl="${pi}:${k}"]`).value || m.label), source: "ai" })).filter((_, k) => body.querySelector(`[data-mk="${pi}:${k}"]`).checked);
        if (keep.length) { const cur = App.marksFor(App.all.find(x => x.catalog_id === r.catalog_id), ps[pi].i); await App.saveMarks(r.catalog_id, ps[pi].i, [...cur, ...keep]); } }
      dlg.close(); App.toast("AI suggestions saved. Edit or delete them anytime."); App.reselect(); };
  }

  /* ---------- gating ---------- */
  function canAddFind(all) { const s = st(); if (!s.user || isMember()) return true; return all.length < (C.freeFindLimit || 50); }

  /* ---------- PWA install ---------- */
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; const b = $("#installBtn"); if (b) b.hidden = false; });
  document.addEventListener("click", async e => { if (e.target.id !== "installBtn" || !deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; e.target.hidden = true; });
  document.addEventListener("DOMContentLoaded", () => { const h = $("#installHint"); if (h && /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone) { h.hidden = false; h.textContent = "Tip: on iPhone, tap Share → Add to Home Screen to use this like an app."; } });

  async function render(view, param) { await init(); nav();
    if (view === "map") renderMap(); if (view === "labels") renderLabels(); if (view === "profile") renderProfile(); if (view === "members") renderMembers(); if (view === "c") renderCollection(param); if (view === "pricing") renderPricing();
    if (view === "add") { const inp = document.querySelector('#wizard [name="find_location_private"]'), h = $("#wizCapture"); if (h && !h.dataset.on) { h.dataset.on = 1; captureWidget(h, inp); } } }
  window.Features = { isEditor, render, decorate, canAddFind, captureWidget, isMember: () => isMember(), reset() { ready = null; } };
})();
