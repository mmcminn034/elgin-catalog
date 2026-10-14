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
  const state = () => ({ available: !!sb, online, user: user ? { id: user.id, email: user.email } : null });
  const withTimeout = (p, ms = C.timeoutMs || 6000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  const publicUrl = path => sb.storage.from(C.bucket).getPublicUrl(path).data.publicUrl;

  async function init() {
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
      if (rec[PRIVATE]) await sb.from("find_locations").upsert({ catalog_id: rec.catalog_id, owner: user.id, location: rec[PRIVATE] }, { onConflict: "catalog_id" });
      if (prev) { const ch = TRACK.filter(k => String(prev[k] ?? "") !== String(rec[k] ?? "")).map(k => ({ catalog_id: rec.catalog_id, owner: user.id, field: k, old_value: prev[k] ?? null, new_value: rec[k] ?? null, reason: "Edited in Rolling Oak Catalog" }));
        if (ch.length) await sb.from("corrections").insert(ch); }
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }
  async function deleteFind(id) { if (!sb || !online || !user) return; try { await sb.from("finds").delete().eq("catalog_id", id); } catch {} }
  async function pushExample(e) { if (!sb || !online || !user || !e) return; try { await sb.from("verified_examples").upsert({ ...e, owner: user.id, is_public: true }, { onConflict: "catalog_id" }); } catch {} }
  async function forgetExample(id) { if (!sb || !online || !user) return; try { await sb.from("verified_examples").delete().eq("catalog_id", id); } catch {} }
  /* auth */
  const redirect = () => location.origin + location.pathname;
  const magicLink = email => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
  const signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
  const signUp = (email, password) => sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect() } });
  const signOut = () => sb.auth.signOut();
  window.Cloud = { init, loadFinds, loadExamples, pushFind, deleteFind, pushExample, forgetExample, magicLink, signIn, signUp, signOut, state, on: f => listeners.push(f) };
})();
