/* UnEarthed Finds: Guest mode (#/try). No account, no email, no upload.
   - Up to 3 guest finds, each with up to 4 photos, stored ONLY in this browser (IndexedDB "uf-guest"; localStorage fallback). Nothing is sent to any server.
   - Photos are re-encoded through a canvas on this device, which drops all EXIF/GPS metadata. No exact-location fields exist: one optional town/county box that rejects coordinates and street addresses.
   - Guests get the free rules-based analysis, the attribute form, photo checks, Learn and Discover. No AI call, no sharing, no public/collab features.
   - At the limit, or on "Save for keeps": email-only magic link. After sign-in the guest finds can be imported as PRIVATE finds (free private limit and plan guard respected;
     a plan is never granted), and each local copy is deleted only after its import has synced.
   - Anonymous counters (guest_start / guest_find / guest_signup_click / guest_import): kind + timestamp only, via log_guest_event(). No IP, id or cookie. */
(() => {
  "use strict";
  const MOCK = window.ROLLING_OAK_MOCK || null, MAX = 3, MAXP = 4, DBN = "uf-guest", LSK = "uf-guest-finds";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NOTICE = "Guest finds stay on this device only; clearing your browser deletes them.";
  const KINDS = { artifact: "Artifact", fossil: "Fossil", rock: "Rock / mineral" };
  const TAGS = ["front", "back", "edge", "base", "scale", "other"];
  const user = () => (window.Cloud && Cloud.state ? Cloud.state().user : null);
  /* ---------- storage: IndexedDB, with a localStorage fallback (private-mode browsers) ---------- */
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore("finds", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("finds", mode), s = t.objectStore("finds"), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  const lsAll = () => { try { return JSON.parse(localStorage.getItem(LSK) || "[]"); } catch { return []; } };
  let cache = null;
  async function list() { if (cache) return cache; let r; try { r = await tx("readonly", s => s.getAll()); } catch { r = lsAll(); } return (cache = (r || []).sort((a, b) => String(a.created).localeCompare(String(b.created)))); }
  async function put(rec) { try { await tx("readwrite", s => s.put(rec)); } catch { const a = lsAll().filter(x => x.id !== rec.id); a.push(rec); localStorage.setItem(LSK, JSON.stringify(a)); } cache = null; }
  async function del(id) { try { await tx("readwrite", s => s.delete(id)); } catch { /* fall through to localStorage */ } try { localStorage.setItem(LSK, JSON.stringify(lsAll().filter(x => x.id !== id))); } catch {} cache = null; }
  async function count() { return (await list()).length; }
  /* ---------- anonymous counters ---------- */
  function ping(kind) { try { if (kind === "guest_start") { if (sessionStorage.getItem("uf-guest-started")) return; sessionStorage.setItem("uf-guest-started", "1"); } /* one per browser session */
      if (MOCK) { (MOCK.guestEvents = MOCK.guestEvents || []).push(kind); return; }
      const sb = window.Cloud && Cloud.client && Cloud.client(); if (sb) sb.rpc("log_guest_event", { p_kind: kind }).then(() => {}, () => {}); } catch { /* counters are optional */ } }
  /* ---------- photos: re-encode on this device (EXIF/GPS gone), smaller than the signed-in flow to keep browser storage light ---------- */
  function reencode(file) { return new Promise((res, rej) => { if (!/^image\//.test(file.type || "")) return rej(new Error("Not an image")); const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.82)); }; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Unreadable image")); }; img.src = url; }); }
  /* town / county only: refuse coordinates and street addresses */
  const COORD = /-?\d{1,3}\.\d{3,}|\b\d{1,3}\s*°|\b\d{1,3}\s*[ns]\b.*\b\d{1,3}\s*[ew]\b/i, ADDR = /\b\d{1,6}\s+[a-z0-9.' -]{2,30}\s+(st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|boulevard|ct|court|hwy|highway|way|pkwy|trl|trail)\b|\b(cr|county road|fm|farm road)\s*\d+/i;
  const placeProblem = v => !v ? "" : COORD.test(v) || /\bgps\b|latitude|longitude/i.test(v) ? "Please enter just a town or county, not coordinates." : ADDR.test(v) || /\b\d{5}(-\d{4})?\b/.test(v) ? "Please enter just a town or county, not an address or ZIP code." : "";
  const clip = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
  /* attribute answers -> words the rules engine understands (also what is imported as key features) */
  const attrSentence = (a, kind) => window.Matching ? Object.entries(Matching.clean(a || {}, kind)).filter(([k]) => !/_mm$/.test(k) && k !== "material" && k !== "setting").map(([, v]) => v).join("; ") : "";
  const forAnalysis = r => ({ ...r, key_features: [r.key_features, attrSentence(r.attrs, r.category)].filter(Boolean).join(". ") });
  /* ---------- views ---------- */
  const body = () => $("#tryBody");
  const notice = () => `<p class="dir-note guest-notice" role="note"><strong>${esc(NOTICE)}</strong> Nothing is uploaded and no account or email is needed.</p>`;
  const route = () => { const m = location.hash.match(/^#\/try(?:\/([\w-]+))?/); return m ? m[1] || "" : null; };
  async function render() { const el = body(); if (!el) return; const r = route(); if (r === null) return; if (!user()) ping("guest_start");
    const finds = await list(); let h = "";
    if (r === "new") h = await formHtml(finds); else if (r && finds.find(f => f.id === r)) h = detailHtml(finds.find(f => f.id === r)); else h = listHtml(finds);
    el.innerHTML = `<p class="kicker">Try it</p><h1 id="try-h">Try UnEarthed Finds without an account</h1>${notice()}${await importHtml(finds)}${h}`;
    bind(el, finds, r); updateBanner(); }
  function listHtml(finds) { const left = MAX - finds.length;
    return `<p class="lede">Add up to ${MAX} finds to see how the catalog and the free analysis work. You have used <strong id="tryCount">${finds.length} of ${MAX}</strong>.</p>
      <div class="row"><a class="btn primary" id="tryAdd" href="#/try/new" ${left <= 0 ? 'data-limit="1"' : ""}>＋ Add a guest find</a><a class="btn outline" href="#/learn">Learn</a><a class="btn outline" href="#/discover">Discover public finds</a>${finds.length ? '<button type="button" class="btn" data-try-save>💾 Save for keeps (sign up free)</button>' : ""}</div>
      <ul class="try-list">${finds.map(f => `<li class="try-card" data-id="${esc(f.id)}">${f.photos[0] ? `<img src="${esc(f.photos[0].src)}" alt="" width="96" height="72">` : '<span class="try-ph" aria-hidden="true">◆</span>'}<div><strong>${esc(f.fields.object_type || "Find")}</strong> <span class="chip">${esc(KINDS[f.fields.category] || "")}</span><br><span class="muted">${esc(f.id)} · ${f.photos.length} photo${f.photos.length === 1 ? "" : "s"}${f.fields.region ? " · " + esc(f.fields.region) : ""}</span></div>
        <div class="row"><a class="btn small" href="#/try/${esc(f.id)}">Open</a><button type="button" class="btn small outline" data-try-del="${esc(f.id)}">Delete</button></div></li>`).join("") || '<li class="muted">No guest finds yet.</li>'}</ul>
      ${left <= 0 ? signupHtml("You've used all 3 guest finds. Sign up free to keep them and add more.") : ""}
      <h2>What guests can and can't do</h2><ul class="help"><li>✔ Add photos and details, run the free rules-based analysis, use the attribute form and photo checks, read Learn, browse Discover.</li><li>🔒 Sign up free (email only) for AI ID, saving to your account, sharing and collaboration.</li><li>Exact locations are never asked for here. A town or county is optional.</li></ul>`; }
  const signupHtml = lead => `<section class="try-signup" id="trySignup" aria-labelledby="try-su-h"><h2 id="try-su-h">Save your finds: sign up free</h2><p>${esc(lead || "Create a free account with just your email.")} We email you a one-time link. No password, no phone number, no name.</p>
      <form id="trySignupForm" novalidate class="row"><label class="field grow"><span>Email</span><input id="trySignupEmail" type="email" autocomplete="email" required></label><button type="submit" class="btn primary">Email me a sign-up link</button></form><p id="trySignupMsg" class="help" aria-live="polite"></p>
      <p class="help">After you sign in, we'll offer to move your guest finds into your account as <strong>private</strong> finds (Free accounts keep up to 5 private). Nothing becomes public, and no paid plan is ever added.</p></section>`;
  async function formHtml(finds) { if (finds.length >= MAX) return `<p class="err" role="alert">Guest mode holds ${MAX} finds.</p>${signupHtml("You've used all 3 guest finds. Sign up free to keep them and add more.")}`;
    const kind = "artifact";
    return `<h2>Add a guest find <span class="muted">(${finds.length + 1} of ${MAX})</span></h2><form id="tryForm" novalidate class="try-form"><p class="err" id="tryErr" role="alert" hidden></p>
      <fieldset><legend>What is it?</legend><div class="row" role="radiogroup" aria-label="Kind">${Object.entries(KINDS).map(([k, l], i) => `<label class="check"><input type="radio" name="category" value="${k}" ${i ? "" : "checked"}> ${l}</label>`).join("")}</div>
        <label class="field"><span>What do you call it? <em class="req">*</em></span><input name="object_type" maxlength="80" placeholder="e.g. stemmed point, oyster fossil, quartz crystal" required></label>
        <label class="field"><span>What do you see? <span class="muted">(shape, edges, surface, color)</span></span><textarea name="key_features" rows="3" maxlength="1500" placeholder="e.g. triangular blade, notches at the base, flake scars on both faces"></textarea></label>
        <label class="field"><span>Notes <span class="muted">(optional)</span></span><textarea name="owner_observations" rows="2" maxlength="800"></textarea></label>
        <label class="field"><span>Town or county <span class="muted">(optional; never an address or coordinates)</span></span><input name="region" maxlength="80" autocomplete="off" placeholder="e.g. Bastrop County, Texas"></label></fieldset>
      <fieldset id="tryAttrs"><legend>Details that help the analysis <span class="muted">(all optional here)</span></legend><div class="ai-pre-grid" id="tryAttrGrid">${attrFields("artifact")}</div></fieldset>
      <fieldset><legend>Photos <span class="muted">(up to ${MAXP})</span></legend><details class="ai-pre-shots" open><summary>Photos that help</summary><ul><li>Both faces, edge profile, base and tip, a ruler or coin for scale, side light, plain background.</li></ul></details>
        <div class="row"><label class="field"><span>View tag</span><select id="tryTag">${TAGS.map(t => `<option>${t}</option>`).join("")}</select></label><label class="field grow"><span>Choose photos <em class="req">*</em></span><input type="file" id="tryFile" accept="image/*" multiple></label></div>
        <p class="help">Photos are shrunk and re-saved in your browser, which removes camera location data. They are never uploaded.</p><div id="tryThumbs" class="try-thumbs" aria-live="polite"></div><div id="tryPQ" class="help" role="status"></div></fieldset>
      <label class="check"><input type="checkbox" name="landowner_permission"> I had permission to collect this (private land)</label>
      <div class="row"><button type="submit" class="btn primary" id="trySave">Save guest find</button><a class="btn" href="#/try">Cancel</a></div></form>`; }
  const attrFields = kind => (window.Matching ? Matching.ATTRS[kind] : []).map(d => d.num ? `<label class="field"><span>${esc(d.label)}</span><input type="number" min="0" step="any" inputmode="decimal" name="a_${d.k}"></label>`
    : `<label class="field"><span>${esc(d.label)}</span><select name="a_${d.k}"><option value="">Not sure / skip</option>${d.options.map(o => `<option>${esc(o)}</option>`).join("")}</select></label>`).join("");
  function detailHtml(f) { const r = forAnalysis({ ...f.fields, attrs: f.attrs, photos: f.photos.map(p => ({ tag: p.tag, view: p.tag })), catalog_id: f.id });
    return `<p><a href="#/try">← All guest finds</a></p><h2>${esc(f.fields.object_type || "Find")} <span class="chip">${esc(KINDS[f.fields.category] || "")}</span> <span class="muted">${esc(f.id)}</span></h2>
      <p class="help guest-only">👤 Guest find: stored only in this browser. Not shared, not public.</p>
      <div class="try-photos">${f.photos.map((p, i) => `<figure><img src="${esc(p.src)}" alt="${esc(p.tag)} view" width="220"><figcaption>${esc(p.tag)} <span class="help" data-pq="${i}"></span></figcaption></figure>`).join("")}</div>
      <dl class="try-facts">${[["Features", f.fields.key_features], ["Notes", f.fields.owner_observations], ["Town / county", f.fields.region], ["Material", f.fields.material], ["Size", [f.fields.length_mm && "L " + f.fields.length_mm, f.fields.width_mm && "W " + f.fields.width_mm, f.fields.thickness_mm && "T " + f.fields.thickness_mm].filter(Boolean).join(" × ") + (f.fields.length_mm ? " mm" : "")]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div class="try-ai"><button type="button" class="btn" data-try-ai>🔒 Sign up free to run AI ID</button><span class="help">The AI looks at your photos and ranks possibilities. Free with an account.</span></div>
      <h3>Free analysis (runs on this device)</h3><div id="tryAnalysis" class="analysis-host" data-id="${esc(f.id)}">${window.Analysis ? "" : '<p class="help">Analysis is loading…</p>'}</div>
      <div class="row"><button type="button" class="btn" data-try-save>💾 Save for keeps (sign up free)</button><button type="button" class="btn outline" data-try-del="${esc(f.id)}">Delete this guest find</button></div><div id="tryAiUp"></div>`; }
  /* ---------- import after sign-in ---------- */
  async function importHtml(finds) { if (!user() || !finds.length) return "";
    const cap = window.Membership ? Membership.config().free_private_limit : 5, member = window.Membership && Membership.isMember && Membership.isMember();
    return `<section class="try-import" id="tryImport" aria-labelledby="try-im-h"><h2 id="try-im-h">Import your guest finds</h2><p>You're signed in. Move your ${finds.length} guest find${finds.length === 1 ? "" : "s"} into your account as <strong>private</strong> finds?${member ? "" : ` Free accounts keep up to ${cap} private finds; if you reach that, the rest stay on this device and nothing is made public.`} Each local copy is deleted only after its import has synced.</p>
      <div class="row"><button type="button" class="btn primary" data-try-import>Import ${finds.length} find${finds.length === 1 ? "" : "s"} (private)</button><button type="button" class="btn outline" data-try-keep>Not now</button></div><ul id="tryImportLog" class="help" aria-live="polite"></ul></section>`; }
  async function runImport() { const log = $("#tryImportLog"), say = (t, bad) => { if (log) log.insertAdjacentHTML("beforeend", `<li class="${bad ? "err" : ""}">${esc(t)}</li>`); };
    if (!window.App || !App.importGuestFind) return say("Import isn't available yet; try again in a moment.", true);
    const btn = $("[data-try-import]"); if (btn) btn.disabled = true; let ok = 0, left = 0, stop = "";
    for (const f of await list()) { if (f.importedAs) { /* imported earlier but not yet synced: never import twice; drop the copy once the synced find exists */
        const there = window.App && App.all.some(x => x.catalog_id === f.importedAs), pend = window.App && App.pending().includes(f.importedAs);
        if (there && !pend) { await del(f.id); ok++; ping("guest_import"); say(`✓ ${f.fields.object_type || f.id} (${f.importedAs}) has synced. The local copy was removed.`); } else { left++; say(`${f.fields.object_type || f.id} (${f.importedAs}) is still waiting to sync; the guest copy is kept.`, true); } continue; }
      if (stop) { left++; continue; }
      const res = await App.importGuestFind({ fields: { ...f.fields, key_features: [f.fields.key_features, attrSentence(f.attrs, f.fields.category)].filter(Boolean).join(". ") }, photos: f.photos });
      if (res.ok) { if (res.synced) { try { const m = JSON.parse(localStorage.getItem("ro-ai-attrs") || "{}"); if (f.attrs && Object.keys(f.attrs).length) { m[res.id] = f.attrs; localStorage.setItem("ro-ai-attrs", JSON.stringify(m)); } } catch {}
            await del(f.id); ok++; ping("guest_import"); say(`✓ ${f.fields.object_type || f.id} is now ${res.id} (private). The local copy was removed.`); }
        else { f.importedAs = res.id; await put(f); left++; say(`${f.fields.object_type || f.id} was saved as ${res.id} but hasn't synced yet. We kept the guest copy until it does.`, true); } }
      else if (res.reason === "limit") { stop = "limit"; left++; say(`Your free private limit is reached, so ${f.fields.object_type || f.id} and any others stay on this device. Nothing was made public and no plan was changed.`, true); }
      else { left++; stop = res.reason; say(`Couldn't import ${f.fields.object_type || f.id} (${res.reason}${res.msg ? ": " + res.msg : ""}). It's still on this device.`, true); } }
    say(ok ? `Done: ${ok} imported${left ? `, ${left} still on this device` : ""}.` : "Nothing was imported."); if (btn) btn.disabled = false; if (ok) { cache = null; setTimeout(() => { if (route() !== null) render(); updateBanner(); }, 1500); } }
  /* ---------- wiring ---------- */
  function bind(el, finds, r) {
    $$("[data-try-del]", el).forEach(b => b.onclick = async () => { if (!confirm("Delete this guest find from this device? This can't be undone.")) return; await del(b.dataset.tryDel); if (route() !== "") location.hash = "#/try"; else render(); });
    $$("[data-try-save], [data-try-ai]", el).forEach(b => b.onclick = () => { ping("guest_signup_click"); const host = $("#tryAiUp") || $("#trySignup"); if (!$("#trySignup")) { (host || el).insertAdjacentHTML("beforeend", signupHtml(b.hasAttribute("data-try-ai") ? "AI ID is free with an account." : "")); bindSignup(el); }
      const sx = $("#trySignup"); if (sx) sx.scrollIntoView({ block: "center" }); const em = $("#trySignupEmail"); if (em) em.focus(); });
    const add = $("#tryAdd"); if (add && add.dataset.limit) add.onclick = e => { e.preventDefault(); ping("guest_signup_click"); const sx = $("#trySignup"); if (sx) { sx.scrollIntoView({ block: "center" }); $("#trySignupEmail").focus(); } };
    bindSignup(el); const im = $("[data-try-import]", el); if (im) im.onclick = runImport; const kp = $("[data-try-keep]", el); if (kp) kp.onclick = () => { $("#tryImport").hidden = true; };
    if (r && r !== "new") { const f = finds.find(x => x.id === r), host = $("#tryAnalysis"); if (f && host) { const draw = () => { if (!window.Analysis) return setTimeout(draw, 300); const rec = forAnalysis({ ...f.fields, attrs: f.attrs, photos: f.photos.map(p => ({ tag: p.tag, view: p.tag })), catalog_id: f.id });
          try { host.innerHTML = Analysis.render(rec, rec.category); $$(".confirm", host).forEach(c => c.remove()); } catch (e) { host.innerHTML = '<p class="err">Analysis could not run on this find.</p>'; } }; draw();
        if (window.AiPre) f.photos.forEach(async (p, i) => { const q = await AiPre.quality(p.src), is = AiPre.issuesOf(q), c = $(`[data-pq="${i}"]`); if (c) c.textContent = q ? (is.length ? "⚠ " + is.join("; ") : "✓ looks sharp and bright") : ""; }); } }
    if (r === "new" && $("#tryForm", el)) bindForm(el); }
  function bindSignup(el) { const f = $("#trySignupForm", el); if (!f || f.dataset.b) return; f.dataset.b = "1";
    f.onsubmit = async e => { e.preventDefault(); const em = $("#trySignupEmail").value.trim(), msg = $("#trySignupMsg"); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg.textContent = "Enter a valid email."; msg.className = "err"; return; }
      ping("guest_signup_click"); msg.textContent = "Sending…"; msg.className = "help";
      try { const { error } = await Cloud.magicLink(em); if (error) { msg.textContent = error.message; msg.className = "err"; return; } msg.textContent = "Check your email for a one-time sign-in link. Open it on this same browser and your guest finds will be waiting to import."; msg.className = "help ok"; }
      catch (err) { msg.textContent = "Could not reach the sign-in service: " + err.message; msg.className = "err"; } }; }
  function bindForm(el) { const photos = []; const form = $("#tryForm", el), th = $("#tryThumbs", el), pq = $("#tryPQ", el);
    const draw = () => { th.innerHTML = photos.map((p, i) => `<figure><img src="${esc(p.src)}" alt="${esc(p.tag)}" width="96"><figcaption>${esc(p.tag)} <button type="button" class="btn small outline" data-rm="${i}" aria-label="Remove photo ${i + 1}">✕</button></figcaption></figure>`).join("");
      $$("[data-rm]", th).forEach(b => b.onclick = () => { photos.splice(+b.dataset.rm, 1); draw(); check(); }); };
    const check = async () => { if (!window.AiPre || !photos.length) { pq.textContent = ""; return; } const out = []; for (const p of photos) { const is = AiPre.issuesOf(await AiPre.quality(p.src)); if (is.length) out.push(`${p.tag}: ${is.join("; ")}`); } pq.innerHTML = out.length ? "⚠ Photo check:<ul>" + out.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>You can retake these, or save anyway." : `✓ Photo check: ${photos.length} photo${photos.length === 1 ? "" : "s"} look sharp and bright enough.`; };
    $("#tryFile", el).onchange = async e => { const err = $("#tryErr"); for (const file of [...e.target.files]) { if (photos.length >= MAXP) { err.hidden = false; err.textContent = `Up to ${MAXP} photos per guest find.`; break; } try { photos.push({ name: "photo", tag: $("#tryTag").value, src: await reencode(file) }); } catch { err.hidden = false; err.textContent = "Could not read " + clip(file.name, 40) + "."; } } e.target.value = ""; draw(); check(); };
    $$("input[name=category]", form).forEach(r => r.onchange = () => { const k = form.category.value; $("#tryAttrGrid").innerHTML = attrFields(k); });
    form.onsubmit = async e => { e.preventDefault(); const err = $("#tryErr"), fail = m => { err.hidden = false; err.textContent = m; err.scrollIntoView({ block: "nearest" }); };
      const finds = await list(); if (finds.length >= MAX) return fail("Guest mode holds 3 finds. Sign up free to keep them and add more.");
      const kind = form.category.value, ot = clip(form.object_type.value, 80); if (!ot) return fail("Please say what it is (a short name is fine)."); if (!photos.length) return fail("Add at least one photo.");
      const place = clip(form.region.value, 80), pp = placeProblem(place); if (pp) return fail(pp);
      const raw = {}; (window.Matching ? Matching.ATTRS[kind] : []).forEach(d => { const el2 = form.elements["a_" + d.k]; if (el2 && el2.value) raw[d.k] = el2.value; }); const attrs = window.Matching ? Matching.clean(raw, kind) : {};
      const fields = { category: kind, object_type: ot, key_features: clip(form.key_features.value, 1500), owner_observations: clip(form.owner_observations.value, 800), region: place, landowner_permission: form.landowner_permission.checked ? "Yes" : "No" };
      if (attrs.material && !/^(unknown|other)$/.test(attrs.material)) fields.material = attrs.material; ["length_mm", "width_mm", "thickness_mm"].forEach(k => { if (attrs[k]) fields[k] = attrs[k]; }); if (fields.length_mm) fields.measure_method = "Estimated";
      if (/[-\d]\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/.test(JSON.stringify(fields))) return fail("Please remove coordinates from the text. Guest finds never store exact locations.");
      const n = [...finds.map(x => +String(x.id).replace(/\D/g, "")), 0]; const id = "G-" + (Math.max(...n) + 1);
      try { await put({ id, created: new Date().toISOString(), fields, attrs, photos: photos.map(p => ({ name: p.name, tag: p.tag, src: p.src })) }); }
      catch (ex) { return fail("This browser couldn't store the photos (storage may be full or private mode). Try fewer or smaller photos."); }
      ping("guest_find"); location.hash = "#/try/" + id; }; }
  /* ---------- banner: signed-in people who still have guest finds on this device ---------- */
  async function updateBanner() { const b = $("#guestBanner"); if (!b) return; const n = user() ? await count() : 0; b.hidden = !n || route() !== null;
    if (!b.hidden) b.innerHTML = `<span>👤 You have ${n} guest find${n === 1 ? "" : "s"} on this device.</span> <a class="btn small primary" href="#/try">Import into your account (private)</a>`; }
  const onRoute = () => { if (route() !== null) render(); else updateBanner(); };
  addEventListener("hashchange", onRoute); document.addEventListener("DOMContentLoaded", () => { setTimeout(onRoute, 0); if (window.Cloud && Cloud.on) Cloud.on(() => { updateBanner(); if (route() !== null) render(); }); });
  document.addEventListener("click", e => { const t = e.target.closest("[data-guest-try]"); if (!t) return; e.preventDefault(); const d = t.closest("dialog"); if (d && d.close) d.close(); location.hash = "#/try"; });
  window.Guest = { MAX, MAXP, NOTICE, list, count, put, del, render, placeProblem, reencode, updateBanner, runImport };
})();
