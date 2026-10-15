/* Rolling Oak Catalog service worker: offline app shell.
   Same-origin GETs: network-first for data/*.json and HTML, cache-first for static assets. Never caches Supabase API calls. */
const VERSION = "ro-v8.5";
const SHELL = ["./", "index.html", "manifest.webmanifest", "favicon.ico", "assets/css/styles.css", "assets/css/redesign.css", "assets/js/redesign.js", "assets/js/config.js", "assets/js/brand.js", "assets/js/corrections.js", "assets/js/cloud.js", "assets/js/analysis.js", "assets/js/score.js", "assets/js/prompt.js", "assets/js/marks.js", "assets/js/features.js", "assets/js/retrieve.js", "assets/js/learning.js", "assets/js/stage2.js", "assets/js/s5.js", "assets/js/nav.js", "assets/js/auth-options.js", "assets/js/app.js",
  "assets/brand/icon.svg", "assets/brand/icon-small.svg", "assets/brand/lockup-dark.svg", "assets/brand/lockup-light.svg", "assets/brand/icon-192.png", "data/catalog.json", "data/reference/points.json", "data/reference/fossils.json", "data/reference/rocks.json", "data/learned/learned-examples.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url); if (e.request.method !== "GET") return;
  const cdn = u.hostname === "cdn.jsdelivr.net";
  if (u.origin !== location.origin && !cdn) return; // Supabase, map tiles etc. go straight to the network
  const fresh = u.origin === location.origin && (/\.json$/.test(u.pathname) || e.request.mode === "navigate");
  if (fresh) { e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))); return; }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); } return r; })));
});
