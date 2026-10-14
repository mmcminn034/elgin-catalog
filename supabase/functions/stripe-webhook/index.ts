// Supabase Edge Function: stripe-webhook
// Flips profiles.membership when a Stripe Payment Link checkout completes (or a subscription ends).
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided).
// Deploy with --no-verify-jwt (Stripe can't send a Supabase JWT); authenticity comes from the Stripe signature.
import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature"); const raw = await req.text();
  let ev: Stripe.Event;
  try { ev = await stripe.webhooks.constructEventAsync(raw, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, Stripe.createSubtleCryptoProvider()); }
  catch (e) { return new Response(`Bad signature: ${(e as Error).message}`, { status: 400 }); }

  if (ev.type === "checkout.session.completed") {
    const s = ev.data.object as Stripe.Checkout.Session;
    const uid = s.client_reference_id; // set by the site: Payment Link URL ?client_reference_id=<supabase user id>
    if (uid) {
      const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1);
      const { error } = await admin.rpc("set_membership", { p_user: uid, p_status: "member", p_expires: expires.toISOString(), p_customer: String(s.customer || "") || null });
      if (error) return new Response(error.message, { status: 500 });
    }
  }
  if (ev.type === "customer.subscription.deleted") {
    const sub = ev.data.object as Stripe.Subscription;
    const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", String(sub.customer)).maybeSingle();
    if (data) await admin.rpc("set_membership", { p_user: data.id, p_status: "free", p_expires: null, p_customer: null });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
