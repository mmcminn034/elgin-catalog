/* Owner-only admin dashboard (#/admin). All numbers come from admin-only RPCs (admin_stats, admin_daily_series,
   migration 021) that refuse anyone who isn't the owner/admin server side; this file only draws them.
   No third-party analytics: events are counted by triggers in our own database. Also: app error logging (log_client_error). */
(() => {
  "use strict";
  const MOCK = window.ROLLING_OAK_MOCK || null;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sb = () => (window.Cloud && Cloud.client ? Cloud.client() : null);
  const q = async p => { try { const { data, error } = await p; return error ? { error: error.message } : { data }; } catch (e) { return { error: e.message }; } };
  const TZ = "America/Chicago";
  const fmt = t => t ? new Date(t).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : "—";
  const num = n => Number(n || 0).toLocaleString("en-US");
  async function rpc(name, args) { if (MOCK) { const A = MOCK.admin || {}; if (A.refuse) return { error: "admin only" };
      if (name === "admin_stats") return { data: A.stats || {} }; if (name === "admin_daily_series") return { data: A.series || [] }; (A.calls = A.calls || []).push([name, args]); return { data: null }; }
    if (!sb()) return { error: "Offline" }; return q(sb().rpc(name, args || {})); }

  /* simple inline SVG bar chart: no chart library, no network */
  function bars(series, key, label, color) { const W = 300, H = 90, n = series.length || 1, max = Math.max(1, ...series.map(d => +d[key] || 0)), bw = W / n;
    const total = series.reduce((a, d) => a + (+d[key] || 0), 0);
    return `<figure class="adm-chart" data-chart="${esc(key)}"><figcaption><strong>${esc(label)}</strong> <span class="muted">${num(total)} in ${n} days</span></figcaption>
      <svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="${esc(label)} per day, last ${n} days, total ${total}">${series.map((d, i) => { const h = Math.round((+d[key] || 0) / max * H);
        return `<rect x="${(i * bw + 1).toFixed(1)}" y="${H - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h}" fill="${color}"><title>${esc(d.day)}: ${+d[key] || 0}</title></rect>`; }).join("")}
      <text x="0" y="${H + 12}" font-size="9" fill="currentColor">${esc((series[0] || {}).day || "")}</text><text x="${W}" y="${H + 12}" font-size="9" text-anchor="end" fill="currentColor">${esc((series[n - 1] || {}).day || "")}</text><text x="${W}" y="9" font-size="9" text-anchor="end" fill="currentColor">max ${max}</text></svg></figure>`; }
  const tile = (k, v, sub) => `<div class="adm-tile" data-stat="${esc(k)}"><span class="adm-v">${v}</span><span class="adm-k">${esc(sub)}</span></div>`;

  async function mount(host) { if (!host || $("#admDash", host)) return;
    const box = document.createElement("section"); box.id = "admDash"; box.className = "adm-dash"; box.setAttribute("aria-labelledby", "admDashH");
    box.innerHTML = '<h2 id="admDashH">Dashboard</h2><p class="help">Loading…</p>'; const lede = $(".lede", host); (lede ? lede.after(box) : host.prepend(box));
    const [s, ser, gs] = await Promise.all([rpc("admin_stats"), rpc("admin_daily_series", { p_days: 30 }), rpc("admin_guest_stats")]);
    if (s.error) { box.innerHTML = `<h2 id="admDashH">Dashboard</h2><p class="err">Dashboard unavailable: ${esc(s.error)}</p>`; if (window.PayDig) PayDig.adminMount(host); return; }
    const S = s.data || {}, D = ser.data || [], nl = S.since_last_visit || {}, P = S.plans || {}, pr = S.prefs || {};
    const newBits = [["signups", "new signup"], ["finds", "new find"], ["questions", "expert question"], ["errors", "app error"]].filter(([k]) => +nl[k]).map(([k, w]) => `${num(nl[k])} ${w}${+nl[k] === 1 ? "" : "s"}`);
    box.innerHTML = `<h2 id="admDashH">Dashboard</h2>
      <p class="adm-new" id="admNew" role="status">${S.last_visit ? (newBits.length ? `🔔 New since your last visit (${esc(fmt(S.last_visit))}): <strong>${newBits.join(", ")}</strong>.` : `Nothing new since your last visit (${esc(fmt(S.last_visit))}).`) : "First visit: counts below start from today."}</p>
      <div class="adm-tiles">${tile("signups", num(S.signups_week), `signups this week · ${num(S.signups_today)} today · ${num(S.users)} accounts`)}${tile("finds", num(S.finds_week), `finds this week · ${num(S.finds_today)} today · ${num(S.finds_total)} total`)}
        ${tile("visibility", `${num(S.public)} / ${num(S.private)}`, `public / private · ${num(S.vis_changes_week)} changes this week`)}${tile("plans", `${num(P.free)} · ${num(P.annual)} · ${num(P.lifetime)}`, "free · annual · lifetime")}
        ${tile("ai", num(S.ai_week), `AI IDs this week · ${num(S.ai_today)} today · ${num(S.ai_total)} total`)}${gs && gs.data && gs.data.sessions_total != null ? tile("guests", num(gs.data.sessions_week), `guest sessions this week · ${num(gs.data.sessions_today)} today · ${num(gs.data.finds_week)} guest finds · ${num(gs.data.signup_clicks_week)} sign-up clicks · ${num(gs.data.imports_week)} imports (anonymous counts only)`) : ""}${tile("questions", num(S.questions_week), `expert questions this week · ${num(S.questions_open)} open · ${num(S.questions_total)} total`)}
        ${tile("errors", num(S.errors_week), "app errors logged this week")}</div>
      <div class="adm-charts">${bars(D, "signups", "Signups", "#c8642d")}${bars(D, "finds", "Finds added", "#4f7a3a")}${bars(D, "ai", "AI identifications", "#3a6a8a")}${bars(D, "vis_changes", "Public/private changes", "#8a6a3a")}${bars(D, "questions", "Expert questions", "#7a4f8a")}${bars(D, "errors", "App errors", "#a33")}</div>
      <div class="adm-cols"><div><h3>Recent signups</h3>${(S.recent_signups || []).length ? `<table class="adm-table" id="admSignups"><thead><tr><th>Email</th><th>Joined (CT)</th><th>Plan</th></tr></thead><tbody>${S.recent_signups.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(fmt(u.created_at))}</td><td>${esc(u.plan || "free")}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No signups yet.</p>'}</div>
        <div><h3>Plan changes and upgrades</h3>${(S.recent_grants || []).length ? `<table class="adm-table" id="admGrants"><thead><tr><th>Email</th><th>Plan</th><th>When (CT)</th><th>Note</th></tr></thead><tbody>${S.recent_grants.map(g => `<tr><td>${esc(g.email || "deleted account")}</td><td>${esc(g.plan)}</td><td>${esc(fmt(g.created_at))}</td><td>${esc(g.note || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No plan grants yet.</p>'}
        <h3>Recent app errors</h3>${(S.recent_errors || []).length ? `<ul class="adm-errs">${S.recent_errors.map(e => `<li><span class="muted">${esc(fmt(e.created_at))} · ${esc(e.where || "")}</span> ${esc(e.msg)}</li>`).join("")}</ul>` : '<p class="muted">No errors logged.</p>'}</div></div>
      <form id="admPrefs" class="adm-prefs"><h3>Owner notifications</h3><label><input type="checkbox" name="daily" ${pr.notify_daily_report !== false ? "checked" : ""}> Daily owner report (previous day's signups, finds, AI use, public/private, anomalies)</label>
        <label><input type="checkbox" name="signups" ${pr.notify_new_signups !== false ? "checked" : ""}> Flag new signups in the "new since last visit" notice</label><button class="btn small">Save preferences</button><span class="help" id="admPrefsMsg" role="status"></span>
        <p class="help">Saved in our database. Emails and these numbers are visible only to you. Times are America/Chicago (CT).</p></form>
      <p class="help">Updated ${esc(fmt(S.generated_at))} · <button type="button" class="btn small ghost" id="admRefresh">Refresh</button></p>`;
    $("#admPrefs", box).onsubmit = async e => { e.preventDefault(); const f = e.target, r = await rpc("admin_set_prefs", { p_daily: f.daily.checked, p_signups: f.signups.checked }); $("#admPrefsMsg", box).textContent = r.error || "✓ Saved"; };
    $("#admRefresh", box).onclick = () => { box.remove(); mount(host); };
    rpc("admin_mark_seen"); if (window.PayDig) PayDig.adminMount(host); }

  /* app error logging into our own DB (rate-limited server side); messages trimmed, no stack, no page data */
  let sent = 0; const logErr = (msg, where) => { if (MOCK || sent >= 5 || !sb()) return; sent++; try { sb().rpc("log_client_error", { p_msg: String(msg || "").slice(0, 300), p_where: String(where || location.hash.split("/").slice(0, 2).join("/")).slice(0, 120) }).then(() => {}, () => {}); } catch (_) {} };
  addEventListener("error", e => { if (e && e.message && !/ResizeObserver|Script error/.test(e.message)) logErr(e.message, (e.filename || "").split("/").pop() + ":" + (e.lineno || 0)); });
  addEventListener("unhandledrejection", e => { const m = e && e.reason && (e.reason.message || String(e.reason)); if (m && !/Failed to fetch|NetworkError|AbortError|Load failed/.test(m)) logErr(m, "promise"); });
  window.AdminDash = { mount, bars };
})();
