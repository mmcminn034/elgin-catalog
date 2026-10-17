// Supabase Edge Function: create-checkout  (NOT DEPLOYED: Stripe is not connected yet)
// POST { plan: "annual" | "lifetime" } with the user's Supabase JWT -> { url } of a Stripe Checkout Session.
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ANNUAL (recurring yearly $29.99), STRIPE_PRICE_LIFETIME (one-time $59.99), SITE_URL.
import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("STRIPE_SECRET_KEY"); if (!key) return json({ error: "coming_soon", message: "Checkout opens soon." }, 503);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: { user } } = await sb.auth.getUser(); if (!user) return json({ error: "Sign in required" }, 401);
  let plan = ""; try { plan = (await req.json()).plan; } catch { /* */ }
  const price = plan === "annual" ? Deno.env.get("STRIPE_PRICE_ANNUAL") : plan === "lifetime" ? Deno.env.get("STRIPE_PRICE_LIFETIME") : null;
  if (!price) return json({ error: "Unknown plan" }, 400);
  const { data: prof } = await sb.from("profiles").select("membership, stripe_customer_id").eq("id", user.id).single();
  if (prof?.membership === "lifetime") return json({ error: "You already have Lifetime." }, 409);
  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  const site = Deno.env.get("SITE_URL") || "https://unearthedfinds.com/";
  const session = await stripe.checkout.sessions.create({
    mode: plan === "annual" ? "subscription" : "payment", line_items: [{ price, quantity: 1 }],
    client_reference_id: user.id, metadata: { user_id: user.id, plan },
    ...(prof?.stripe_customer_id ? { customer: prof.stripe_customer_id } : { customer_email: user.email }),
    ...(plan === "annual" ? { subscription_data: { metadata: { user_id: user.id, plan } } } : {}),
    success_url: site + "#/membership?checkout=success", cancel_url: site + "#/membership?checkout=cancel",
  });
  return json({ url: session.url });
});
