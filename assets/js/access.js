/* Access control for the UI (2026-10-18 security fix). The database (RLS) is the real gate; this keeps the UI honest:
   - signed out: only Home, Discover, public UF pages (#/p, legacy #/find redirects), public catalog pages, Pricing and About
   - signed in: Catalog/Review show only finds in catalogs the user owns or is a member of; edit only as owner/editor
   - Experts: Mark (admin) and approved experts only */
(() => {
  const ANON = new Set(["home", "discover", "p", "pricing", "membership", "about", "find", "c", "privacy", "terms", "refunds", "contact", "experts", "merch", "paydig"]);
  const MOCK = window.ROLLING_OAK_MOCK;
  /* test copy only (/workspace/mk_test_copy.sh appends it to config.js; never deployed): the browser acts as the owner's own device,
     as the app did before accounts, so the older catalog regressions can run signed out. RLS still guards the cloud. */
  const DEV = !!window.ROLLING_OAK_TEST_DEVICE;
  const st = () => (window.Cloud ? Cloud.state() : { user: null, online: false });
  let cols = [], colsFor = null, expert = false;
  const uid = () => (st().user || {}).id || null;
  async function load() { const u = uid(); if (!u) { cols = []; colsFor = null; expert = false; return; } if (colsFor === u) return;
    colsFor = u; try { cols = window.Cloud ? await Cloud.collections() : []; } catch { cols = []; }
    /* every account gets a default 'My Collection' (the database also creates it at sign-up) */
    if (!cols.some(c => c.role === "owner") && !MOCK && window.Cloud && Cloud.client && Cloud.client() && (window.ROLLING_OAK_CLOUD || {}).schema014) {
      try { const r = await Cloud.client().rpc("ensure_default_catalog"); if (!r.error) cols = await Cloud.collections(); } catch {} }
    if (!cols.length) colsFor = null; // session not ready yet (or offline): try again on the next load
    try { expert = !!(window.Membership && Membership.isExpert && await Membership.isExpert()); } catch { expert = false; } nav();
    document.dispatchEvent(new CustomEvent("access:change")); }
  /* test harness only: the mock owner "owns" the bundled seed rows, as the real owner owns them in the cloud */
  const mockOwner = () => DEV || !!(MOCK && uid() && (!MOCK.adminUserId || uid() === MOCK.adminUserId));
  function roleFor(r) { const u = uid(); if (!r) return null; if (!u) return DEV && !r._owner ? "owner" : null;
    if (r._owner && r._owner === u) return "owner";
    const c = r.collection_id && cols.find(x => x.id === r.collection_id); if (c && c.role) return c.role;
    if (r._owner) return null;                                          // someone else's cloud row (e.g. a public find)
    if (r._src === "local" && r.created_local) return "owner";          // added on this device by the signed-in user
    if (mockOwner()) return "owner";
    return null; }
  const canEdit = r => ["owner", "editor"].includes(roleFor(r));
  const canView = r => !!roleFor(r);
  const isAdmin = () => !!(window.Membership && Membership.isAdmin && Membership.isAdmin());
  const allowed = view => DEV || !!uid() || ANON.has(view);
  const showExperts = () => !!uid() && (isAdmin() || expert);
  function nav() { const signed = DEV || !!uid();
    document.querySelectorAll('a[data-route], a.add-cta, [data-newcat]').forEach(a => {
      const v = a.classList.contains("add-cta") ? "add" : a.hasAttribute("data-newcat") ? "catalogs" : a.dataset.route;
      let hide = !signed && !ANON.has(v);
      if (v === "experts") hide = !showExperts();
      if (hide) { if (!a.hidden) { a.hidden = true; a.dataset.accHid = "1"; } }
      else if (a.dataset.accHid) { a.hidden = false; delete a.dataset.accHid; } });
    document.body.classList.toggle("is-anon", !signed); }
  window.Access = { ANON, load, roleFor, canEdit, canView, allowed, nav, showExperts, cols: () => cols, ownerDevice: mockOwner, reset() { colsFor = null; } };
  document.addEventListener("DOMContentLoaded", () => { nav(); if (window.Cloud && Cloud.on) Cloud.on(() => { load().then(nav); nav(); }); });
})();
