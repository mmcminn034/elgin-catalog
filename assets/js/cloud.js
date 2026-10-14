/* Rolling Oak Catalog: optional Supabase sync layer.
   - Signed out: reads public finds/photos/verified examples. Signed in: reads own rows too and writes edits.
   - Falls back silently to data/catalog.json + IndexedDB when Supabase or the CDN is unreachable.
   - The exact private location is only ever written to the owner-only find_locations table, never to finds. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, PRIVATE = "find_location_private";
  const FIELDS = ["catalog_id","category","object_type","material","color","length_mm","width_mm","thickness_mm","weight_g","measure_method","condition","key_features","suggestion_1","suggestion_2","suggestion_3","confidence","owner_observations","open_questions","date_found","context_notes","location_sharing","status","era","geologic_period","formation","preservation","hardness","luster","streak","category_note","category_kept"];
  const TRACK = ["category", "object_type", "material", "suggestion_1", "status", "confidence"];
  let sb = null, user = null, online = false, listeners = [];
  const emit = () => listeners.forEach(f => { try { f(state()); } catch {} });
  const state = () => ({ available: !!sb || !!MOCK, mock: !!MOCK, online, user: user ? { id: user.id, email: user.email || null, phone: user.phone ? ("+" + String(user.phone).replace(/^\+/, "")) : null } : null });
  const withTimeout = (p, ms = C.timeoutMs || 6000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const publicUrl = path => sb.storage.from(C.bucket).getPublicUrl(path).data.publicUrl;

  const MOCK = window.ROLLING_OAK_MOCK || null; // test harness only (Playwright); never set in production
  async function init() {
    if (MOCK) { sb = null; user = MOCK.user || null; online = !!MOCK.online; return state(); }
    if (!C.url || !C.key || !window.supabase || !window.supabase.createClient) return state();
    try { sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data } = await withTimeout(sb.auth.getSession(), 4000); user = data && data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_e, s) => { user = s ? s.user : null; emit(); });
    } catch { sb = null; }
    return state();
  }
  function toRecord(f) {
    const r = {}; FIELDS.forEach(k => { if (f[k] != null) r[k] = f[k]; });
    r.category_history = f.category_history || []; r.photo_annotations = f.annotations && Object.keys(f.annotations).length ? f.annotations : undefined; r.is_public = f.is_public; r._owner = f.owner;
    r.photos = (f.photos || []).sort((a, b) => a.sort - b.sort).map(p => { const src = p.storage_path ? publicUrl(p.storage_path) : p.repo_path; return { path: src, thumb: p.thumb_path ? (p.storage_path ? publicUrl(p.thumb_path) : p.thumb_path) : src, view: p.view, label: p.label || p.view || "photo" }; });
    return r;
  }
  /* Returns cloud finds as catalog records, or null to signal "use the offline copy". */
  async function loadFinds() {
    if (MOCK) { emit(); return null; }
    if (!sb) return null;
    try { const { data, error } = await withTimeout(sb.from("finds").select("*, photos(*)").order("catalog_id"));
      if (error || !Array.isArray(data) || !data.length) { online = false; emit(); return null; }
      online = true;
      const recs = data.map(toRecord);
      if (user) { const loc = await withTimeout(sb.from("find_locations").select("catalog_id, location")).catch(() => ({})); (loc.data || []).forEach(l => { const r = recs.find(x => x.catalog_id === l.catalog_id); if (r) r[PRIVATE] = l.location; }); }
      emit(); return recs;
    } catch { online = false; emit(); return null; }
  }
  async function loadExamples() {
    if (!sb || !online) return null;
    try { const { data, error } = await withTimeout(sb.from("verified_examples").select("*")); return error ? null : data.map(e => ({ catalog_id: e.catalog_id, category: e.category, confirmed_type: e.confirmed_type, type_ids: e.type_ids || [], features: e.features, length_mm: e.length_mm, material: e.material, confirmed_on: e.confirmed_on, source: (e.source || "") + " (shared)" })); } catch { return null; }
  }
  const dataUrlToBlob = async u => (await fetch(u)).blob();
  /* Push one merged record. Returns {ok, msg}. */
  async function pushFind(rec, prev, marksFor) {
    if (MOCK) return { ok: !!user, msg: "mock" };
    if (!sb || !online || !user) return { ok: false, msg: "not signed in" };
    try {
      const row = { owner: user.id, is_public: rec.is_public !== false }; FIELDS.forEach(k => row[k] = rec[k] ?? null); row.category = row.category || "artifact";
      row.category_history = Array.isArray(rec.category_history) ? rec.category_history : [];
      const ann = {}; (rec.photos || []).forEach((_, i) => { const m = marksFor(rec, i); if (m.length) ann[i] = m; }); row.annotations = ann;
      if (PRIVATE in row) delete row[PRIVATE]; // belt and braces: never in public table
      const { error } = await sb.from("finds").upsert(row, { onConflict: "catalog_id" });
      if (error) return { ok: false, msg: /row-level|policy|permission/i.test(error.message) ? "you don't own this record yet (run the claim SQL)" : error.message };
      // photos: upload browser-added (data URL, already EXIF-stripped by canvas) images
      for (const [i, p] of (rec.photos || []).entries()) {
        const src = p.src || p.path; if (!src || !String(src).startsWith("data:")) continue;
        const path = `${user.id}/${rec.catalog_id}/${String(i).padStart(2, "0")}.jpg`;
        const up = await sb.storage.from(C.bucket).upload(path, await dataUrlToBlob(src), { contentType: "image/jpeg", upsert: true });
        if (!up.error) await sb.from("photos").upsert({ catalog_id: rec.catalog_id, owner: user.id, sort: i, storage_path: path, view: p.tag || p.view || null, label: p.label || p.tag || null, is_public: row.is_public }, { onConflict: "catalog_id,sort" });
      }
      if (rec[PRIVATE]) { const ll = parseLatLon(rec[PRIVATE]); await sb.from("find_locations").upsert({ catalog_id: rec.catalog_id, owner: user.id, location: rec[PRIVATE], lat: ll ? ll[0] : null, lon: ll ? ll[1] : null }, { onConflict: "catalog_id" }); }
      if (prev) { const ch = TRACK.filter(k => String(prev[k] ?? "") !== String(rec[k] ?? "")).map(k => ({ catalog_id: rec.catalog_id, owner: user.id, field: k, old_value: prev[k] ?? null, new_value: rec[k] ?? null, reason: "Edited in Rolling Oak Catalog" }));
        if (ch.length) await sb.from("corrections").insert(ch); }
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }
  async function deleteFind(id) { if (!sb || !online || !user) return; try { await sb.from("finds").delete().eq("catalog_id", id); } catch {} }
  async function pushExample(e) { if (!sb || !online || !user || !e) return; try { await sb.from("verified_examples").upsert({ ...e, owner: user.id, is_public: true }, { onConflict: "catalog_id" }); } catch {} }
  async function forgetExample(id) { if (!sb || !online || !user) return; try { await sb.from("verified_examples").delete().eq("catalog_id", id); } catch {} }
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
    const ids = (m.data || []).map(x => x.user_id), pr = ids.length ? await q(sb.from("profiles").select("id, display_name, avatar_url").in("id", ids)) : { data: [] };
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
    const o = c.data.owner ? await q(sb.from("profiles").select("display_name, bio, avatar_url").eq("id", c.data.owner).maybeSingle()) : {}; return { collection: c.data, owner: o.data || null }; }
  async function setVisibility(table, key, val) { if (MOCK) return {}; return q(sb.from(table).update({ is_public: val }).eq(table === "collections" ? "id" : "catalog_id", key)); }
  async function requestReview(catalog_id, note) { if (MOCK) { (MOCK.reviews = MOCK.reviews || []).push({ catalog_id, note }); return {}; } if (!user) return { error: "Sign in first" }; return q(sb.from("review_requests").insert({ catalog_id, note, requester: user.id })); }
  async function analyze(body) { if (MOCK) return MOCK.ai ? { data: MOCK.ai } : { error: "AI not configured" };
    try { const { data, error } = await sb.functions.invoke("analyze-find", { body }); if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} return { error: msg }; } return { data }; } catch (e) { return { error: e.message }; } }
  /* auth */
  const redirect = () => location.origin + location.pathname;
  const magicLink = email => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
  const signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
  const signUp = (email, password) => sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
  const signOut = () => sb.auth.signOut();
  /* Google OAuth + phone (SMS) OTP. MOCK: code "000000" fails, anything else succeeds. */
  const google = () => MOCK ? (MOCK.oauth = "google", Promise.resolve({})) : sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: C.siteUrl || redirect() } });
  const phoneOtp = phone => MOCK ? ((MOCK.sms = (MOCK.sms || 0) + 1), Promise.resolve(MOCK.phoneError ? { error: { message: MOCK.phoneError } } : {})) : sb.auth.signInWithOtp({ phone });
  const verifyPhone = async (phone, token) => { if (MOCK) { if (token === "000000") return { error: { message: "Token has expired or is invalid" } }; user = { id: "u-phone", phone: phone.slice(1), email: null }; emit(); return {}; }
    const r = await sb.auth.verifyOtp({ phone, token, type: "sms" }); if (!r.error && r.data && r.data.user) { user = r.data.user; emit(); } return r; };
  window.Cloud = { profile, saveProfile, uploadAvatar, collections, members, invite, setRole, revokeInvite, acceptInvites, locations, publicCollection, setVisibility, requestReview, analyze, parseLatLon, init, loadFinds, loadExamples, pushFind, deleteFind, pushExample, forgetExample, magicLink, google, phoneOtp, verifyPhone, isPhone, signIn, signUp, signOut, state, on: f => listeners.push(f) };
})();
