/* UnEarthed Finds first-party traffic logger (migration 028). Loaded on every app route and on the static /reference/ pages.
   Sends ONE small row per page view to our own database (rpc track_view): a short path, the referrer DOMAIN on landing,
   utm_source / utm_medium / utm_campaign on landing, and a Reference Catalog record id on record views. The server adds a coarse
   device type, a country code from the edge header if present, and a visitor hash that rotates daily (no IP stored).
   No cookies, no third-party scripts, no fingerprinting. Honours Do Not Track and Global Privacy Control. The owner's own
   browsing is skipped. Off on hosts other than unearthedfinds.com (dev/test) unless localStorage uf-track-dev = 1.
   Sign-up attribution: the landing source (utm / referrer domain) is kept in this browser's localStorage for 30 days and sent
   once, only if this browser creates a NEW account (rpc traffic_signup_source). Docs: docs/traffic.md */
(() => {
  "use strict";
  if (window.UFTraffic) return;
  const C = window.ROLLING_OAK_CLOUD || {}, MOCK = window.ROLLING_OAK_MOCK || null;
  const API = (C.url || "https://qqllbazrwfebpnqhdwox.supabase.co") + "/rest/v1/rpc/", KEY = C.key || "sb_publishable_AgbAHVD0pUYDrXpdgjTFig_yQmSOPpr";
  const ADMIN = (MOCK && MOCK.adminUserId) || C.adminUserId || "a4779d71-ff10-4c11-864d-c79f83214b00";
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const dnt = () => [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(x => x === "1" || x === "yes") || navigator.globalPrivacyControl === true;
  const liveHost = /(^|\.)unearthedfinds\.com$/i.test(location.hostname) || ls.get("uf-track-dev") === "1";
  const off = () => dnt() || ls.get("uf-owner") === "1" || ss.get("uf-tv-off") === "1" || (!MOCK && !liveHost);
  const SELF = /(^|\.)unearthedfinds\.com$/i;
  const host = u => { try { const h = new URL(u).hostname.toLowerCase().replace(/^www\./, ""); return h && !SELF.test(h) && h !== location.hostname ? h : null; } catch { return null; } };

  /* short, non-identifying path: '/#/discover', '/#/try/new', '/#/reference/record' (+ rec id), '/reference/r/' (+ rec id).
     Deeper app segments (find ids, user pages) are dropped; magic-link hashes (#access_token=…) never leave the browser. */
  function where() {
    let p = location.pathname.replace(/\/index\.html$/, "/") || "/", rec = null;
    const m = p.match(/\/reference\/r\/([^/]+)\.html$/);
    if (m) { const meta = document.querySelector('meta[name="uf-rec"]'); rec = (meta && meta.content) || m[1]; p = p.slice(0, p.lastIndexOf("/") + 1); }
    const h = location.hash || "";
    if (/^#\/[^=]*$/.test(h.split(/[?&]/)[0])) {
      const seg = h.slice(2).split(/[?&]/)[0].split("/").filter(Boolean);
      if (seg[0] === "reference" && seg[1]) { try { rec = decodeURIComponent(seg[1]); } catch { rec = seg[1]; } p += "#/reference/record"; }
      else if (seg.length) p += "#/" + seg.slice(0, seg[0] === "try" ? 2 : 1).join("/");
    }
    return { p: p.slice(0, 160), rec: rec ? rec.slice(0, 120) : null };
  }
  function utm() { const out = {}, read = qs => { try { new URLSearchParams(qs).forEach((v, k) => { if (/^utm_(source|medium|campaign)$/.test(k) && v && !out[k]) out[k] = v.slice(0, 80); }); } catch {} };
    read(location.search); const h = location.hash, i = h.indexOf("?"); if (i > 0 && !/access_token/.test(h)) read(h.slice(i + 1)); return out; }

  async function post(fn, body, token) { if (MOCK) { (MOCK.traffic = MOCK.traffic || []).push([fn, body]); return { ok: true, status: 200 }; }
    return fetch(API + fn, { method: "POST", keepalive: true, credentials: "omit", referrerPolicy: "no-referrer",
      headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}), body: JSON.stringify(body) }); }

  let last = null, landing = true;
  async function send() {
    if (off()) return; const w = where(); if (w.p + "|" + w.rec === last) return; last = w.p + "|" + w.rec;
    const body = { p_path: w.p, p_rec: w.rec };
    if (landing) { landing = false; const u = utm(), r = host(document.referrer);
      if (r) body.p_ref = r; if (u.utm_source) body.p_src = u.utm_source; if (u.utm_medium) body.p_med = u.utm_medium; if (u.utm_campaign) body.p_camp = u.utm_campaign;
      if (r || u.utm_source || u.utm_campaign) { let prev = null; try { prev = JSON.parse(ls.get("uf-src") || "null"); } catch {}
        if (!prev || Date.now() - (prev.t || 0) > 30 * 864e5) ls.set("uf-src", JSON.stringify({ s: u.utm_source || null, m: u.utm_medium || null, c: u.utm_campaign || null, r, t: Date.now() })); } }
    try { const res = await post("track_view", body); if (res && res.status === 404) ss.set("uf-tv-off", "1"); /* 028 not applied yet: stay quiet this session */ } catch { /* never break the page */ }
  }

  /* app only: learn who is signed in (skip the owner; attribute brand-new accounts once) */
  async function account() { const Cl = window.Cloud; if (!Cl || !Cl.state) return; const st = Cl.state(), u = st && st.user; if (!u) return;
    if (u.id === ADMIN) { ls.set("uf-owner", "1"); return; }
    if (dnt() || ls.get("uf-src-sent") === u.id) return; let src = null; try { src = JSON.parse(ls.get("uf-src") || "null"); } catch {} if (!src) return;
    try { const sb = Cl.client && Cl.client(); let r;
      if (MOCK) r = await post("traffic_signup_source", { p_src: src.s, p_med: src.m, p_camp: src.c, p_ref: src.r });
      else if (sb) { const { error } = await sb.rpc("traffic_signup_source", { p_src: src.s, p_med: src.m, p_camp: src.c, p_ref: src.r }); r = { ok: !error }; }
      if (r && r.ok) ls.set("uf-src-sent", u.id); } catch {} }

  async function start() {
    if (window.Cloud && Cloud.whenReady) { try { await Promise.race([Cloud.whenReady(), new Promise(r => setTimeout(r, 2500))]); } catch {} await account();
      if (Cloud.on) Cloud.on(() => { account(); }); }
    send();
    addEventListener("hashchange", () => setTimeout(send, 0));
    for (const k of ["pushState", "replaceState"]) { const f = history[k]; history[k] = function () { const r = f.apply(this, arguments); setTimeout(send, 0); return r; }; }
  }
  window.UFTraffic = { where, utm, send };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0)); else setTimeout(start, 0);
})();
