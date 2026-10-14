/* Public client config. The publishable key is designed to be public; Row Level Security protects the data. */
window.ROLLING_OAK_CLOUD = {
  url: "https://qqllbazrwfebpnqhdwox.supabase.co",
  key: "sb_publishable_AgbAHVD0pUYDrXpdgjTFig_yQmSOPpr",
  bucket: "find-photos",
  timeoutMs: 6000,
  siteUrl: "https://mmcminn034.github.io/elgin-catalog/",
  defaultCollection: { slug: "rolling-oak", name: "Rolling Oak", description: "Surface finds from private land near Elgin, Texas.", owner_name: "Mark McMinn" },
  defaultRegion: "Bastrop County, Texas", // public, county-level area shown for finds (never exact)
  freeFindLimit: 50,
  membershipPrice: "$10/year",
  // Sign-in options: keep false until the provider is configured in Supabase (see docs/auth-setup.md)
  authGoogle: false,
  authPhone: false,
  // Paste the Stripe Payment Link URL here once the Stripe account exists (see docs/membership.md):
  stripePaymentLink: "STRIPE_PAYMENT_LINK_PLACEHOLDER"
};
