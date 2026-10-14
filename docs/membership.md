# Membership (Supporter, $10/year)

**Free** gets up to 50 finds (`freeFindLimit` in `assets/js/config.js`) and every feature except AI photo analysis.
**Supporter** gets unlimited finds and AI photo analysis.

## Where it lives
- `profiles.membership` (`free` | `member`), `profiles.membership_expires`, `profiles.stripe_customer_id` (migration 001).
- Users **cannot** change these columns: `authenticated` only has column grants for display_name/bio/avatar_url/is_public. Only `public.set_membership(...)` (service role only) flips them.
- Client gating: `Features.isMember()` and `Features.canAddFind()` in `assets/js/features.js`. Server gating: the `analyze-find` Edge Function re-checks membership, so the client check is for UX only.

## Turning on payments (needs Mark)
1. Create a Stripe account and a **Product** "Supporter membership", **$10.00 / year** (recurring).
2. Create a **Payment Link** for it. Under *After payment*, set the confirmation redirect to `https://mmcminn034.github.io/elgin-catalog/#/profile`.
3. Paste the link (e.g. `https://buy.stripe.com/xxxx`) into `stripePaymentLink` in `assets/js/config.js` and push.
   The site appends `?client_reference_id=<supabase user id>&prefilled_email=<email>` so the webhook knows who paid.
4. Deploy the webhook function (needs the Supabase CLI: `npm i -g supabase`, `supabase login`, `supabase link --project-ref qqllbazrwfebpnqhdwox`):
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
5. In Stripe → Developers → Webhooks, add the endpoint `https://qqllbazrwfebpnqhdwox.supabase.co/functions/v1/stripe-webhook` with events
   `checkout.session.completed` and `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` (step 4).
6. Test in Stripe **test mode** first (test link + `sk_test_` key). After paying, `profiles.membership` should read `member` with an expiry one year out.

## Flow
Site "Become a member" → Stripe Payment Link (with `client_reference_id`) → Stripe sends `checkout.session.completed` →
`supabase/functions/stripe-webhook` verifies the signature → `rpc('set_membership', {p_user, 'member', now()+1 year})`.
Cancellation (`customer.subscription.deleted`) sets it back to `free`.
