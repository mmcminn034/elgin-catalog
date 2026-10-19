/* Membership v1 (preview): Free / Annual / Lifetime, private-item gate, named catalogs + custom find names,
   public UF ids (only while public), Merch, Experts (apply, owner queue, inbox, Ask an Expert), owner admin (manual plan grants),
   lapse banner, and the Stripe-ready checkout stub ("Coming soon" until Stripe is connected).
   Server-side rules live in supabase/migrations/012_membership_v1.sql; this file mirrors them in the UI and never weakens them.
   Works in three modes: MOCK (tests), live DB with migration 012 (C.schema012 = true), and live DB before 012 (UI gates only). */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, MOCK = window.ROLLING_OAK_MOCK || null;
  const $ = s => document.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DEF = Object.assign({ free_private_limit: 5, ai_daily_cap: 50, lapse_grace_days: 7, free_expert_questions_month: 3 }, C.membership || {}, (MOCK && MOCK.config) || {});
  const PLANS = [
    { id: "free", name: "Free", price_cents: 0, billing_interval: null, blurb: "Catalog and identify your finds.",
      features: ["Unlimited AI identifications", "Named catalogs and custom find names", "5 private items (later items are public)", "Ask an Expert: {q} questions a month", "Exact locations are always private"] },
    { id: "annual", name: "Annual", price_cents: 2999, billing_interval: "year", blurb: "For collectors who keep most finds private.",
      features: ["Everything in Free", "<strong>Unlimited private items</strong>", "Switch any item between private and public", "<strong>Unlimited</strong> expert questions, answered first", "Cancel anytime"] },
    { id: "lifetime", name: "Lifetime", price_cents: 5999, billing_interval: "once", tag: "Best value", blurb: "Pay once. Yours for good.",
      features: ["Everything in Annual, permanently", "Future member features at no extra cost", "Priority expert review", "Early access to merch drops", "One payment, no renewals"] }];
  const st = () => (window.Cloud && Cloud.state ? Cloud.state() : {});
  const sb = () => (window.Cloud && Cloud.client ? Cloud.client() : null);
  const s12 = () => MOCK ? MOCK.schema012 !== false : !!C.schema012; /* server features need migration 012 */
  const M = () => { if (!MOCK) return null; return MOCK.m12 = MOCK.m12 || { products: [], experts: [], questions: [], answers: [], invites: [], grants: [], users: [], aiUsed: 0 }; };
  const toast = (m, o) => window.App ? App.toast(m, o) : alert(m);
  const q = async p => { try { const { data, error } = await p; return error ? { error: error.message } : { data }; } catch (e) { return { error: e.message }; } };
  const money = c => c ? "$" + (c / 100).toFixed(2) : "$0";
  const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const ufId = () => "UF-" + Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");

  /* ---------- state ---------- */
  let cfg = { ...DEF }, prof = null, cols = [], loadedFor = undefined, loading = null;
  async function load(force) {
    const uid = (st().user || {}).id || null; if (!force && loadedFor === uid && loading) return loading;
    loadedFor = uid; return loading = (async () => {
      prof = uid && window.Cloud ? await Cloud.profile() : null; cols = uid && window.Cloud ? await Cloud.collections() : [];
      if (s12() && !MOCK && sb()) { const r = await q(sb().from("app_config").select("key, value")); (r.data || []).forEach(x => { if (x.key in cfg) cfg[x.key] = +x.value || cfg[x.key]; }); }
      banner(); adminNav(); })();
  }
  const ownerId = () => (MOCK && MOCK.adminUserId) || C.adminUserId;
  const isOwner = () => { const u = st().user; return !!u && u.id === ownerId(); };
  const isAdmin = () => isOwner() || !!(prof && prof.is_admin);
  function plan() { if (!st().user) return "free"; if (isOwner()) return "lifetime"; const m = prof && prof.membership;
    if (m === "lifetime") return "lifetime"; if ((m === "annual" || m === "member") && (!prof.membership_expires || new Date(prof.membership_expires) > new Date())) return "annual"; return "free"; }
  const isMember = () => plan() !== "free";
  function lapse() { if (!prof || isOwner() || !["annual", "member"].includes(prof.membership) || !prof.membership_expires) return null;
    const exp = new Date(prof.membership_expires); if (exp > new Date()) return null; const start = prof.lapse_notice_at ? new Date(prof.lapse_notice_at) : exp;
    return { expired: exp, due: new Date(+start + cfg.lapse_grace_days * 864e5) }; }
  const vis = r => (window.Learn && Learn.vis ? Learn.vis(r) : r.visibility || (r.is_public === false ? "editors" : "public"));
  const nameOf = r => (r && (r.title || r.object_type || r.suggestion_1)) || "Find";
  function mine() { const u = st().user; return (window.App ? App.all : []).filter(r => !u ? true : r._owner ? r._owner === u.id : (r._src !== "seed" || isOwner())); } /* the published seed catalog belongs to the owner */
  const privateCount = except => mine().filter(r => r.catalog_id !== except && vis(r) !== "public").length;
  const canPrivate = except => !st().user || isMember() || privateCount(except) < cfg.free_private_limit;
  const LIMIT_MSG = () => `Free accounts include ${cfg.free_private_limit} private items. Annual or Lifetime gives you unlimited private items.`;
  const LOCK_MSG = "Free accounts can't switch a public item back to private. Annual or Lifetime unlocks the private/public toggle.";
  /* returns an error message when a visibility change is not allowed, else null */
  function guardVis(r, to) { if (!st().user || isMember() || !r) return null; const from = vis(r), priv = to !== "public";
    if (from === "public" && priv) return LOCK_MSG; if (from !== "public" && priv) return null; return null; }
  /* mock of the DB trigger (finds_zy_private_gate): used by Cloud.pushFind in MOCK mode so tests see the server refusal too */
  function serverGate(rec) { if (!MOCK || !st().user || isMember()) return null; const v = rec.visibility || (rec.is_public === false ? "editors" : "public"); if (v === "public") return null;
    const prev = (MOCK.pushed || []).filter(p => p.catalog_id === rec.catalog_id).pop(); if (prev && (prev.visibility || "public") === "public") return "toggle_locked: " + LOCK_MSG;
    const priv = new Set((MOCK.pushed || []).filter(p => p.visibility && p.visibility !== "public").map(p => p.catalog_id)); priv.delete(rec.catalog_id);
    return priv.size >= cfg.free_private_limit + (MOCK.privateBaseline || 0) ? "free_private_limit: " + LIMIT_MSG() : null; }

  /* ---------- wrap the existing write paths so every control obeys the gate ---------- */
  function wrap() {
    if (window.App && !App._m12) { const patch = App.patch; App._m12 = true;
      App.patch = async (id, obj) => { const r = App.all.find(x => x.catalog_id === id); let o = { ...obj };
        if (r && ("visibility" in o || "is_public" in o)) { const to = o.visibility || (o.is_public === false ? "editors" : "public"); const err = guardVis(r, to);
          if (err) { delete o.visibility; delete o.is_public; delete o.show_on_discover; delete o.vis_before_discover; toast("🔒 " + err, { warn: true, ms: 7000 }); setTimeout(() => App.reselect && App.reselect(), 30); }
          else if (to === "public" && vis(r) !== "public") o = { ...o, ...(await publicIdPatch(r, true)) };
          else if (to !== "public" && vis(r) === "public") o = { ...o, public_id: null }; }
        if (!Object.keys(o).length) return; const changed = r && "visibility" in o && o.visibility !== vis(r), res = await patch(id, o);
        if (changed && App.current && App.current.catalog_id === id) setTimeout(() => App.reselect && App.reselect(), 30); /* refresh the visibility chips + UF id on the open record */ return res; }; }
    if (window.Cloud && !Cloud._m12) { Cloud._m12 = true; const sfv = Cloud.setFindVisibility, sv = Cloud.setVisibility;
      Cloud.setFindVisibility = async (id, v) => { const r = window.App && App.all.find(x => x.catalog_id === id), err = guardVis(r, v); /* App.patch already refused, so r still holds the old visibility */
        if (err) return { error: err }; const res = await sfv(id, v); if (!res.error && v === "public") await refreshPublicId(id); return res; };
      Cloud.setVisibility = async (table, key, val) => { if (table === "finds" && !val) { const r = window.App && App.all.find(x => x.catalog_id === key); const err = guardVis(r, "editors"); if (err) return { error: err }; } return sv(table, key, val); }; }
  }
  /* UF id for a find that is becoming public: the database assigns it (012 trigger); MOCK and pre-012 previews simulate it locally. */
  async function publicIdPatch(r, on) { if (!on) return { public_id: null };
    if (MOCK) { const m = M(); m.registry = m.registry || {}; const id = m.registry[r.catalog_id] || ufId(); m.registry[r.catalog_id] = id; (MOCK.publicFinds = MOCK.publicFinds || {})[id] = r.catalog_id; return { public_id: id }; }
    return {}; }
  async function refreshPublicId(id) { if (MOCK || !s12() || !sb()) return; const r = await q(sb().from("finds").select("public_id").eq("catalog_id", id).maybeSingle());
    if (r.data && r.data.public_id && window.App) { const cur = App.all.find(x => x.catalog_id === id); if (cur && cur.public_id !== r.data.public_id) await App.patch(id, { public_id: r.data.public_id }); } }

  /* ---------- add-find wizard: name, catalog, visibility + the 6th-item warning ---------- */
  function wizard() { const sel = $("#wizCatalog"), v = $("#wizVis"), g = $("#wizGate"); if (!v) return;
    if (sel && !sel.dataset.filled) { const own = cols.filter(c => ["owner", "editor"].includes(c.role)); if (own.length) { sel.innerHTML = own.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(""); sel.dataset.filled = 1; } }
    const ok = canPrivate(); v.querySelector("option[value=private]").disabled = !ok; if (!ok) v.value = "public";
    g.innerHTML = !st().user ? '<p class="help">Sign in to keep finds in your account. Exact locations always stay private.</p>'
      : isMember() ? `<p class="help ok">✓ ${esc(plan() === "lifetime" ? "Lifetime" : "Annual")}: unlimited private items. Exact locations always stay private.</p>`
      : ok ? `<p class="help">🔒 Private items used: <strong>${privateCount()} of ${cfg.free_private_limit}</strong>. Exact locations always stay private.</p>`
      : `<div class="gate-warn" role="alert"><strong>⚠ This find will be saved as PUBLIC.</strong> Your free plan includes ${cfg.free_private_limit} private items and all ${cfg.free_private_limit} are used. Anyone will be able to see its photos, name and general details. <strong>The exact location stays private.</strong> On the free plan it can't be switched back to private later. <a href="#/membership">See plans</a></div>`; }
  function confirmPublic() { return new Promise(res => { let d = $("#memDlg"); if (!d) { d = document.createElement("dialog"); d.id = "memDlg"; d.className = "mem-dlg"; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog"><h2>Save this find as public?</h2><p>Your free plan includes <strong>${cfg.free_private_limit} private items</strong>, and they're all used.</p><ul><li>This find will be <strong>public</strong>: photos, name and general details.</li><li>Its <strong>exact location stays private</strong>, always.</li><li>Free accounts can't switch it back to private later.</li></ul>
      <div class="row"><button value="public" class="btn primary" id="memSavePublic">Save as public</button><a class="btn" href="#/membership" id="memSeePlans">See plans</a><button value="cancel" class="btn ghost">Cancel</button></div></form>`;
    d.querySelector("#memSeePlans").onclick = () => { d.close("cancel"); };
    d.onclose = () => res(d.returnValue === "public"); d.showModal(); }); }
  async function beforeSave(o) { await load(); o.title = String(o.title || "").trim().slice(0, 120) || undefined; if (!o.collection_id) delete o.collection_id;
    o.visibility = o.visibility === "public" ? "public" : "private";
    if (st().user && !canPrivate()) { if (!(await confirmPublic())) return false; o.visibility = "public"; } /* at the free limit: always confirm before a public save */
    o.is_public = o.visibility === "public"; if (o.is_public) Object.assign(o, await publicIdPatch(o, true)); return true; }

  /* ---------- find detail: public id chip, visibility lock, Ask an Expert ---------- */
  function decorateFind() { const box = $("#mBody .rv-layout"), r0 = window.App && App.current; if (!box || !r0) return;
    const r = App.all.find(x => x.catalog_id === r0.catalog_id) || r0, key = [r.catalog_id, vis(r), r.public_id || "", plan()].join("|"); if (box.dataset.m12 === key) return; box.dataset.m12 = key;
    $$(".m12-x", box).forEach(e => e.remove()); const meta = box.querySelector(".rv-meta"), pub = vis(r) === "public" && r.public_id;
    if (meta) meta.insertAdjacentHTML("beforeend", pub ? ` <span class="chip uf-chip m12-x" title="Public ID: used in share links">🌐 ${esc(r.public_id)}</span> <button type="button" class="btn small outline m12-x" data-m12="copy">🔗 Copy public link</button>` : vis(r) === "public" ? ` <span class="chip m12-x">🌐 Public</span>` : "");
    const acts = box.querySelector(".rv-acts"), mayAsk = !!st().user && (!window.Access || Access.canEdit(r)); if (!mayAsk) $$("[data-m12=ask]", box).forEach(e => e.remove());
    if (acts && mayAsk && !acts.querySelector("[data-m12=ask]")) acts.insertAdjacentHTML("beforeend", `<button type="button" class="btn outline" data-m12="ask">🧑‍🔬 Ask an Expert</button>`);
    $$("#mBody select[data-act=vis3], #mBody select[data-act=vis]").forEach(sel => { const locked = st().user && !isMember() && vis(r) === "public";
      [...sel.options].forEach(op => { op.disabled = locked && !["public", "1"].includes(op.value); }); sel.title = locked ? LOCK_MSG : "";
      const note = sel.parentElement.querySelector(".lock-note"); if (locked && !note) sel.insertAdjacentHTML("afterend", `<small class="help lock-note">🔒 ${esc(LOCK_MSG)} <a href="#/membership">Plans</a></small>`); if (!locked && note) note.remove(); }); }
  const publicLink = r => (C.siteUrl || location.href.split("#")[0]) + "#/p/" + r.public_id;
  document.addEventListener("click", async e => { const b = e.target.closest("[data-m12]"); if (!b) return; const r = window.App && App.current; const a = b.dataset.m12;
    if (a === "copy" && r) { try { await navigator.clipboard.writeText(publicLink(r)); toast("Public link copied"); } catch { window.prompt("Copy this link:", publicLink(r)); } }
    if (a === "ask" && r) askDialog(r); });

  /* ---------- Experts data ---------- */
  const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
  async function myQuestions() { const u = st().user; if (!u) return []; if (MOCK) return M().questions.filter(x => x.asker === u.id); if (!s12() || !sb()) return [];
    const r = await q(sb().from("expert_questions").select("*, expert_answers(*)").eq("asker", u.id).order("created_at", { ascending: false })); return r.data || []; }
  async function questionsUsed() { return (await myQuestions()).filter(x => new Date(x.created_at) >= monthStart()).length; }
  async function ask(text, r) { const u = st().user; if (!u) return { error: "Sign in to ask an expert." }; text = String(text || "").trim(); if (text.length < 5) return { error: "Please write a little more (5+ characters)." };
    const context = r ? { title: nameOf(r), type: r.object_type || null, category: r.category || null, material: r.material || null, length_mm: r.length_mm || null, width_mm: r.width_mm || null, photos: (window.App ? App.pics(r) : []).map(p => p.src).filter(s => /^https?:/.test(s)).slice(0, 4) } : {};
    if (!isMember() && (await questionsUsed()) >= cfg.free_expert_questions_month) return { error: `Free accounts can ask ${cfg.free_expert_questions_month} expert questions a month. Annual or Lifetime gives you unlimited questions, answered first.`, limit: true };
    if (MOCK) { const x = { id: "q" + Date.now() + Math.random().toString(36).slice(2, 5), asker: u.id, catalog_id: r ? r.catalog_id : null, question: text, context, status: "open", priority: isMember() ? 10 : 0, created_at: new Date().toISOString() }; M().questions.push(x); return { data: x }; }
    if (!s12() || !sb()) return { error: "Ask an Expert opens after the membership database update." };
    return q(sb().rpc("ask_expert", { p_question: text, p_catalog_id: r ? r.catalog_id : null, p_context: context })); }
  async function expertsList(status) { if (MOCK) return M().experts.filter(x => !status || x.status === status); if (!s12() || !sb()) return [];
    let b = sb().from("experts").select("*").order("applied_at"); if (status) b = b.eq("status", status); return (await q(b)).data || []; }
  async function myExpert() { const u = st().user; if (!u) return null; if (MOCK) return M().experts.find(x => x.user_id === u.id) || null; if (!s12() || !sb()) return null; return (await q(sb().from("experts").select("*").eq("user_id", u.id).maybeSingle())).data || null; }
  async function applyExpert(f) { const u = st().user; if (!u) return { error: "Sign in to apply." }; const row = { user_id: u.id, name: f.name, credentials: f.credentials, specialties: f.specialties, links: f.links };
    if (!row.name) return { error: "Name is required." }; if (MOCK) { M().experts = M().experts.filter(x => x.user_id !== u.id); M().experts.push({ ...row, status: "pending", applied_at: new Date().toISOString() }); return {}; }
    if (!s12() || !sb()) return { error: "Expert applications open after the membership database update." }; return q(sb().from("experts").upsert(row, { onConflict: "user_id" })); }
  async function decideExpert(uid, status) { if (MOCK) { const x = M().experts.find(e => e.user_id === uid); if (x) x.status = status; return {}; } return q(sb().rpc("admin_decide_expert", { p_user: uid, p_status: status })); }
  async function inviteExpert(email) { email = String(email || "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter an email address." };
    if (MOCK) { M().invites.push({ email, status: "pending" }); return {}; } return q(sb().from("expert_invites").insert({ email })); /* emailing the invitee is optional and stubbed */ }
  async function inbox() { if (MOCK) return M().questions.filter(x => x.status === "open").sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));
    if (!s12() || !sb()) return []; return (await q(sb().from("expert_questions").select("*").eq("status", "open").order("priority", { ascending: false }).order("created_at"))).data || []; }
  async function answer(qid, body) { body = String(body || "").trim(); if (!body) return { error: "Write an answer first." };
    if (MOCK) { M().answers.push({ question_id: qid, body, expert_id: st().user.id, created_at: new Date().toISOString() }); const x = M().questions.find(z => z.id === qid); if (x) x.status = "answered"; return {}; }
    return q(sb().from("expert_answers").insert({ question_id: qid, body })); }
  const answersFor = x => MOCK ? M().answers.filter(a => a.question_id === x.id) : (x.expert_answers || []);

  /* ---------- Merch data ---------- */
  async function products(all) { if (MOCK) return M().products.filter(p => all || p.active); if (!s12() || !sb()) return [];
    let b = sb().from("products").select("*").order("sort").order("created_at"); if (!all) b = b.eq("active", true); return (await q(b)).data || []; }
  async function addProduct(p) { if (!isAdmin()) return { error: "Owner only." }; if (MOCK) { M().products.push({ id: "p" + Date.now(), ...p }); return {}; } return q(sb().from("products").insert(p)); }

  /* ---------- admin: plans ---------- */
  async function grantPlan(email, planId, expires) { if (!isAdmin()) return { error: "Owner only." };
    if (MOCK) { const u = M().users.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase()); if (!u) return { error: "No account with that email." }; u.membership = planId; M().grants.push({ email: u.email, plan: planId, expires: expires || null, at: new Date().toISOString() }); return {}; }
    if (!s12() || !sb()) return { error: "Manual grants need the membership database update (migration 012)." };
    const f = await q(sb().rpc("admin_find_user", { p_email: email })); const u = (f.data || [])[0]; if (!u) return { error: f.error || "No account with that email." };
    return q(sb().rpc("admin_grant_plan", { p_user: u.id, p_plan: planId, p_expires: expires || null, p_note: "manual grant" })); }

  /* ---------- catalogs ---------- */
  const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "catalog";
  async function createCatalog(name) { const u = st().user; name = String(name || "").trim(); if (!u) return { error: "Sign in first." }; if (!name) return { error: "Give the catalog a name." };
    if (MOCK) { const c = { id: "c" + Date.now(), slug: slugify(name), name, role: "owner", is_public: false, visibility: "private" }; (MOCK.collections = MOCK.collections || []).push(c); cols = MOCK.collections; return { data: c }; }
    if (!sb()) return { error: "Offline." }; const r = await q(sb().from("collections").insert({ name, slug: slugify(name) + "-" + Math.random().toString(36).slice(2, 6), owner: u.id, visibility: "private", is_public: false }).select().single()); if (!r.error) cols = await Cloud.collections(); return r; }
  async function renameCatalog(id, name) { name = String(name || "").trim(); if (!name) return { error: "Name can't be empty." };
    if (MOCK) { const c = (MOCK.collections || []).find(x => x.id === id); if (c) c.name = name; return {}; } const r = await q(sb().from("collections").update({ name }).eq("id", id)); if (!r.error) cols = await Cloud.collections(); return r; }

  /* ---------- views ---------- */
  const card = (title, body) => `<section class="m-card"><h2>${title}</h2>${body}</section>`;
  const signInGate = msg => `<div class="gate"><p>${esc(msg)}</p><button type="button" class="btn primary" data-signin onclick="document.getElementById('authBtn')?.click()">Sign in</button></div>`;
  async function renderPricing() { await load(); const host = $("#pricingBody"); if (!host) return; const cur = plan(), lp = lapse();
    host.innerHTML = `<div class="pr-head"><p class="kicker">Membership</p><h1 id="price-h">Catalog for free. Go private when you're ready.</h1><p class="lede">Every plan includes AI identification, named catalogs and private exact locations. Paid plans keep more of your collection private.</p></div>
      ${lp ? `<div class="gate-warn" role="alert">Your Annual plan ended on ${lp.expired.toLocaleDateString("en-US")}. Renew by ${lp.due.toLocaleDateString("en-US")} to keep every item private.</div>` : ""}
      <div class="tiers">${PLANS.map(p => { const on = p.id === cur && st().user; const price = p.price_cents ? money(p.price_cents) : "$0", per = p.billing_interval === "year" ? "/year" : p.billing_interval === "once" ? " one-time" : "";
        return `<article class="tier${p.id === "lifetime" ? " feat" : ""}${on ? " current" : ""}" data-plan="${p.id}">${p.tag ? `<span class="plan-tag">${esc(p.tag)}</span>` : ""}<h2>${esc(p.name)}</h2><p class="price"><span class="amt">${price}</span><span class="per">${per}</span></p><p class="help">${esc(p.blurb)}</p>
          <ul>${p.features.map(f => `<li>${f.replace("{q}", cfg.free_expert_questions_month)}</li>`).join("")}</ul>
          ${on ? `<button type="button" class="btn" disabled>✓ Your plan</button>` : p.id === "free" ? (st().user ? `<button type="button" class="btn" disabled>Included</button>` : `<button type="button" class="btn" data-signin onclick="document.getElementById('authBtn')?.click()">Start free</button>`)
            : C.checkoutEnabled && !MOCK ? `<button type="button" class="btn ${p.id === "lifetime" ? "primary" : "outline"}" data-checkout="${p.id}">Choose ${esc(p.name)}</button>`
            : `<button type="button" class="btn outline" disabled aria-disabled="true" data-soon="${p.id}" title="Paid plans aren't available yet">Coming soon</button>`}</article>`; }).join("")}</div>
      ${C.checkoutEnabled && !MOCK ? "" : `<p class="gate-warn pr-soon" role="note"><strong>Paid plans aren't available yet.</strong> Annual and Lifetime are coming soon. For now every account is on the Free plan${st().user ? "" : " — you can start free today"}, and nothing is charged.</p>`}
      <p class="help" id="checkoutMsg" role="status"></p>
      <section class="pr-compare" aria-labelledby="cmpH"><h2 id="cmpH">Free vs paid</h2><div class="table-wrap"><table class="cmp"><thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Annual $29.99/yr</th><th scope="col">Lifetime $59.99</th></tr></thead><tbody>
        <tr><th scope="row">AI identification suggestions</th><td>Unlimited</td><td>Unlimited</td><td>Unlimited</td></tr>
        <tr><th scope="row">Private items</th><td>Up to ${cfg.free_private_limit}. More are saved as public.</td><td>Unlimited</td><td>Unlimited</td></tr>
        <tr><th scope="row">Switch a public item back to private</th><td>No</td><td>Yes</td><td>Yes</td></tr>
        <tr><th scope="row">Named catalogs</th><td>Yes</td><td>Yes</td><td>Yes</td></tr>
        <tr><th scope="row">Exact find locations</th><td>Always private</td><td>Always private</td><td>Always private</td></tr>
        <tr><th scope="row">Ask an Expert</th><td>${cfg.free_expert_questions_month} questions a month</td><td>Unlimited, answered first</td><td>Unlimited, answered first</td></tr>
        <tr><th scope="row">Billing</th><td>$0</td><td>$29.99 per year</td><td>$59.99 once</td></tr></tbody></table></div></section>
      <section class="pr-faq"><h2>Good to know</h2><dl>
        <dt>What's private vs public?</dt><dd>Private items are visible only to you (and collaborators you invite). Public items get a short public ID like <code>UF-7K3M</code> for share links. Exact find locations are never public, on any plan.</dd>
        <dt>What happens on the free plan after 5 private items?</dt><dd>New items are saved as public, and we warn you before saving. Free accounts can't switch public items back to private.</dd>
        <dt>What if my Annual plan ends?</dt><dd>You get a notice and a ${cfg.lapse_grace_days}-day grace period. After that, your ${cfg.free_private_limit} oldest private items (or the ${cfg.free_private_limit} you choose in <a href="#/catalogs">Your catalogs</a>) stay private and the rest become public. Exact locations stay private.</dd>
        <dt>Is there a monthly plan?</dt><dd>No. Annual or a one-time Lifetime payment.</dd></dl></section>
      <p class="help">AI results are research possibilities, never identifications, authenticity or value claims.</p>`;
    $$("[data-checkout]", host).forEach(b => b.onclick = () => Billing.checkout(b.dataset.checkout)); }
  const Billing = { /* Stripe Checkout, wired but disabled until C.checkoutEnabled is true and the create-checkout edge function is deployed */
    async checkout(planId) { const msg = $("#checkoutMsg");
      // Paid plans are not on sale yet: never open sign-up from a paid button (it read as "sign up for Lifetime"). The plan itself is set only server-side (018_plan_guard.sql).
      if (!C.checkoutEnabled || MOCK) { if (msg) msg.textContent = "Paid plans aren't available yet. Annual and Lifetime are coming soon; every account is on the Free plan for now."; return { error: "coming_soon" }; }
      if (!st().user) { if (msg) msg.textContent = "Sign in first so the plan attaches to your account."; $("#authBtn")?.click(); return { error: "signin" }; }
      try { const { data, error } = await sb().functions.invoke("create-checkout", { body: { plan: planId } }); if (error || !data || !data.url) throw new Error((error && error.message) || "Checkout unavailable"); location.href = data.url; return {}; }
      catch (e) { if (msg) msg.textContent = "Checkout isn't available right now: " + e.message; return { error: e.message }; } } };

  async function renderCatalogs() { await load(); const host = $("#catalogsBody"); if (!host) return; if (!st().user) { host.innerHTML = `<h1 id="cats-h">Your catalogs</h1>` + signInGate("Sign in to create and name your catalogs."); return; }
    const all = window.App ? App.all : [], count = c => all.filter(r => r.collection_id ? r.collection_id === c.id : c.slug === (C.defaultCollection || {}).slug).length;
    const priv = mine().filter(r => vis(r) !== "public"), lp = lapse();
    host.innerHTML = `<p class="kicker">Account</p><h1 id="cats-h">Your catalogs</h1><p class="lede">Group finds into named catalogs. Names are yours to change; internal numbers never change.</p>
      <ul class="cat-list">${cols.map(c => `<li class="cat-row" data-cid="${esc(c.id)}"><div class="cat-main"><strong class="cat-name">${esc(c.name)}</strong> <span class="chip">${esc(c.role || "owner")}</span> <span class="chip">${(c.visibility || (c.is_public ? "public" : "private")) === "public" ? "🌐 Public" + (c.public_id ? " · " + esc(c.public_id) : "") : "🔒 Private"}</span><span class="muted"> · ${count(c)} finds</span></div>
        ${c.role === "owner" ? `<form class="row cat-rename"><label class="field grow"><span class="sr-only">Rename</span><input name="name" value="${esc(c.name)}" maxlength="80" aria-label="Rename ${esc(c.name)}"></label><button class="btn small">Rename</button></form>` : ""}</li>`).join("") || '<li class="muted">No catalogs yet.</li>'}</ul>
      <form id="catNew" class="row"><label class="field grow"><span>New catalog name</span><input name="name" maxlength="80" placeholder="e.g. Brazos gravel bars"></label><button class="btn primary">Create catalog</button></form>
      ${card("Private items", `<p>${isMember() ? `✓ ${esc(plan() === "lifetime" ? "Lifetime" : "Annual")}: unlimited private items (${priv.length} private now).` : `<strong>${priv.length} of ${cfg.free_private_limit}</strong> private items used on the free plan.`}</p>
        ${lp || plan() === "annual" ? `<p class="help">If your Annual plan ends, these stay private (up to ${cfg.free_private_limit}; otherwise your oldest). Choose them here:</p><ul class="keep-list">${priv.map(r => `<li><label class="check"><input type="checkbox" data-keep="${esc(r.catalog_id)}" ${r.keep_private ? "checked" : ""}> ${esc(nameOf(r))}</label></li>`).join("")}</ul>` : ""}`)}`;
    $$(".cat-rename", host).forEach(f => f.onsubmit = async e => { e.preventDefault(); const id = f.closest("[data-cid]").dataset.cid, r = await renameCatalog(id, f.name.value); toast(r.error || "Catalog renamed"); if (!r.error) renderCatalogs(); });
    $("#catNew").onsubmit = async e => { e.preventDefault(); const r = await createCatalog(e.target.name.value); toast(r.error || "Catalog created"); if (!r.error) { const s = $("#wizCatalog"); if (s) delete s.dataset.filled; renderCatalogs(); } };
    $$("[data-keep]", host).forEach(cb => cb.onchange = async () => { const n = $$("[data-keep]:checked", host).length; if (cb.checked && n > cfg.free_private_limit) { cb.checked = false; return toast(`Pick up to ${cfg.free_private_limit}.`); } await App.patch(cb.dataset.keep, { keep_private: cb.checked }); }); }

  async function renderMerch() { await load(); const host = $("#merchBody"); if (!host) return; const list = await products(isAdmin());
    host.innerHTML = `<p class="kicker">Shop</p><h1 id="merch-h">Merch</h1><p class="lede">Field gear and goods for people who look down when they walk.</p>
      ${list.length ? `<div class="merch-grid">${list.map(p => `<article class="merch-card${p.active ? "" : " draft"}">${(p.images || [])[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : `<div class="merch-ph" aria-hidden="true">👕</div>`}<h3>${esc(p.name)}${p.active ? "" : ' <span class="chip">Draft</span>'}</h3><p class="price">${money(p.price_cents)}</p>${p.description ? `<p class="help">${esc(p.description)}</p>` : ""}
          ${(p.variants || []).length ? `<p class="muted">${[...new Set(p.variants.map(v => v.size).filter(Boolean))].join(" · ")}${p.variants.some(v => v.color) ? " — " + [...new Set(p.variants.map(v => v.color).filter(Boolean))].join(", ") : ""}</p>` : ""}<button type="button" class="btn" disabled>Ordering coming soon</button></article>`).join("")}</div>`
        : `<div class="empty-state merch-empty"><div class="es-icon" aria-hidden="true">🧢</div><h3>Merch is on the way</h3><p>Shirts, hats and field bags are being designed now. ${plan() === "lifetime" ? "As a Lifetime member you'll get early access." : "Lifetime members get early access."}</p></div>
          <div class="merch-grid merch-soon">${[["👕", "Field Tee", "Soft cotton tee with the dirt-layer logo."], ["🧢", "Trucker Hat", "Mesh-back hat for long days in the field."], ["👕", "Long-sleeve Sun Shirt", "Lightweight sun protection for surface hunting."], ["🧢", "Wide-brim Field Hat", "Shade for creek beds and plowed fields."]].map(([i, n, d]) => `<article class="merch-card soon"><div class="merch-ph" aria-hidden="true">${i}</div><h3>${n}</h3><p class="help">${d}</p><p class="chip">Coming soon</p></article>`).join("")}</div>`}
      ${isAdmin() ? card("Add a product <span class=\"chip\">Owner only</span>", `<form id="prodForm" class="m-form"><div class="row"><label class="field grow"><span>Name</span><input name="name" required maxlength="120"></label><label class="field"><span>Price (USD)</span><input name="price" inputmode="decimal" required placeholder="28.00"></label></div>
          <label class="field"><span>Description</span><textarea name="description" rows="2"></textarea></label><label class="field"><span>Image URLs (one per line)</span><textarea name="images" rows="2" placeholder="https://…"></textarea></label>
          <div class="row"><label class="field grow"><span>Sizes (comma separated)</span><input name="sizes" placeholder="S, M, L, XL"></label><label class="field grow"><span>Colors (comma separated)</span><input name="colors" placeholder="Clay, Sage"></label></div>
          <label class="check"><input type="checkbox" name="active"> Active (visible to everyone)</label><div class="row"><button class="btn primary">Add product</button></div></form>`) : ""}`;
    const f = $("#prodForm"); if (f) f.onsubmit = async e => { e.preventDefault(); const price = Math.round(parseFloat(f.price.value) * 100); if (!(price >= 0)) return toast("Enter a price like 28.00");
      const split = s => s.split(",").map(x => x.trim()).filter(Boolean), sizes = split(f.sizes.value), colors = split(f.colors.value);
      const variants = sizes.length || colors.length ? (sizes.length ? sizes : [null]).flatMap(sz => (colors.length ? colors : [null]).map(co => ({ ...(sz ? { size: sz } : {}), ...(co ? { color: co } : {}) }))) : [];
      const r = await addProduct({ name: f.name.value.trim(), description: f.description.value.trim() || null, price_cents: price, images: f.images.value.split(/\n+/).map(x => x.trim()).filter(x => /^https:\/\//.test(x)), variants, active: f.active.checked });
      toast(r.error || "Product added"); if (!r.error) renderMerch(); }; }

  /* Public Texas resources directory (table texas_resources, public read; static fallback data/texas-resources.json). Contact methods are the orgs' own public ones. */
  let txCache = null;
  async function texasResources() { if (txCache) return txCache; let rows = null;
    if (!MOCK && sb()) { try { const r = await sb().from("texas_resources").select("*").order("sort").limit(1000); if (!r.error && r.data && r.data.length) rows = r.data; } catch {} }
    if (!rows) { try { rows = await (await fetch("data/texas-resources.json", { cache: "no-cache" })).json(); } catch { rows = []; } }
    return (txCache = rows); }
  const linkify = t => esc(t).replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,})/g, '<a href="mailto:$1">$1</a>').replace(/(\d{3}-\d{3}-\d{4})/g, m => `<a href="tel:+1${m.replace(/-/g, "")}">${m}</a>`);
  /* Expert resources directory: Texas + state-by-state + regional federations + national. Filters by state and field (client side). */
  const FIELDS = [["", "All fields"], ["artifacts", "Artifacts"], ["fossils", "Fossils"], ["minerals", "Minerals"]];
  const stateOf = r => r.state || "Texas", coversOf = r => (r.covers && r.covers.length ? r.covers : [stateOf(r)]);
  const dirItem = r => `<li data-state="${esc(stateOf(r))}"><strong>${esc(r.name)}</strong> <span class="chip">${esc(r.kind === "public inquiry" ? "Public inquiry" : "Organization")}</span> ${(r.specialty || []).map(x => `<span class="chip spec">${esc(x[0].toUpperCase() + x.slice(1))}</span>`).join(" ")} <span class="muted">${esc(r.region)}</span><br>${r.contact ? linkify(r.contact) : ""}${r.contact_url ? ` · <a href="${esc(r.contact_url)}" target="_blank" rel="noopener">Official contact page</a>` : ""}${r.availability ? `<br><span class="help">${esc(r.availability)}</span>` : ""}<br><span class="help">Source: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(new URL(r.source_url).hostname)}</a> · verified ${esc(r.last_verified)}</span></li>`;
  function dirList(rows, st, field) {
    const f = rows.filter(r => !field || (r.specialty || []).includes(field));
    const sec = (title, list) => list.length ? `<h3>${esc(title)} <span class="muted">(${list.length})</span></h3><ul class="tx-list">${list.map(dirItem).join("")}</ul>` : "";
    if (st) return sec(st, f.filter(r => stateOf(r) === st)) + sec("Regional federations covering " + st, f.filter(r => stateOf(r) === "Regional" && coversOf(r).includes(st))) + sec("National", f.filter(r => stateOf(r) === "National")) || '<p class="muted">No entries for this filter yet.</p>';
    const states = [...new Set(f.map(stateOf))].filter(x => x !== "National" && x !== "Regional").sort((a, b) => (a === "Texas" ? -1 : b === "Texas" ? 1 : a.localeCompare(b)));
    return sec("National", f.filter(r => stateOf(r) === "National")) + states.map(x => sec(x, f.filter(r => stateOf(r) === x))).join("") + sec("Regional rock, gem, mineral & fossil federations", f.filter(r => stateOf(r) === "Regional")) || '<p class="muted">No entries for this filter yet.</p>'; }
  async function texasHtml() { const rows = await texasResources(), states = [...new Set(rows.map(stateOf))].filter(x => x !== "National" && x !== "Regional").sort((a, b) => (a === "Texas" ? -1 : b === "Texas" ? 1 : a.localeCompare(b)));
    return `<section class="tx-dir" aria-labelledby="txH"><h2 id="txH">Expert resources directory</h2>
      <p class="dir-note"><strong>Public contacts only. We are expanding state by state. Exact find locations stay private.</strong></p>
      <p class="help">Organizations and public inquiry lines (state archaeologists, historic preservation offices, societies, museums and federations) that already answer public questions. Every contact is the organization's own public one, checked against its official site.</p>
      <div class="dir-filters row"><label class="field"><span>State</span><select id="dirState"><option value="">All states (${states.length}) + national</option>${states.map(x => `<option>${esc(x)}</option>`).join("")}<option value="National">National only</option></select></label>
        <div class="dir-fields" role="group" aria-label="Field">${FIELDS.map(([k, l]) => `<button type="button" class="btn small${k ? "" : " primary"}" data-dir-field="${k}" aria-pressed="${k ? "false" : "true"}">${l}</button>`).join("")}</div></div>
      <div id="dirList">${dirList(rows, "", "")}</div></section>`; }
  function bindDir(host) { const sel = $("#dirState", host), list = $("#dirList", host); if (!sel || !list) return; let field = "";
    const paint = async () => { const rows = await texasResources(); list.innerHTML = sel.value === "National" ? dirList(rows.filter(r => stateOf(r) === "National"), "", field) : dirList(rows, sel.value, field); };
    sel.onchange = paint; $$("[data-dir-field]", host).forEach(b => b.onclick = () => { field = b.dataset.dirField; $$("[data-dir-field]", host).forEach(x => { const on = x === b; x.classList.toggle("primary", on); x.setAttribute("aria-pressed", on); }); paint(); }); }
  const volunteersHtml = approved => card("Verified volunteer experts", approved.length ? `<ul class="exp-list">${approved.map(x => `<li><strong>${esc(x.name)}</strong> <span class="vbadge" title="Verified expert">✓ Verified</span><br><span class="muted">${esc((x.specialties || []).join(", "))}</span></li>`).join("")}</ul>` : '<p class="coming"><strong>Coming soon — credentialed volunteers</strong></p><p class="help">We are verifying archaeologists, paleontologists and mineral specialists who volunteer to answer questions.</p>');
  function bindExpForm() { const ef = $("#expForm"); if (ef) ef.onsubmit = async e => { e.preventDefault(); const r = await applyExpert({ name: ef.name.value.trim(), credentials: ef.credentials.value.trim(), specialties: ef.specialties.value.split(",").map(s => s.trim()).filter(Boolean), links: ef.links.value.split(/\n+/).map(s => s.trim()).filter(Boolean) }); toast(r.error || "Application sent. The owner reviews every application."); if (!r.error) renderExperts(); }; }
  async function renderExperts() { await load(); const host = $("#expertsBody"); if (!host) return; const me = await myExpert(), approved = await expertsList("approved"), u = st().user;
    const used = u ? await questionsUsed() : 0, left = isMember() ? "Unlimited" : Math.max(0, cfg.free_expert_questions_month - used), mineQ = await myQuestions();
    const expertView = me && me.status === "approved" ? await inbox() : null;
    const privileged = isAdmin() || !!(me && me.status === "approved");
    if (!privileged) { host.innerHTML = `<p class="kicker">Experts</p><h1 id="exp-h">Expert answers</h1><p class="lede">Ask a verified expert about one of your own finds: open the find and use <strong>Ask an Expert</strong>. Answers to your questions appear here.</p>
      <div class="exp-grid">${u ? card("Your questions", mineQ.length ? `<ul class="q-list">${mineQ.map(x => `<li><p><strong>${esc(x.question)}</strong> <span class="chip">${esc(x.status)}</span></p>${answersFor(x).map(a => `<blockquote>${esc(a.body)}</blockquote>`).join("")}</li>`).join("")}</ul>` : `<p class="muted">No questions yet. ${isMember() ? "Members: unlimited questions, answered first." : `Free plan: ${left} of ${cfg.free_expert_questions_month} questions left this month.`}</p>`) : card("Ask an Expert", signInGate("Sign in to ask about your finds."))}
      ${card(me ? `Your expert application <span class="chip">${esc(me.status)}</span>` : "Are you an archaeologist, paleontologist or mineralogist?", !u ? signInGate("Sign in to apply as an expert.") : me && me.status !== "pending" ? '<p class="help">Your application wasn\'t approved this time.</p>' : `<form id="expForm" class="m-form"><div class="row"><label class="field grow"><span>Name</span><input name="name" required value="${esc(me ? me.name : "")}"></label></div>
          <label class="field"><span>Credentials</span><textarea name="credentials" rows="2" placeholder="Degrees, positions, publications, years of field work">${esc(me ? me.credentials : "")}</textarea></label>
          <label class="field"><span>Specialties (comma separated)</span><input name="specialties" value="${esc(me ? (me.specialties || []).join(", ") : "")}" placeholder="Texas lithics, Cretaceous fossils"></label>
          <label class="field"><span>Links (one per line)</span><textarea name="links" rows="2" placeholder="https://…">${esc(me ? (me.links || []).join("\n") : "")}</textarea></label><div class="row"><button class="btn primary">${me ? "Update application" : "Apply to become a verified expert"}</button></div></form>`)}</div>`;
      host.insertAdjacentHTML("beforeend", `<div class="exp-grid">${volunteersHtml(approved)}</div>` + await texasHtml()); bindDir(host);
      bindExpForm(); return; }
    host.innerHTML = `<p class="kicker">Community</p><h1 id="exp-h">Experts</h1><p class="lede">Verified archaeologists, paleontologists and mineral specialists who answer questions about finds. Answers are expert opinions for research, not authentications or appraisals.</p>
      <div class="exp-grid">${card("Ask an Expert", u ? `<p class="help">${isMember() ? "Members: unlimited questions, answered first." : `Free plan: <strong>${left} of ${cfg.free_expert_questions_month}</strong> questions left this month.`} Open a find and use <strong>Ask an Expert</strong> to include its photos and details, or ask a general question:</p>
          <form id="askForm" class="m-form"><label class="field"><span>Your question</span><textarea name="q" rows="3" maxlength="4000" placeholder="e.g. How can I tell a Gary point from a Langtry?"></textarea></label><div class="row"><button class="btn primary">Send question</button></div><p class="help" id="askMsg" role="status"></p></form>` : signInGate("Sign in to ask an expert."))}
        ${card("Verified experts", approved.length ? `<ul class="exp-list">${approved.map(x => `<li><strong>${esc(x.name)}</strong> <span class="vbadge" title="Verified expert">✓ Verified</span><br><span class="muted">${esc((x.specialties || []).join(", "))}</span>${x.credentials ? `<br><span class="help">${esc(x.credentials)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="coming"><strong>Coming soon — credentialed volunteers</strong></p>')}</div>
      ${mineQ.length ? card("Your questions", `<ul class="q-list">${mineQ.map(x => `<li><p><strong>${esc(x.question)}</strong> <span class="chip">${esc(x.status)}</span></p>${answersFor(x).map(a => `<blockquote>${esc(a.body)}</blockquote>`).join("")}</li>`).join("")}</ul>`) : ""}
      ${expertView ? card("Expert inbox <span class=\"vbadge\">✓ Verified</span>", expertView.length ? `<ul class="q-list inbox">${expertView.map(x => `<li data-q="${esc(x.id)}"><p>${x.priority > 0 ? '<span class="chip prio">★ Member</span> ' : ""}<strong>${esc(x.question)}</strong></p>${x.context && x.context.title ? `<p class="muted">Find: ${esc(x.context.title)}${x.context.type ? " · " + esc(x.context.type) : ""}${x.context.material ? " · " + esc(x.context.material) : ""}</p>` : ""}${(x.context && x.context.photos || []).map(p => `<img src="${esc(p)}" alt="" class="q-ph" loading="lazy">`).join("")}
          <form class="ans-form"><label class="field"><span>Your answer</span><textarea name="a" rows="2"></textarea></label><button class="btn small primary">Send answer</button></form></li>`).join("")}</ul>` : '<p class="muted">No open questions right now.</p>') : ""}
      ${card(me ? `Your expert application <span class="chip">${esc(me.status)}</span>` : "Become an expert", me && me.status !== "pending" ? `<p class="help">${me.status === "approved" ? "✓ You're a verified expert." : "Your application wasn't approved this time."}</p>` : u ? `<form id="expForm" class="m-form"><div class="row"><label class="field grow"><span>Name</span><input name="name" required value="${esc(me ? me.name : (prof && prof.display_name) || "")}"></label></div>
          <label class="field"><span>Credentials</span><textarea name="credentials" rows="2" placeholder="Degrees, positions, publications, years of field work">${esc(me ? me.credentials : "")}</textarea></label>
          <label class="field"><span>Specialties (comma separated)</span><input name="specialties" value="${esc(me ? (me.specialties || []).join(", ") : "")}" placeholder="Texas lithics, Cretaceous fossils"></label>
          <label class="field"><span>Links (one per line)</span><textarea name="links" rows="2" placeholder="https://…">${esc(me ? (me.links || []).join("\n") : "")}</textarea></label><div class="row"><button class="btn primary">${me ? "Update application" : "Apply"}</button></div></form>` : signInGate("Sign in to apply as an expert."))}`;
    host.insertAdjacentHTML("beforeend", await texasHtml()); bindDir(host);
    const af = $("#askForm"); if (af) af.onsubmit = async e => { e.preventDefault(); const r = await ask(af.q.value, null); $("#askMsg").innerHTML = r.error ? `<span class="err">${esc(r.error)}</span>${r.limit ? ' <a href="#/membership">See plans</a>' : ""}` : "✓ Sent. You'll see the answer here."; if (!r.error) await renderExperts(); };
    bindExpForm();
    $$(".ans-form", host).forEach(f => f.onsubmit = async e => { e.preventDefault(); const r = await answer(f.closest("[data-q]").dataset.q, f.a.value); toast(r.error || "Answer sent"); if (!r.error) renderExperts(); }); }
  function askDialog(r) { let d = $("#askDlg"); if (!d) { d = document.createElement("dialog"); d.id = "askDlg"; d.className = "mem-dlg"; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog" id="askDlgForm"><h2>Ask an Expert</h2><p class="help">About <strong>${esc(nameOf(r))}</strong>. Its photos and recorded details are shared with verified experts. <strong>The location is never shared.</strong></p>
      <label class="field"><span>Your question</span><textarea name="q" rows="4" maxlength="4000" required></textarea></label><p class="help" id="askDlgMsg" role="status"></p><div class="row"><button type="submit" value="send" class="btn primary" id="askSend">Send</button><button value="cancel" class="btn ghost" formnovalidate>Cancel</button></div></form>`;
    const f = d.querySelector("form"); f.onsubmit = async e => { if (e.submitter && e.submitter.value === "cancel") return; e.preventDefault(); const res = await ask(f.q.value, r);
      if (res.error) { $("#askDlgMsg").innerHTML = `<span class="err">${esc(res.error)}</span>${res.limit ? ' <a href="#/membership">See plans</a>' : ""}`; return; } d.close(); toast("Question sent to the experts"); };
    d.showModal(); }

  async function renderAdmin() { await load(); const host = $("#adminBody"); if (!host) return; if (!isAdmin()) { host.innerHTML = `<h1 id="adm-h">Owner admin</h1><p>This page is for the site owner.</p>`; return; }
    const pend = await expertsList("pending"), all = await expertsList();
    host.innerHTML = `<p class="kicker">Owner</p><h1 id="adm-h">Owner admin</h1><p class="lede">Manual plan grants, the expert queue and invites. Payments aren't connected yet, so plans are granted here.</p>
      ${card("Grant a plan", `<form id="grantForm" class="m-form"><div class="row"><label class="field grow"><span>Account email</span><input name="email" type="email" required></label><label class="field"><span>Plan</span><select name="plan"><option value="annual">Annual</option><option value="lifetime">Lifetime</option><option value="free">Free</option></select></label><label class="field"><span>Annual ends (optional)</span><input name="expires" type="date"></label></div><div class="row"><button class="btn primary">Grant plan</button></div><p class="help" id="grantMsg" role="status"></p></form><p class="help">Your own account is always Lifetime.</p>`)}
      ${card(`Expert applications <span class="chip">${pend.length} pending</span>`, pend.length ? `<ul class="q-list">${pend.map(x => `<li data-uid="${esc(x.user_id)}"><p><strong>${esc(x.name)}</strong> · ${esc((x.specialties || []).join(", "))}</p><p class="help">${esc(x.credentials || "")}</p>${(x.links || []).map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(" · ")}<div class="row"><button class="btn small green" data-decide="approved">Approve</button><button class="btn small outline" data-decide="rejected">Reject</button></div></li>`).join("")}</ul>` : '<p class="muted">No pending applications.</p>')}
      ${card("Invite an expert", `<form id="invForm" class="row"><label class="field grow"><span>Email</span><input name="email" type="email" required></label><button class="btn">Send invite</button></form><p class="help">Invites are recorded now; the invite email is optional and not sent yet.</p>`)}
      ${card("Verified experts", `<p>${all.filter(x => x.status === "approved").map(x => esc(x.name)).join(", ") || '<span class="muted">None yet.</span>'}</p>`)}
      <p><a class="btn" href="#/merch">Manage merch →</a></p>`;
    $("#grantForm").onsubmit = async e => { e.preventDefault(); const f = e.target, r = await grantPlan(f.email.value, f.plan.value, f.expires.value ? new Date(f.expires.value + "T23:59:59").toISOString() : null); $("#grantMsg").textContent = r.error || `✓ ${f.plan.value} granted to ${f.email.value}`; };
    $("#invForm").onsubmit = async e => { e.preventDefault(); const r = await inviteExpert(e.target.email.value); toast(r.error || "Invite recorded"); if (!r.error) e.target.reset(); };
    $$("[data-decide]", host).forEach(b => b.onclick = async () => { const r = await decideExpert(b.closest("[data-uid]").dataset.uid, b.dataset.decide); toast(r.error || "Saved"); renderAdmin(); }); }

  /* ---------- public UF pages + legacy redirects ---------- */
  async function publicFind(uf) { if (MOCK) { const id = (MOCK.publicFinds || {})[uf]; const r = id && window.App && App.all.find(x => x.catalog_id === id); return r && vis(r) === "public" ? r : null; }
    if (window.App) { const loc = App.all.find(x => x.public_id === uf && vis(x) === "public"); if (loc) return loc; }
    if (!s12() || !sb()) return null; const r = await q(sb().rpc("public_find", { p_uf: uf })); return (r.data || [])[0] || null; }
  async function renderShared(uf) { const host = $("#sharedFind"); if (!host) return; uf = String(uf || "").toUpperCase(); host.innerHTML = '<p class="help">Loading…</p>';
    if (!/^UF-[2-9A-HJKMNP-Z]{4,8}$/.test(uf)) { host.innerHTML = `<p>That isn't a valid public ID.</p><a class="btn" href="#/discover">Explore finds</a>`; return; }
    const r = await publicFind(uf); if (!r) { host.innerHTML = `<div class="gate"><p>🔒 <strong>${esc(uf)}</strong> isn't public right now.</p><a class="btn" href="#/discover">Explore public finds</a></div>`; return; }
    if (window.Cloud && Cloud.signPaths) await Cloud.signPaths((r.photos || []).map(p => p.storage).filter(Boolean));
    const ps = (window.App && r.catalog_id ? App.pics(r) : (r.photos || []).map(p => { const st0 = p.storage && window.Cloud ? Cloud.photoUrl(p.storage) : ""; return { src: st0 || p.full || p.repo, thumb: (p.repo && /^images\//.test(p.repo) ? p.repo : st0) || p.full, label: p.label || "photo" }; }).filter(p => p.src));
    const size = [r.length_mm && `L ${r.length_mm}`, r.width_mm && `W ${r.width_mm}`, r.thickness_mm && `T ${r.thickness_mm}`].filter(Boolean).join(" × ");
    document.title = `${nameOf(r)} · ${uf} — ${window.Brand ? Brand.name() : "UnEarthed Finds"}`;
    host.innerHTML = `<article class="pub uf-pub" aria-labelledby="ufH"><header class="pub-head"><p class="kicker">${esc((window.App && App.KINDS[App.kindOf(r)] || {}).label || r.category || "Find")} · ${esc(r.region || (C.defaultRegion || ""))}</p><h1 id="ufH">${esc(nameOf(r))}</h1>
        <div class="pub-chips"><span class="chip uf-chip">🌐 ${esc(uf)}</span>${r.object_type && r.title ? `<span class="chip">${esc(r.object_type)}</span>` : ""}<span class="chip">📍 General area only</span>${r.status ? `<span class="chip">${esc(r.status)}</span>` : ""}</div>
        <div class="pub-actions no-print"><button type="button" class="btn primary" id="ufCopy">🔗 Copy link</button><a class="btn ghost" href="#/discover">Explore finds</a></div></header>
      <p class="disclaimer" role="note">⚠ ${esc(window.Learn ? Learn.DISCLAIMER : "Research suggestions only, not identifications.")}</p>
      <section class="pub-photos" aria-label="Photos">${ps.map((p, i) => `<figure class="pub-fig"><img src="${esc(p.src || p.thumb)}" alt="${esc(nameOf(r))} ${esc(p.label)}" ${i ? 'loading="lazy"' : ""}><figcaption>${esc(p.label)}</figcaption></figure>`).join("") || '<p class="muted">No public photos.</p>'}</section>
      <section class="pub-sum"><h2>Summary</h2><dl class="kv"><dt>Possibilities</dt><dd>${esc([r.suggestion_1, r.suggestion_2, r.suggestion_3].filter(Boolean).join(" · ") || "None recorded")}</dd><dt>Material</dt><dd>${esc(r.material || "—")}</dd><dt>Size (mm)</dt><dd>${esc(size || "—")}</dd><dt>Key features</dt><dd>${esc(r.key_features || "—")}</dd><dt>Location</dt><dd>General area only. Exact find spots are never published.</dd></dl></section></article>`;
    $("#ufCopy").onclick = async () => { const url = (C.siteUrl || location.href.split("#")[0]) + "#/p/" + uf; try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { window.prompt("Copy this link:", url); } }; }
  /* old links (#/find/ELG-xxx and share/ELG-xxx.html, QR labels) keep working: when the find is public and has a UF id, go to #/p/UF-…; otherwise the old page renders as before */
  async function legacyRedirect(id) { if (!id || !/^[A-Z]{2,5}-\d{3,}$/.test(id)) return; let uf = null; const r = window.App && App.all.find(x => x.catalog_id === id);
    if (r && vis(r) === "public" && r.public_id) uf = r.public_id; else if (!MOCK && s12() && sb()) { const x = await q(sb().rpc("public_id_for", { p_catalog_id: id })); uf = typeof x.data === "string" && /^UF-[0-9A-Z]{4,}$/.test(x.data) ? x.data : null; }
    if (uf && /^#\/find\//.test(location.hash) && !(window.App && App.current)) location.replace("#/p/" + uf); }

  /* ---------- lapse banner + admin nav ---------- */
  function banner() { const lp = lapse(); let b = $("#lapseBanner"); if (!lp) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "lapseBanner"; b.className = "lapse-banner"; b.setAttribute("role", "alert"); const n = $(".notice"); (n ? n.parentNode : document.body).insertBefore(b, n ? n.nextSibling : document.body.firstChild); }
    const days = Math.max(0, Math.ceil((lp.due - Date.now()) / 864e5));
    b.innerHTML = `<div class="wrap">⚠ Your Annual plan ended on ${lp.expired.toLocaleDateString("en-US")}. ${days ? `In <strong>${days} day${days === 1 ? "" : "s"}</strong>` : "Today"}, private items beyond ${cfg.free_private_limit} become public (exact locations stay private). <a href="#/membership">Renew</a> · <a href="#/catalogs">Choose which ${cfg.free_private_limit} stay private</a></div>`; }
  function adminNav() { $$('a[data-route="admin"]').forEach(a => a.hidden = !isAdmin()); if (window.Access) { Access.reset(); Access.load().then(Access.nav); } }

  let lastR = { k: "", t: 0 };
  async function render(view, param) { wrap(); const k = view + "/" + (param || "") + "/" + ((st().user || {}).id || ""); if (k === lastR.k && Date.now() - lastR.t < 1500) return; lastR = { k, t: Date.now() }; /* route() runs again after sign-in settles: don't wipe a form the user is typing in */
    await load();
    if (view === "pricing") renderPricing(); if (view === "catalogs") renderCatalogs(); if (view === "merch") renderMerch(); if (view === "experts") renderExperts(); if (view === "admin") renderAdmin();
    if (view === "p") renderShared(param || (location.hash.split("/")[2] || "")); if (view === "find") legacyRedirect(param); if (view === "add") { wizard(); } }
  document.addEventListener("DOMContentLoaded", () => { wrap(); if (window.Cloud && Cloud.on) Cloud.on(() => { load(true).then(() => { adminNav(); }); });
    new MutationObserver(() => decorateFind()).observe(document.body, { childList: true, subtree: true }); });
  window.Membership = { isExpert: async () => { const me = await myExpert(); return !!(me && me.status === "approved"); }, load, plan, isMember, isOwner, isAdmin, lapse, config: () => ({ ...cfg }), plans: () => PLANS, privateCount, canPrivate, guardVis, serverGate, beforeSave, wizard, render,
    canUseAI: () => !!st().user, ask, questionsUsed, inbox, answer, products, addProduct, grantPlan, createCatalog, renameCatalog, publicFind, nameOf, Billing };
  window.Billing = Billing;
})();
