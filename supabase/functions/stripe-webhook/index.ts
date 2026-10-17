// Supabase Edge Function: stripe-webhook  (Membership v1: Annual $29.99/yr subscription, Lifetime $59.99 one-time)
// NOT DEPLOYED in the preview: Stripe is not connected yet. Deploy with --no-verify-jwt once STRIPE_* secrets exist.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ANNUAL, STRIPE_PRICE_LIFETIME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Authenticity comes from the Stripe signature. The plan is read from session metadata set by create-checkout (never from the client).
import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const setPlan = (p_user: string, p_status: "free" | "annual" | "lifetime", p_expires: string | null, p_customer: string | null) =>
  admin.rpc("set_membership", { p_user, p_status, p_expires, p_customer });

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature"); const raw = await req.text();
  let ev: Stripe.Event;
  try { ev = await stripe.webhooks.constructEventAsync(raw, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, Stripe.createSubtleCryptoProvider()); }
  catch (e) { return new Response(`Bad signature: ${(e as Error).message}`, { status: 400 }); }

  if (ev.type === "checkout.session.completed") {
    const s = ev.data.object as Stripe.Checkout.Session;
    const uid = s.client_reference_id || s.metadata?.user_id; const plan = s.metadata?.plan;
    if (uid && (plan === "annual" || plan === "lifetime")) {
      let expires: string | null = null;
      if (plan === "annual" && s.subscription) { const sub = await stripe.subscriptions.retrieve(String(s.subscription)); expires = new Date(sub.current_period_end * 1000).toISOString(); }
      else if (plan === "annual") { const d = new Date(); d.setFullYear(d.getFullYear() + 1); expires = d.toISOString(); }
      const { error } = await setPlan(uid, plan, expires, String(s.customer || "") || null);
      if (error) return new Response(error.message, { status: 500 });
    }
  }
  // Annual renewals push the expiry forward; Lifetime is never touched by subscription events.
  if (ev.type === "invoice.paid") {
    const inv = ev.data.object as Stripe.Invoice;
    if (inv.subscription) {
      const sub = await stripe.subscriptions.retrieve(String(inv.subscription));
      const { data } = await admin.from("profiles").select("id, membership").eq("stripe_customer_id", String(inv.customer)).maybeSingle();
      if (data && data.membership !== "lifetime") await setPlan(data.id, "annual", new Date(sub.current_period_end * 1000).toISOString(), null);
    }
  }
  // Cancellation: keep Annual until the paid period ends. apply_membership_lapses() (daily, service role) then runs the warning + grace period.
  if (ev.type === "customer.subscription.deleted") {
    const sub = ev.data.object as Stripe.Subscription;
    const { data } = await admin.from("profiles").select("id, membership").eq("stripe_customer_id", String(sub.customer)).maybeSingle();
    if (data && data.membership === "annual") await setPlan(data.id, "annual", new Date((sub.current_period_end || Date.now() / 1000) * 1000).toISOString(), null);
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
