/* Optional sign-in methods: Google OAuth and phone (SMS one-time code). Each is hidden unless enabled in config.js. */
(() => {
  "use strict";
  const C = window.ROLLING_OAK_CLOUD || {}, $ = s => document.querySelector(s);
  const g = !!C.authGoogle, ph = !!C.authPhone; if (!g && !ph) return;
  $("#authAlt").hidden = false; $("#authGoogle").hidden = !g; $("#phoneBox").hidden = !ph;
  const msg = (m, err) => { const el = $("#phoneMsg"); el.textContent = m || ""; el.className = err ? "err" : "help"; };
  /* "(512) 555-0123", "512.555.0123", "1 512 555 0123" -> "+15125550123"; "+44 7700 900123" kept as international. */
  const toE164 = v => { v = (v || "").trim(); const d = v.replace(/\D/g, "");
    if (v.startsWith("+")) return /^[1-9]\d{7,14}$/.test(d) ? "+" + d : null;
    if (d.length === 10 && /^[2-9]/.test(d)) return "+1" + d; if (d.length === 11 && d[0] === "1") return "+" + d; return null; };
  const pretty = e => /^\+1\d{10}$/.test(e) ? `+1 (${e.slice(2, 5)}) ${e.slice(5, 8)}-${e.slice(8)}` : e;
  const asYouType = v => { if (v.trim().startsWith("+")) return v; const d = v.replace(/\D/g, "").replace(/^1(?=\d)/, "").slice(0, 10);
    return d.length < 4 ? d : d.length < 7 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
  window.AuthOptions = { toE164, pretty };
  if (g) $("#authGoogle").onclick = async () => { const b = $("#authGoogle"); b.disabled = true;
    try { const { error } = await Cloud.google(); if (error) { msg(error.message, true); b.disabled = false; } } catch (e) { msg("Could not reach Google sign-in: " + e.message, true); b.disabled = false; } };
  if (!ph) return;
  let phone = null, timer = null;
  const num = $("#phoneNum"), code = $("#phoneCode");
  num.addEventListener("input", () => { const at = num.value.length === num.selectionStart; const f = asYouType(num.value); if (f !== num.value && at) num.value = f; });
  const countdown = s => { clearInterval(timer); const b = $("#codeResend"); b.disabled = true; const tick = () => { if (s <= 0) { clearInterval(timer); b.disabled = false; b.textContent = "Resend code"; return; } b.textContent = `Resend in ${s--}s`; }; tick(); timer = setInterval(tick, 1000); };
  const friendly = m => /rate|seconds|too many/i.test(m) ? "Too many attempts. Wait a minute and try again." : /invalid.*phone|phone.*invalid/i.test(m) ? "That number doesn't look valid." : /provider|sms|unsupported/i.test(m) ? "Text sign-in isn't available right now. Use email instead." : m;
  const send = async () => { const e = toE164(num.value); if (!e) { msg("Enter a 10-digit US number, or + and country code.", true); num.focus(); return false; }
    msg("Sending code…"); $("#phoneSend").disabled = true;
    try { const { error } = await Cloud.phoneOtp(e); if (error) { msg(friendly(error.message), true); return false; } }
    catch (err) { msg("Could not reach the sign-in service: " + err.message, true); return false; } finally { $("#phoneSend").disabled = false; }
    phone = e; $("#phoneForm").hidden = true; $("#codeForm").hidden = false; $("#codeSentTo").innerHTML = `We texted a 6-digit code to <strong>${pretty(e)}</strong>. It expires in a few minutes.`;
    msg(""); code.value = ""; code.focus(); countdown(60); return true; };
  $("#phoneForm").onsubmit = e => { e.preventDefault(); send(); };
  $("#codeResend").onclick = async () => { num.value = pretty(phone); if (await send()) msg("New code sent."); };
  $("#codeBack").onclick = () => { clearInterval(timer); $("#codeForm").hidden = true; $("#phoneForm").hidden = false; msg(""); num.focus(); };
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); if (code.value.length === 6) $("#codeForm").requestSubmit(); });
  $("#codeForm").onsubmit = async e => { e.preventDefault(); if (!/^\d{6}$/.test(code.value)) return msg("Enter the 6-digit code from the text.", true);
    $("#codeVerify").disabled = true; msg("Checking…");
    try { const { error } = await Cloud.verifyPhone(phone, code.value); if (error) { msg(/expired|invalid/i.test(error.message) ? "That code is wrong or expired. Check it, or resend." : friendly(error.message), true); code.select(); return; }
      clearInterval(timer); msg("Signed in.", false); if (Cloud.acceptInvites) await Cloud.acceptInvites(); setTimeout(() => location.reload(), 600);
    } catch (err) { msg("Could not reach the sign-in service: " + err.message, true); } finally { $("#codeVerify").disabled = false; } };
})();
