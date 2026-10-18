/* Public client config. The publishable key is designed to be public; Row Level Security protects the data. */
/* Brand + locale: the ONE place to rename the app or change the home region. tools/gen_share_pages.py reads this block too. */
window.ROLLING_OAK_BRAND = {"name": "UnEarthed Finds", "short": "UnEarthed", "motto": "Discover. Catalog. Preserve.", "tagline": "AI-Powered Catalog Tool", "homeLabel": "", "homeAdmin1": "Texas", "homeRegion": "bastrop-tx", "owner": "PolForge, LLC"};
window.ROLLING_OAK_CLOUD = {
  schema008: true,
  schema012: true, // set true only after supabase/migrations/012_membership_v1.sql is applied (plans, UF public ids, experts, merch, AI cap)
  schema014: true, // migration 014: public = UF id (Discover), default catalogs, private photo bucket
  schema013: true, // migration 013 applied: public_profiles view, server-side find numbering (allocate_catalog_id), AI quota refunds
  membership: { free_private_limit: 5, ai_daily_cap: 50, lapse_grace_days: 7, free_expert_questions_month: 3 }, // UI defaults; the database app_config table is the source of truth once 012 is applied
  checkoutEnabled: false, // Stripe not connected: checkout buttons say "Coming soon". Set true after deploying create-checkout + stripe-webhook with Stripe secrets. // set true only after supabase/migrations/008_status_discover_measure.sql is applied (show_on_discover, measure_refs columns)
  url: "https://qqllbazrwfebpnqhdwox.supabase.co",
  key: "sb_publishable_AgbAHVD0pUYDrXpdgjTFig_yQmSOPpr",
  bucket: "find-photos", // public bucket: avatars only since 014
  privateBucket: "find-photos-private", // find photos (signed URLs; storage RLS = who may see the find)
  timeoutMs: 6000,
  adminUserId: "a4779d71-ff10-4c11-864d-c79f83214b00", // owner/admin account: the only one that sees the Reference Library UI (not a secret; RLS enforces data access)
  siteUrl: "https://unearthedfinds.com/",
  defaultCollection: { slug: "rolling-oak", name: "Rolling Oak", description: "Artifacts, fossils, rocks and minerals, documented one find at a time.", owner_name: "PolForge, LLC" },
  defaultRegion: "Bastrop County, Texas", // public, county-level area shown for finds (never exact)
  freeFindLimit: 50,
  // Sign-in options: keep false until the provider is configured in Supabase (see docs/auth-setup.md)
  authGoogle: false,
  authPhone: false,
  // Paste the Stripe Payment Link URL here once the Stripe account exists (see docs/membership.md):
  stripePaymentLink: "STRIPE_PAYMENT_LINK_PLACEHOLDER"
};
