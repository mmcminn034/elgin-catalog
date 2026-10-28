// Mocked end-to-end test of the analyze-find edge function: no network, no OpenAI. Run: deno run -A tests/edge/analyze_find_mock_test.ts
// Mocks Supabase REST/auth and the AI provider via globalThis.fetch and captures the Deno.serve handler.
let handler: (r: Request) => Promise<Response> = async () => new Response("x");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => { handler = h; return {}; };
Deno.env.set("SUPABASE_URL", "http://sb.mock"); Deno.env.set("SUPABASE_ANON_KEY", "anon"); Deno.env.set("AI_API_KEY", "test-key"); Deno.env.set("AI_BASE_URL", "http://ai.mock/v1"); Deno.env.set("SITE_URL", "http://site.mock/");
const real = globalThis.fetch;
const st = { providerCalls: [] as Record<string, any>[], cacheRow: null as any, quota: { allowed: true, used: 1, cap: 50, member: false } as Record<string, unknown>, failRefsOnce: false, cacheUpserts: 0, refundCalls: 0 };
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input), method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.startsWith("http://ai.mock")) { const b = JSON.parse(init.body); st.providerCalls.push(b);
    const hasRef = JSON.stringify(b.messages).includes("REFERENCE IMAGE");
    if (st.failRefsOnce && hasRef) return J({ error: { message: "bad image url" } }, 400);
    return J({ usage: { prompt_tokens: 5000, completion_tokens: 900 }, choices: [{ message: { content: JSON.stringify({
      candidates: [{ name: "Pedernales", confidence_pct: 92, why: "stem", why_not: "" }, { name: "Natural rock / geofact (not an artifact)", confidence_pct: 70, why: "x", why_not: "" }],
      artifact_likelihood: { verdict: "likely_natural", confidence_pct: 80, evidence_for: [], evidence_against: ["no flake scars at 30.123456, -97.123456"] }, diagnostic_checklist: [{ feature: "bifacial flaking", status: "absent", note: "" }],
      photo_quality: { usable: true, issues: ["blurry"], retake: ["side light"], views_seen: ["front"] }, marks: [], gaps: [], measurements: {}, caveat: "" }) } }] }); }
  if (url.startsWith("http://site.mock/")) return J(url.includes("priors") ? { packs: [{ match: { admin1: ["Texas"] }, region: "Central Texas", common_dart_points: ["Pedernales"] }] } : { meta: {}, types: [] });
  if (url.startsWith("http://sb.mock/auth/v1/user")) return J({ id: "u1", aud: "authenticated", email: "t@example.com" });
  if (url.includes("/rpc/ai_quota_take")) return J(st.quota);
  if (url.includes("/rpc/ai_quota_refund")) { st.refundCalls++; return J(null); }
  if (url.includes("/rpc/type_accuracy")) return J([{ candidate_type: "Pedernales", matches: 1, close: 0, wrong: 5, total: 6 }]);
  if (url.includes("/rpc/similar_reference_media")) return J([{ id: "wc:1", title: "Caliche", thumb_url: "https://upload.wikimedia.org/x.jpg", license: "CC BY-SA 4.0", source_url: "https://commons.wikimedia.org/x" }]);
  if (url.includes("/rest/v1/ai_cache")) { if (method === "GET") return st.cacheRow ? J(st.cacheRow) : new Response("", { status: 406, headers: { "content-type": "application/json" } }); st.cacheUpserts++; return J([]); }
  if (url.includes("/rest/v1/")) return J([]);
  return real(input, init);
}) as typeof fetch;
await import("../../supabase/functions/analyze-find/index.ts");
const call = async (extra: Record<string, unknown> = {}) => { const r = await handler(new Request("http://f/analyze-find", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ catalog_id: "ELG-1", kind: "artifact", photos: [{ url: "https://x.example/a.jpg" }, { url: "https://x.example/b.jpg" }, { url: "https://x.example/c.jpg" }], record: { object_type: "point" }, region_hint: { admin1: "Texas" }, rules_top: ["Pedernales"], attrs: { material: "chert", flaking: "no flake scars visible", bogus: "x" }, ...extra }) })); return { status: r.status, body: await r.json() }; };
let fails = 0; const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };
let r = await call();
ok(r.status === 200 && r.body.ok, "200 ok"); const res = r.body.result;
ok(st.providerCalls.length === 1, "one provider call");
const msg = JSON.stringify(st.providerCalls[0].messages);
ok(msg.includes("OWNER-SUPPLIED") || msg.includes("Material: chert"), "attrs in prompt"); ok(!msg.includes("bogus"), "unknown attr dropped");
ok(msg.includes("REGION PRIORS") && msg.includes("Pedernales"), "priors in prompt"); ok(msg.includes("PAST FEEDBACK"), "history in prompt");
ok(msg.includes("REFERENCE IMAGE") && msg.includes('"detail":"low"'), "reference image low detail"); ok(msg.includes('"detail":"high"'), "owner photos high detail (first 2)");
ok(st.providerCalls[0].max_tokens === 2500 && st.providerCalls[0].temperature === 0.2, "max_tokens cap for classic model");
ok(res.candidates[0].confidence_pct <= 35, "calibrated: natural verdict caps artifact candidate (" + res.candidates[0].confidence_pct + ")");
ok(res.candidates[1].confidence_pct === 70, "natural candidate not capped"); ok(res.candidates[0].factors.some((f: any) => f.source === "calibration"), "calibration factor listed");
ok(!JSON.stringify(res).includes("30.123456"), "coordinates scrubbed"); ok(res.artifact_likelihood.verdict === "likely_natural", "artifact_likelihood kept");
ok(res.reference_images_used.length === 1 && res.reference_images_used[0].license === "CC BY-SA 4.0", "reference image credited"); ok(st.cacheUpserts === 1, "result cached"); ok(r.body.prompt_version?.startsWith("match-"), "prompt_version returned");
// cache hit: no provider call, no quota
st.cacheRow = { result: res, model: "gpt-4o-mini", created_at: new Date().toISOString() }; const before = st.providerCalls.length; r = await call();
ok(r.body.cached === true && st.providerCalls.length === before, "cache hit skips model");
r = await call({ refresh: true }); ok(st.providerCalls.length === before + 1, "refresh bypasses cache");
st.cacheRow = null;
// provider 400 on reference image: retry without
st.failRefsOnce = true; const b2 = st.providerCalls.length; r = await call({ refresh: true }); ok(r.status === 200 && st.providerCalls.length === b2 + 2 && r.body.result.reference_images_used.length === 0, "400 retries without reference images"); st.failRefsOnce = false;
// global cap
st.quota = { allowed: false, global: true, used: 300, cap: 300 }; r = await call(); ok(r.status === 429 && r.body.code === "ai_global_cap", "global cap -> 429"); 
st.quota = { allowed: false, used: 50, cap: 50 }; r = await call(); ok(r.status === 429 && r.body.code === "ai_daily_cap", "per-account cap -> 429");
Deno.exit(fails ? 1 : 0);
