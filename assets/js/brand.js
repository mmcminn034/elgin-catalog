/* Brand: applies window.ROLLING_OAK_BRAND to the page. Elements opt in with data-brand="<template>"
   ({name}, {short}, {home}, {owner}, {tagline}); data-brand-attr="alt|aria-label|content" templates an attribute instead.
   The static HTML keeps today's text, so the page reads the same without JS. */
(() => {
  const B = window.ROLLING_OAK_BRAND || {};
  const fill = t => String(t).replace(/\{(name|short|home|owner|tagline)\}/g, (_, k) => (k === "home" ? B.homeLabel : B[k]) || "").replace(/\s·\s+·\s/g, " · ").replace(/,\s*$/, "").trim();
  const name = () => B.name || "UnEarthed";
  function apply(root = document) {
    root.querySelectorAll("[data-brand]").forEach(el => { const v = fill(el.dataset.brand), a = el.dataset.brandAttr; if (a) el.setAttribute(a, v); else el.textContent = v; });
    root.querySelectorAll("[data-brand-split]").forEach(el => { const w = name().split(" "), last = w.pop(); el.innerHTML = ""; el.append(document.createTextNode((w.join(" ") + " ").trimStart())); const s = document.createElement("span"); s.className = "grad"; s.textContent = last; el.append(s); });
    root.querySelectorAll("[data-home-only]").forEach(el => { el.hidden = !B.homeLabel; });
  }
  window.Brand = { name, short: () => B.short || name(), home: () => B.homeLabel || "", fill, apply, cfg: B };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply()); else apply();
})();
