// Supabase Edge Function: membership-cron  (NOT DEPLOYED). Run once a day (Supabase scheduled function or pg_cron + pg_net).
// 1) apply_membership_lapses(): day 0 = warning notice + in-app banner; after app_config.lapse_grace_days = extra private items become public.
// 2) Optional email for new notices (stub: logs only until an email provider is chosen).
// Protected by CRON_SECRET header. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const { data: n, error } = await admin.rpc("apply_membership_lapses"); if (error) return new Response(error.message, { status: 500 });
  const { data: pending } = await admin.from("membership_notices").select("id, user_id, kind, due_at").is("email_sent_at", null).limit(100);
  for (const p of pending || []) { console.log("email stub:", p.kind, p.user_id, p.due_at); /* send via provider here, then: */ await admin.from("membership_notices").update({ email_sent_at: new Date().toISOString() }).eq("id", p.id); }
  return new Response(JSON.stringify({ lapsed: n, notices: (pending || []).length }), { headers: { "Content-Type": "application/json" } });
});
