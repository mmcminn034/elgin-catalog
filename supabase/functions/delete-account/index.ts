// Supabase Edge Function: delete-account
// Permanently deletes the CALLER's account: their catalogs, finds, photos (storage files too), exact locations, notes and profile.
// Requires a signed-in session (verify_jwt) AND body {"confirm":"DELETE"}. The site owner/admin account is refused here
// and additionally protected in the database (trigger protect_owner_account on auth.users, migration 016).
// Env (provided automatically by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const URL_ = Deno.env.get("SUPABASE_URL")!, auth = req.headers.get("Authorization") || "";
  const sb = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser(); if (!user) return json({ error: "Sign in again to delete your account.", code: "sign_in_required" }, 401);
  let body: { confirm?: string } = {}; try { body = await req.json(); } catch { /* empty */ }
  if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm.", code: "confirm_required" }, 400);
  const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await admin.from("app_config").select("value").eq("key", "owner_user_id").maybeSingle();
  const { data: isAdm } = await sb.rpc("is_admin");
  if (isAdm === true || (cfg && String(cfg.value) === user.id)) return json({ error: "The site owner account is protected and can't be deleted from the app.", code: "owner_protected" }, 403);
  const uid = user.id;
  // storage: every file under <uid>/ in the private bucket (folders are <uid>/<catalog_id>/…) and the avatar in the public bucket
  const removed: string[] = [];
  const { data: top } = await admin.storage.from("find-photos-private").list(uid, { limit: 1000 });
  for (const e of top || []) {
    if (e.id) { removed.push(`${uid}/${e.name}`); continue; }
    const { data: files } = await admin.storage.from("find-photos-private").list(`${uid}/${e.name}`, { limit: 1000 });
    (files || []).forEach(f => removed.push(`${uid}/${e.name}/${f.name}`));
  }
  for (let i = 0; i < removed.length; i += 100) await admin.storage.from("find-photos-private").remove(removed.slice(i, i + 100));
  await admin.storage.from("find-photos").remove([`${uid}/avatar.jpg`]);
  const cnt = async (t: string, col = "owner") => (await admin.from(t).select("*", { count: "exact", head: true }).eq(col, uid)).count || 0;
  const stats = { finds: await cnt("finds"), photos: await cnt("photos"), catalogs: await cnt("collections") };
  // rows: finds cascade to photos, find_locations, comments, corrections, feedback, review requests; then catalogs; the auth user last
  for (const [t, col] of [["finds", "owner"], ["collections", "owner"], ["verified_examples", "owner"], ["corrections", "owner"]] as const) {
    const r = await admin.from(t).delete().eq(col, uid); if (r.error) return json({ error: "Deletion failed part-way; nothing else was removed. Please try again.", code: "delete_failed", step: t }, 500);
  }
  const d = await admin.auth.admin.deleteUser(uid); if (d.error) return json({ error: "Your data was removed but the sign-in record couldn't be deleted. Please contact us via the site.", code: "auth_delete_failed" }, 500);
  await admin.from("account_deletions").insert({ finds: stats.finds, photos: stats.photos, catalogs: stats.catalogs });
  return json({ ok: true, deleted: { ...stats, files: removed.length } });
});
