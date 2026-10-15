/* Public client config. The publishable key is designed to be public; Row Level Security protects the data. */
/* Brand + locale: the ONE place to rename the app or change the home region. tools/gen_share_pages.py reads this block too. */
window.ROLLING_OAK_BRAND = {"name": "UnEarthed Finds", "short": "UnEarthed", "motto": "Discover. Catalog. Preserve.", "tagline": "AI-Powered Catalog Tool", "homeLabel": "", "homeAdmin1": "Texas", "homeRegion": "bastrop-tx", "owner": "PolForge, LLC"};
window.ROLLING_OAK_CLOUD = {
  schema008: true, // set true only after supabase/migrations/008_status_discover_measure.sql is applied (show_on_discover, measure_refs columns)
  url: "https://qqllbazrwfebpnqhdwox.supabase.co",
  key: "sb_publishable_AgbAHVD0pUYDrXpdgjTFig_yQmSOPpr",
  bucket: "find-photos",
  timeoutMs: 6000,
  siteUrl: "https://unearthedfinds.com/",
  defaultCollection: { slug: "rolling-oak", name: "Rolling Oak", description: "Artifacts, fossils, rocks and minerals, documented one find at a time.", owner_name: "PolForge, LLC" },
  defaultRegion: "Bastrop County, Texas", // public, county-level area shown for finds (never exact)
  freeFindLimit: 50,
  membershipPrice: "$10/year",
  // Sign-in options: keep false until the provider is configured in Supabase (see docs/auth-setup.md)
  authGoogle: false,
  authPhone: false,
  // Paste the Stripe Payment Link URL here once the Stripe account exists (see docs/membership.md):
  stripePaymentLink: "STRIPE_PAYMENT_LINK_PLACEHOLDER"
};
