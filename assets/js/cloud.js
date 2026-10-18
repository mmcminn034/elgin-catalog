/* Rolling Oak Catalog: optional Supabase sync layer.
   - Signed out: reads public finds/photos/verified examples. Signed in: reads own rows too and writes edits.
   - Falls back silently to data/catalog.json + IndexedDB when Supabase or the CDN is unreachable.
   - The exact private location is only ever written to the owner-only find_locations table, never to finds. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, PRIVATE = "find_location_private";
  const FIELDS = ["catalog_id","category","object_type","material","color","length_mm","width_mm","thickness_mm","weight_g","measure_method","condition","key_features","suggestion_1","suggestion_2","suggestion_3","confidence","owner_observations","open_questions","date_found","context_notes","location_sharing","status","era","geologic_period","formation","preservation","hardness","luster","streak","category_note","category_kept","visibility","region","length_source","width_source","thickness_source","weight_source","condition_notes","heat_treatment","heat_notes","use_wear","provenance","acquisition","provenance_answer","title"];
  const OPTIONAL = ["provenance","acquisition","provenance_answer","title","keep_private","collection_id"]; // migration 005; dropped automatically if the columns aren't there yet
  let missingCols = new Set();
  const TRACK = ["category", "object_type", "material", "suggestion_1", "status", "confidence"];
  let sb = null, user = null, online = false, reason = "", listeners = [];
  const emit = () => listeners.forEach(f => { try { f(state()); } catch {} });
  const state = () => ({ available: !!sb || !!MOCK, mock: !!MOCK, online, reason, user: user ? { id: user.id, email: user.email || null, phone: user.phone ? ("+" + String(user.phone).replace(/^\+/, "")) : null } : null });
  const withTimeout = (p, ms = C.timeoutMs || 6000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const publicUrl = path => sb.storage.from(C.bucket).getPublicUrl(path).data.publicUrl;

  const MOCK = window.ROLLING_OAK_MOCK || null; // test harness only (Playwright); never set in production
  let initP = null, settled = false;
  function init() { return initP || (initP = init0().finally(() => { settled = true; emit(); })); }
  async function init0() {
    if (MOCK) { sb = null; user = MOCK.user || null; online = !!MOCK.online; return state(); }
    if (!C.url || !C.key || !window.supabase || !window.supabase.createClient) return state();
    try { sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data } = await withTimeout(sb.auth.getSession(), 4000); user = data && data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_e, s) => { user = s ? s.user : null; emit(); });
    } catch { sb = null; }
    return state();
  }
  /* Latest owner category decision: ISO ts if present, else date; "" when none. Comparable as strings. */
  function catStamp(h) { if (!Array.isArray(h) || !h.length) return ""; return h.map(x => String((x && (x.ts || x.date)) || "")).sort().pop() + "#" + String(h.length).padStart(4, "0"); }
  function toRecord(f) {
    const r = {}; FIELDS.forEach(k => { if (f[k] != null) r[k] = f[k]; });
    r.category_history = f.category_history || []; r.photo_annotations = f.annotations && Object.keys(f.annotations).length ? f.annotations : undefined; r.is_public = f.is_public; r._owner = f.owner; if (f.public_id) r.public_id = f.public_id; if (f.collection_id) r.collection_id = f.collection_id; if (f.keep_private) r.keep_private = true;
    r.photos = (f.photos || []).sort((a, b) => a.sort - b.sort).map(p => { const src = p.storage_path ? publicUrl(p.storage_path) : p.repo_path; return { path: src, thumb: p.thumb_path ? (p.storage_path ? publicUrl(p.thumb_path) : p.thumb_path) : src, view: p.view, label: p.label || p.view || "photo" }; });
    return r;
  }
  /* Returns cloud finds as catalog records, or null to signal "use the offline copy". */
  async function loadFinds() {
    if (MOCK) { emit(); return MOCK.finds || null; } // MOCK.finds: test harness "cloud rows" (cross-device read-back)
    if (!sb) return null;
    try { const { data, error } = await withTimeout(sb.from("finds").select("*, photos(*)").order("catalog_id"));
      if (error || !Array.isArray(data)) { online = false; reason = error ? error.message : "cloud not reachable"; emit(); return null; }
      // Reachable but empty (or nothing visible yet) is still ONLINE: edits must sync, not silently stay local.
      online = true; reason = "";
      if (!data.length) { emit(); return null; }
      const recs = data.map(toRecord);
      if (user) { const loc = await withTimeout(sb.from("find_locations").select("catalog_id, location")).catch(() => ({})); (loc.data || []).forEach(l => { const r = recs.find(x => x.catalog_id === l.catalog_id); if (r) r[PRIVATE] = l.location; }); }
      emit(); return recs;
    } catch (e) { online = false; reason = (e && e.message) || "cloud not reachable"; emit(); return null; }
  }
  async function loadExamples() {
    if (!sb || !online) return null;
    try { const { data, error } = await withTimeout(sb.from("verified_examples").select("*")); return error ? null : data.map(e => ({ catalog_id: e.catalog_id, category: e.category, confirmed_type: e.confirmed_type, type_ids: e.type_ids || [], features: e.features, length_mm: e.length_mm, material: e.material, region: e.region, era: e.era, notes: e.notes, photo_ids: e.photo_ids || [], confirmed_on: e.confirmed_on, source: (e.source || "") + " (shared)" })); } catch { return null; }
  }
  const dataUrlToBlob = async u => (await fetch(u)).blob();
  /* Push one merged record. Returns {ok, msg}. */
  /* Constrained columns: send the DB enum or null, never "" or a display label (finds_*_source_chk, finds_heat_chk, finds_visibility_chk). */
  const SRC_MAP = v => { const t = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"); if (!t || t === "unknown" || t === "none" || t === "source…") return null;
    if (/^measur/.test(t) || t === "caliper" || t === "scale") return "measured"; if (/photo/.test(t)) return "photo_estimate"; if (/^(estimat|approx|rough|guess)/.test(t)) return "estimate"; return null; };
  const HEAT_MAP = v => { const t = String(v ?? "").trim().toLowerCase(); if (!t) return null; return ["none", "possible", "likely", "unknown"].includes(t) ? t : /no|not/.test(t) ? "none" : /likel|yes|heated/.test(t) ? "likely" : /possib|maybe/.test(t) ? "possible" : "unknown"; };
  function normalizeRow(row) { ["length_source", "width_source", "thickness_source", "weight_source"].forEach(k => { if (k in row) row[k] = SRC_MAP(row[k]); });
    if ("heat_treatment" in row) row.heat_treatment = HEAT_MAP(row.heat_treatment);
    if ("visibility" in row) { const v = String(row.visibility ?? "").trim().toLowerCase(); row.visibility = ["private", "editors", "public"].includes(v) ? v : null; }
    Object.keys(row).forEach(k => { if (row[k] === "") row[k] = null; }); return row; }
  async function pushFind(rec, prev, marksFor) {
    if (MOCK) { if (user) { const g = window.Membership && Membership.serverGate ? Membership.serverGate(rec) : null; if (g) return { ok: false, msg: g }; (MOCK.pushed = MOCK.pushed || []).push({ ...normalizeRow(Object.fromEntries(FIELDS.map(k => [k, rec[k] ?? null]))), ...(rec.collection_id ? { collection_id: rec.collection_id } : {}) }); } return { ok: !!user, msg: "mock" }; }
    if (!sb || !online || !user) return { ok: false, msg: "not signed in" };
    try {
      const row = { owner: user.id, is_public: rec.visibility ? rec.visibility === "public" : rec.is_public !== false }; FIELDS.forEach(k => row[k] = rec[k] ?? null); ["origin_confirmed", "country", "admin1"].forEach(k => { if (rec[k]) row[k] = rec[k]; }); if (C.schema008) { if ("show_on_discover" in rec) row.show_on_discover = !!rec.show_on_discover; if (rec.measure_refs) { try { row.measure_refs = typeof rec.measure_refs === "string" ? JSON.parse(rec.measure_refs) : rec.measure_refs; } catch {} } } if (rec.collection_id) row.collection_id = rec.collection_id; if ("keep_private" in rec) row.keep_private = !!rec.keep_private; normalizeRow(row); row.category = row.category || "artifact";
      row.category_history = Array.isArray(rec.category_history) ? rec.category_history : [];
      const ann = {}; (rec.photos || []).forEach((_, i) => { const m = marksFor(rec, i); if (m.length) ann[i] = m; }); row.annotations = ann;
      if (PRIVATE in row) delete row[PRIVATE]; // belt and braces: never in public table
      // Never let a stale copy overwrite a newer owner category decision already in the cloud.
      const cur = await sb.from("finds").select("category, category_kept, category_note, category_history").eq("catalog_id", rec.catalog_id).maybeSingle();
      let kept = false;
      if (cur.data && catStamp(cur.data.category_history) > catStamp(row.category_history)) { ["category","category_kept","category_note","category_history"].forEach(k => row[k] = cur.data[k]); kept = true; }
      missingCols.forEach(k => delete row[k]);
      let { data: wrote, error } = await sb.from("finds").upsert(row, { onConflict: "catalog_id" }).select("catalog_id, category");
      for (let n = 0; error && n < OPTIONAL.length; n++) { const m = /'([a-z_]+)' column|column "?([a-z_]+)"? (?:of relation "finds" )?does not exist/i.exec(error.message || ""); const col = m && (m[1] || m[2]); if (!col || !OPTIONAL.includes(col)) break;
        missingCols.add(col); delete row[col]; ({ data: wrote, error } = await sb.from("finds").upsert(row, { onConflict: "catalog_id" }).select("catalog_id, category")); }
      if (!error && (!Array.isArray(wrote) || !wrote.length)) return { ok: false, msg: "the cloud accepted nothing (you may not own this record yet; run the claim SQL)" };
      if (!error && wrote[0].category !== row.category) return { ok: false, msg: `cloud still says ${wrote[0].category}` };
      if (kept) rec._cloudCategory = cur.data;
      if (error) return { ok: false, msg: /row-level|policy|permission/i.test(error.message) ? "you don't own this record yet (run the claim SQL)" : error.message };
      const photoErr = [], photoUrls = {};
      // photos: upload browser-added (data URL, already EXIF-stripped by canvas) images
      for (const [i, p] of (rec.photos || []).entries()) {
        const src = p.src || p.path; if (!src || !String(src).startsWith("data:")) continue;
        const path = `${user.id}/${rec.catalog_id}/${String(i).padStart(2, "0")}.jpg`;
        const up = await sb.storage.from(C.bucket).upload(path, await dataUrlToBlob(src), { contentType: "image/jpeg", upsert: true });
        if (up.error) { photoErr.push(`photo ${i + 1}: ${up.error.message}`); continue; }
        const pr = await sb.from("photos").upsert({ catalog_id: rec.catalog_id, owner: user.id, sort: i, storage_path: path, view: p.tag || p.view || null, label: p.label || p.tag || null, is_public: row.is_public }, { onConflict: "catalog_id,sort" });
        if (pr.error) photoErr.push(`photo ${i + 1} record: ${pr.error.message}`); else photoUrls[i] = publicUrl(path);
      }
      if (photoErr.length) return { ok: false, msg: "the record uploaded but " + photoErr.join("; ") };
      if (rec[PRIVATE]) { const ll = parseLatLon(rec[PRIVATE]); await sb.from("find_locations").upsert({ catalog_id: rec.catalog_id, owner: user.id, location: rec[PRIVATE], lat: ll ? ll[0] : null, lon: ll ? ll[1] : null }, { onConflict: "catalog_id" }); }
      if (prev) { const ch = TRACK.filter(k => String(prev[k] ?? "") !== String(rec[k] ?? "")).map(k => ({ catalog_id: rec.catalog_id, owner: user.id, field: k, old_value: prev[k] ?? null, new_value: rec[k] ?? null, reason: "Edited in " + (window.Brand ? Brand.name() : "Rolling Oak Catalog") }));
        if (ch.length) await sb.from("corrections").insert(ch); }
      return { ok: true, cloudCategory: kept ? cur.data : null, photos: Object.keys(photoUrls).length ? photoUrls : null };
    } catch (e) { return { ok: false, msg: e.message }; }
  }
  async function deleteFind(id) { if (!sb || !online || !user) return; try { await sb.from("finds").delete().eq("catalog_id", id); } catch {} }
  async function pushExample(e) { if (!sb || !online || !user || !e) return; try { await sb.from("verified_examples").upsert({ ...e, owner: user.id, verified_by: user.id, is_public: e.is_public !== false }, { onConflict: "catalog_id" }); } catch {} }
  async function forgetExample(id) { if (!sb || !online || !user) return; try { await sb.from("verified_examples").delete().eq("catalog_id", id); } catch {} }
  /* Stage 1: feedback, accuracy, visibility */
  async function addFeedback(row) { if (MOCK) { (MOCK.feedback = MOCK.feedback || []).push(row); return {}; } if (!sb || !user) return { error: "offline" };
    const { created_at, ...r } = row; return q(sb.from("feedback").insert({ ...r, user_id: user.id })); }
  /* Stage 4: one field correction (private by default). Uses only columns that exist before migration 007; source/kept ride in reason. */
  async function addCorrection(row) { if (MOCK) { (MOCK.corrections = MOCK.corrections || []).push(row); return {}; } if (!sb || !user) return { error: "offline" };
    const r = await q(sb.from("corrections").insert({ catalog_id: row.catalog_id, owner: user.id, field: row.field, old_value: row.old_value, new_value: row.new_value, reason: row.reason, is_public: false })); return r; }
  async function typeAccuracy() { if (MOCK) return MOCK.accuracy || null; if (!sb) return null; const r = await q(sb.rpc("type_accuracy")); return r.error ? null : r.data; }
  async function setDiscover(id, on) { if (MOCK) { (MOCK.discoverSet = MOCK.discoverSet || {})[id] = on; return {}; } if (!sb || !user) return {};
    const up = on ? { visibility: "public", is_public: true } : {}; if (C.schema008) up.show_on_discover = !!on; return Object.keys(up).length ? q(sb.from("finds").update(up).eq("catalog_id", id)) : {}; } // show_on_discover needs migration 008 (C.schema008)
  async function setFindVisibility(id, v) { if (MOCK) { (MOCK.visibility = MOCK.visibility || {})[id] = v; return {}; } if (!sb || !user) return {}; return q(sb.from("finds").update({ visibility: v }).eq("catalog_id", id)); }
  const PROFV = () => C.schema013 ? "public_profiles" : "profiles"; /* 013: other people's profiles only through the safe public view */
  /* Stage 2: discover + comments */
  const DISCOVER_COLS = "catalog_id,category,object_type,material,era,region,suggestion_1,suggestion_2,suggestion_3,confidence,status,key_features,length_mm,length_source,width_mm,width_source,thickness_mm,thickness_source,weight_g,weight_source,thumb_repo,thumb_storage,verified,collection_slug" + (C.schema012 ? ",public_id,title" : "");
  async function discover() { if (MOCK) return MOCK.discover || null; if (!sb) return null;
    const r = await q(sb.from("discover_finds").select(DISCOVER_COLS).order("catalog_id").limit(1000)); if (r.error || !Array.isArray(r.data)) return null;
    return r.data.map(d => ({ ...d, thumb: d.thumb_storage ? publicUrl(d.thumb_storage) : d.thumb_repo, visibility: "public" })); }
  async function comments(id) { if (MOCK) return (MOCK.comments || []).filter(c => c.catalog_id === id); if (!sb) return null;
    const r = await q(sb.from("comments").select("id,catalog_id,user_id,kind,body,resolved,created_at").eq("catalog_id", id).order("created_at")); if (r.error) return null;
    const ids = [...new Set(r.data.map(c => c.user_id))], pr = ids.length ? await q(sb.from(PROFV()).select("id,display_name,avatar_url").in("id", ids)) : { data: [] };
    return r.data.map(c => ({ ...c, author: ((pr.data || []).find(p => p.id === c.user_id) || {}).display_name || "Member" })); }
  async function addComment(catalog_id, kind, body) { if (MOCK) { const c = { id: "m" + Date.now() + Math.random().toString(36).slice(2, 5), catalog_id, kind, body, resolved: false, user_id: user && user.id, author: (MOCK.profile && MOCK.profile.display_name) || "Member", created_at: new Date().toISOString() }; (MOCK.comments = MOCK.comments || []).push(c); return { data: c }; }
    if (!sb || !user) return { error: "Sign in to comment" }; return q(sb.from("comments").insert({ catalog_id, kind, body }).select().single()); }
  async function resolveComment(id, v) { if (MOCK) { const c = (MOCK.comments || []).find(x => x.id === id); if (c) c.resolved = v; return {}; } return q(sb.from("comments").update({ resolved: v }).eq("id", id)); }
  async function deleteComment(id) { if (MOCK) { MOCK.comments = (MOCK.comments || []).filter(x => x.id !== id); return {}; } return q(sb.from("comments").delete().eq("id", id)); }
  const parseLatLon = t => { const m = String(t || "").match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/); return m ? [+m[1], +m[2]] : null; };
  /* ---------- collections, profiles, sharing, membership, AI ---------- */
  const q = async p => { try { const { data, error } = await withTimeout(p); return error ? { error: error.message } : { data }; } catch (e) { return { error: e.message }; } };
  async function profile() { if (MOCK) return MOCK.profile || null; if (!sb || !user) return null; const r = await q(sb.from("profiles").select("*").eq("id", user.id).maybeSingle()); return r.data || null; }
  async function saveProfile(p) { if (MOCK) { Object.assign(MOCK.profile = MOCK.profile || {}, p); return {}; } return q(sb.from("profiles").update({ display_name: p.display_name, bio: p.bio, avatar_url: p.avatar_url, is_public: p.is_public }).eq("id", user.id)); }
  async function uploadAvatar(blob) { if (MOCK) return { url: URL.createObjectURL(blob) }; const path = `${user.id}/avatar.jpg`; const up = await sb.storage.from(C.bucket).upload(path, blob, { contentType: "image/jpeg", upsert: true }); return up.error ? { error: up.error.message } : { url: publicUrl(path) + "?v=" + Date.now() }; }
  async function collections() { if (MOCK) return MOCK.collections || []; if (!sb || !user) return [];
    const r = await q(sb.from("collection_members").select("role, collections(*)").eq("user_id", user.id)); return (r.data || []).map(m => ({ ...m.collections, role: m.role })); }
  async function members(cid) { if (MOCK) return MOCK.members?.[cid] || { members: [], invites: [] };
    const m = await q(sb.from("collection_members").select("user_id, role, added_at").eq("collection_id", cid)), inv = await q(sb.from("collection_invites").select("*").eq("collection_id", cid).neq("status", "revoked"));
    const ids = (m.data || []).map(x => x.user_id), pr = ids.length ? await q(sb.from(PROFV()).select("id, display_name, avatar_url").in("id", ids)) : { data: [] };
    return { members: (m.data || []).map(x => ({ ...x, ...((pr.data || []).find(p => p.id === x.user_id) || {}) })), invites: inv.data || [] }; }
  const isPhone = v => /^\+[1-9]\d{7,14}$/.test(v);
  async function invite(cid, contact, role) { contact = contact.trim(); const phone = isPhone(contact), key = phone ? "phone" : "email"; if (!phone) contact = contact.toLowerCase();
    if (MOCK) { (MOCK.members[cid] = MOCK.members[cid] || { members: [], invites: [] }).invites.push({ [key]: contact, role, status: "pending" }); return { phone }; }
    const r = await q(sb.from("collection_invites").upsert({ collection_id: cid, [key]: contact, role, status: "pending" }, { onConflict: "collection_id," + key })); if (r.error) return r;
    if (!phone) await sb.auth.signInWithOtp({ email: contact, options: { emailRedirectTo: redirect(), shouldCreateUser: true } }).catch(() => {}); // emails the invitee a sign-in link; phone invites send no SMS
    return { phone }; }
  async function setRole(cid, uid, role) { if (MOCK) return {}; return q(sb.from("collection_members").update({ role }).eq("collection_id", cid).eq("user_id", uid)); }
  async function revokeInvite(cid, contact) { const key = isPhone(contact) ? "phone" : "email"; if (MOCK) { const m = MOCK.members[cid]; m.invites = m.invites.filter(i => i[key] !== contact); return {}; } return q(sb.from("collection_invites").update({ status: "revoked" }).eq("collection_id", cid).eq(key, contact)); }
  async function acceptInvites() { if (MOCK || !sb || !user) return 0; const r = await q(sb.rpc("accept_invites")); return r.data || 0; }
  async function locations() { if (MOCK) return MOCK.locations || []; if (!sb || !user) return []; const r = await q(sb.from("find_locations").select("catalog_id, location, lat, lon")); return (r.data || []).map(l => { const ll = l.lat != null ? [l.lat, l.lon] : parseLatLon(l.location); return ll ? { catalog_id: l.catalog_id, lat: ll[0], lon: ll[1], location: l.location } : null; }).filter(Boolean); }
  async function publicCollection(slug) { if (MOCK) return MOCK.publicCollections?.[slug] || null; if (!sb) return null;
    const c = await q(sb.from("collections").select("*").eq("slug", slug).maybeSingle()); if (!c.data) return null;
    const o = c.data.owner ? await q(sb.from(PROFV()).select(C.schema013 ? "display_name, bio, avatar_url, public_finds" : "display_name, bio, avatar_url").eq("id", c.data.owner).maybeSingle()) : {}; return { collection: c.data, owner: o.data || null }; }
  async function setVisibility(table, key, val) { if (MOCK) return {}; return q(sb.from(table).update({ is_public: val }).eq(table === "collections" ? "id" : "catalog_id", key)); }
  async function requestReview(catalog_id, note) { if (MOCK) { (MOCK.reviews = MOCK.reviews || []).push({ catalog_id, note }); return {}; } if (!user) return { error: "Sign in first" }; return q(sb.from("review_requests").insert({ catalog_id, note, requester: user.id })); }
  async function analyze(body) { if (MOCK) return MOCK.aiError ? { ...MOCK.aiError } : MOCK.ai ? { data: MOCK.ai } : { error: "AI not configured" };
    if (!sb) return { error: "AI photo analysis is unavailable offline.", code: "ai_unavailable" };
    try { const { data, error } = await sb.functions.invoke("analyze-find", { body }); if (error) { let msg = error.message, code = "", status = 0; try { status = error.context.status || 0; const j = await error.context.json(); msg = j.error || msg; code = j.code || ""; } catch {}
        if (!code) code = status === 401 ? "sign_in_required" : status === 429 ? "ai_daily_cap" : "ai_unavailable"; return { error: msg, code, status }; } return { data }; }
    catch (e) { return { error: e.message, code: "ai_unavailable" }; } }
  /* auth */
  const redirect = () => location.origin + location.pathname;
  /* MOCK (tests only): email link is "sent"; password sign-in succeeds for MOCK.accounts[email] === password; sign-up records the account */
  const magicLink = email => MOCK ? ((MOCK.magic = [...(MOCK.magic || []), email]), Promise.resolve({})) : sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
  const signIn = (email, password) => { if (MOCK) { const ok = (MOCK.accounts || {})[email] === password; if (ok) { user = { id: "u-" + email.split("@")[0], email }; MOCK.noReload = true; emit(); } return Promise.resolve(ok ? {} : { error: { message: "Invalid login credentials" } }); }
    return sb.auth.signInWithPassword({ email, password }); };
  const signUp = (email, password) => MOCK ? (((MOCK.accounts = MOCK.accounts || {})[email] = password), Promise.resolve({})) : sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
  const signOut = () => sb.auth.signOut();
  /* Google OAuth + phone (SMS) OTP. MOCK: code "000000" fails, anything else succeeds. */
  const google = () => MOCK ? (MOCK.oauth = "google", Promise.resolve({})) : sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect() } /* return to the domain the user came from (unearthedfinds.com or github.io) */ });
  const phoneOtp = phone => MOCK ? ((MOCK.sms = (MOCK.sms || 0) + 1), Promise.resolve(MOCK.phoneError ? { error: { message: MOCK.phoneError } } : {})) : sb.auth.signInWithOtp({ phone });
  const verifyPhone = async (phone, token) => { if (MOCK) { if (token === "000000") return { error: { message: "Token has expired or is invalid" } }; user = { id: "u-phone", phone: phone.slice(1), email: null }; emit(); return {}; }
    const r = await sb.auth.verifyOtp({ phone, token, type: "sms" }); if (!r.error && r.data && r.data.user) { user = r.data.user; emit(); } return r; };
  /* 013: find numbers come from the server (per-account prefix + sequence). MOCK.serverNumbering simulates it in tests. */
  const serverNumbering = () => MOCK ? !!MOCK.serverNumbering : !!(C.schema013 && sb);
  async function allocateId() { if (MOCK) { if (!MOCK.serverNumbering || !user || MOCK.offline) return null; MOCK.nextN = (MOCK.nextN || 36); return (MOCK.prefix || "ELG") + "-" + String(MOCK.nextN++).padStart(3, "0"); }
    if (!C.schema013 || !sb || !user || !online) return null; const r = await q(sb.rpc("allocate_catalog_id")); return (!r.error && typeof r.data === "string") ? r.data : null; }
  async function myPrefix() { if (MOCK) return MOCK.serverNumbering && user ? (MOCK.prefix || "ELG") : null; if (!C.schema013 || !sb || !user) return null;
    const k = "ro-id-prefix:" + user.id; if (online) { const r = await q(sb.rpc("my_catalog_prefix")); if (!r.error && r.data && r.data.prefix) { try { localStorage.setItem(k, r.data.prefix); } catch {} return r.data.prefix; } }
    try { return localStorage.getItem(k); } catch { return null; } }
  window.Cloud = { client: () => sb, serverNumbering, allocateId, myPrefix, whenReady: () => initP || Promise.resolve(state()), isSettled: () => settled, setDiscover, addCorrection, normalizeRow, catStamp, discover, comments, addComment, resolveComment, deleteComment, addFeedback, typeAccuracy, setFindVisibility, profile, saveProfile, uploadAvatar, collections, members, invite, setRole, revokeInvite, acceptInvites, locations, publicCollection, setVisibility, requestReview, analyze, parseLatLon, init, loadFinds, loadExamples, pushFind, deleteFind, pushExample, forgetExample, magicLink, google, phoneOtp, verifyPhone, isPhone, signIn, signUp, signOut, state, on: f => listeners.push(f) };
})();
