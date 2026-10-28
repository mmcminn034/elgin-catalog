// Supabase Edge Function: analyze-find
// Vision-model photo analysis for Rolling Oak Catalog (every signed-in account; Free has a daily safety cap, members unlimited).
// Provider-agnostic: any OpenAI-compatible /chat/completions endpoint that accepts image_url content.
// Env: AI_API_KEY (required), AI_BASE_URL (default https://api.openai.com/v1), AI_MODEL (default gpt-4o-mini),
//      SUPABASE_URL / SUPABASE_ANON_KEY (provided automatically by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import "../_shared/retrieve.js"; // sets globalThis.Retrieve (same code as assets/js/retrieve.js)
import "../_shared/prompt.js"; // globalThis.Prompt: region-neutral SYSTEM prompt, external-reference retrieval, user text builder
import "../_shared/score.js"; // globalThis.Score: 0-100 clamp (AI ceiling 95), factors
import "../_shared/matching.js"; // globalThis.Matching: attributes, region priors, output sanitizers, confidence calibration, cache key, cost estimate
// deno-lint-ignore no-explicit-any
const Retrieve = (globalThis as any).Retrieve as { rankSimilar: (t: unknown, ex: unknown[], o?: unknown) => { example: Record<string, any>; score: number; why: string[] }[] };
// deno-lint-ignore no-explicit-any
const Prompt = (globalThis as any).Prompt; // deno-lint-ignore no-explicit-any
const Score = (globalThis as any).Score; // deno-lint-ignore no-explicit-any
const Matching = (globalThis as any).Matching;
const SITE = (Deno.env.get("SITE_URL") || "https://unearthedfinds.com/").replace(/\/?$/, "/");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Mark = { type: "arrow" | "circle" | "line" | "measure" | "box"; coords: number[]; label: string; explanation: string; links_to?: { kind: "candidate" | "feature" | "date"; ref: string } };
type Result = { candidates: { name: string; type_id?: string; confidence?: string; confidence_pct?: number; factors?: { sign: string; reason: string; source: string | null }[]; reference_ids?: string[]; why: string; why_not: string }[]; external_references_used?: unknown[]; reference_status?: string; alternatives?: string[]; marks: { photo_index: number; marks: Mark[] }[];
  measurements?: { length_mm?: number | null; width_mm?: number | null; thickness_mm?: number | null; scale_visible?: boolean; note?: string }; next_photos?: string[]; gaps: string[]; caveat: string; similar_used?: { catalog_id: string; confirmed_type: string; why: string[] }[] };

const SYSTEM: string = Prompt.SYSTEM; // full text in supabase/functions/_shared/prompt.js (also shown in the app's 'View AI prompt')

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser(); if (!user) return json({ error: "Sign in to use AI photo analysis.", code: "sign_in_required" }, 401);
  const key = Deno.env.get("AI_API_KEY"); if (!key) return json({ error: "AI photo analysis isn't set up yet.", code: "ai_unavailable" }, 503);

  let body: { ping?: boolean; catalog_id: string; kind: string; photos: { url: string; label?: string }[]; record?: Record<string, unknown>; kb?: unknown; checklist?: string[]; examples?: unknown[]; region_check?: unknown; region?: string; region_hint?: unknown; rules_top?: string[]; attrs?: Record<string, unknown>; refresh?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (body.ping) return json({ ok: true, ready: true }); // setup probe: does not use quota
  const photos = (body.photos || []).filter(p => /^https:\/\//.test(p.url)).slice(0, 6);
  if (!photos.length) return json({ error: "No https photo URLs" }, 400);

  // Matching v2 (migration 025): owner-supplied attributes (validated), result cache (identical photos + attributes + prompt version = no model call, no quota),
  // and a global daily safety cap. Photo URLs are cache-keyed without their query string.
  const attrs = Matching.clean(body.attrs || {}, body.kind);
  const cacheKey = Matching.cacheKey({ catalog_id: body.catalog_id, kind: body.kind, photos: photos.map(p => p.url), record: body.record, attrs, region: (body.region_hint as { admin1?: string } | undefined)?.admin1 || body.region || "" });
  if (!body.refresh) { try { const { data: hit } = await sb.from("ai_cache").select("result, model, created_at").eq("cache_key", cacheKey).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).maybeSingle();
    if (hit?.result) return json({ ok: true, catalog_id: body.catalog_id, model: hit.model, result: hit.result, cached: true, cached_at: hit.created_at, prompt_version: Matching.VERSION }); } catch { /* cache is best effort */ } }

  // Membership v1 (migrations 012/013): every signed-in plan can use AI. Free accounts have a per-account daily SAFETY cap
  // (app_config.ai_daily_cap, default 50) taken atomically in the database; members (Annual/Lifetime) are unlimited. Fails closed.
  const { data: quota, error: qe } = await sb.rpc("ai_quota_take");
  if (qe) return json({ error: "AI photo analysis is temporarily unavailable. Please try again later.", code: "ai_unavailable" }, 503);
  if (quota && quota.allowed === false && quota.global) return json({ error: "AI photo analysis has reached today's overall limit and resets at midnight UTC. Your find is saved; the rules-based suggestions still work.", code: "ai_global_cap" }, 429);
  if (quota && quota.allowed === false) return json({ error: `You've reached today's AI limit (${quota.cap} analyses). It resets at midnight UTC.`, code: "ai_daily_cap", used: quota.used, cap: quota.cap }, 429);
  const refund = async () => { try { await sb.rpc("ai_quota_refund"); } catch { /* best effort */ } };

  // verified examples from the shared library (RLS applies)
  const { data: ex } = await sb.from("verified_examples").select("catalog_id, category, confirmed_type, type_ids, features, notes, length_mm, material, region, era, photo_ids").eq("category", body.kind).limit(200);
  // RAG: rank verified references by similarity (same code as the browser panel), keep top 3 and attach one photo each
  const target = { ...(body.record || {}), catalog_id: body.catalog_id, category: body.kind, region: (body as { region?: string }).region };
  const top = Retrieve.rankSimilar(target, ex || body.examples || [], { k: 3 });
  const ids = top.map(t => t.example.catalog_id);
  const { data: refPhotos } = ids.length ? await sb.from("photos").select("catalog_id, repo_path, storage_path, sort, view").in("catalog_id", ids).order("sort") : { data: [] };
  const urlOf = (p: { repo_path?: string; storage_path?: string }) => p.storage_path ? sb.storage.from("find-photos").getPublicUrl(p.storage_path).data.publicUrl : p.repo_path ? new URL(p.repo_path, SITE).href : null;
  const similar = top.map(t => { const ph = (refPhotos || []).find(p => p.catalog_id === t.example.catalog_id); return { catalog_id: t.example.catalog_id, confirmed_type: t.example.confirmed_type, region: t.example.region, era: t.example.era, material: t.example.material, length_mm: t.example.length_mm, notes: t.example.notes || t.example.features, why_similar: t.why, photo: ph ? urlOf(ph) : null }; });

  // EXTERNAL REFERENCES: published typology (reference_types table from migration 009; falls back to the static JSON). Visible status, never silent.
  let refRows: unknown[] = [], patterns: Record<string, string> = {}, reference_status = "ok";
  try { const layer = body.kind === "fossil" ? "public-fossils" : body.kind === "rock" ? "public-minerals" : "public-types"; /* only the find's own category layer is ranked; the top 5 go to the prompt */
    const pj = await (await fetch(SITE + "data/reference/" + layer + ".json")).json(); patterns = pj.meta?.trait_patterns || {}; refRows = pj.types || [];
    const { data: rt, error: re } = layer !== "public-types" ? { data: null, error: null } : await sb.from("reference_types").select("id, name, aliases, typology_system, category, period, dates, continent, country, admin1, length_mm, width_mm, thickness_mm, traits, similar_types, sources").limit(5000);
    if (!re && rt && rt.length) refRows = rt.map((x: Record<string, unknown>) => ({ ...x, similar: x.similar_types })); } catch (e) { reference_status = "unavailable: " + String(e).slice(0, 80); }
  if (!refRows.length && reference_status === "ok") reference_status = "unavailable: no reference rows";
  const rh = (body as { region_hint?: { admin1?: string; country?: string; continent?: string } }).region_hint || {};
  const extRefs = Prompt.rankReferences({ ...(body.record || {}) }, refRows, patterns, { k: 5, region: rh, category: body.kind, hintNames: ((body as { rules_top?: string[] }).rules_top || []).slice(0, 3).map(String) }).map(Prompt.refBrief);
  // REGION PRIORS (data/learn/priors.json, context only) and FEEDBACK HISTORY (type_accuracy: how often the owner agreed with past suggestions of each type)
  let priorsText = "", historyText = "", hist: Record<string, { n: number; agree: number }> = {};
  try { const pr = await (await fetch(SITE + "data/learn/priors.json")).json(); priorsText = Matching.priorsText(Matching.priorsFor(pr, rh)); } catch { /* optional */ }
  try { const { data: acc } = await sb.rpc("type_accuracy"); (acc || []).forEach((a: { candidate_type: string; matches: number; close: number; total: number }) => { const k = String(a.candidate_type || "").toLowerCase().split(/[\s(\/]/)[0]; if (!k) return; const h = hist[k] || { n: 0, agree: 0 }; const tot = h.n + Number(a.total), ag = (h.agree * h.n + Number(a.matches) + 0.5 * Number(a.close)) / (tot || 1); hist[k] = { n: tot, agree: ag }; });
    const lines = Object.entries(hist).filter(([, h]) => h.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, h]) => `${k}: owners agreed ${Math.round(h.agree * 100)}% of ${h.n} times`);
    if (lines.length) historyText = "PAST FEEDBACK ON SUGGESTIONS (aggregate, anonymous; a low rate means be more cautious with that type):\n" + lines.join("\n"); } catch { /* optional */ }
  const context = { attrs_text: Matching.attrsText(attrs, body.kind), priors_text: priorsText, history_text: historyText, external_references: extRefs, reference_status, kind: body.kind, record: body.record, region: target.region, region_check: body.region_check ?? null, /* rule-based out-of-area hints + owner provenance; owner provenance wins */ reference_types: (Array.isArray(body.kb) ? body.kb : []).slice(0, 8), /* rules-engine top candidates only (never the full list) */ checklist_features: body.checklist, similar_verified_examples: similar };
  const content: unknown[] = [{ type: "text", text: Prompt.buildUserText(context, photos.length) }];
  // image detail policy (cost control): the first 2 photos high detail, the rest low; reference images always low
  photos.forEach((p, i) => { content.push({ type: "text", text: `photo_index ${i}: ${p.label || "photo"}` }); content.push({ type: "image_url", image_url: { url: p.url, detail: Matching.detailFor(i) } }); });
  const refContent: unknown[] = [];
  similar.filter(x => x.photo && /^https:\/\//.test(x.photo)).slice(0, 2).forEach(x => { refContent.push({ type: "text", text: `REFERENCE (not the find; do not mark): ${x.catalog_id}, verified as ${x.confirmed_type}` }); refContent.push({ type: "image_url", image_url: { url: x.photo, detail: "low" } }); });
  // reference media (migration 019/025): credited public-domain / open-license photos of the types being compared, plus natural look-alikes when the owner says there are no flake scars. Retrieval by type name/tag before the call.
  const mediaUsed: { id: string; title: string; license: string; source_url: string }[] = [];
  try { const names = [...(body.rules_top || []), ...["suggestion_1", "suggestion_2", "suggestion_3", "object_type"].map(k => String((body.record || {})[k] || ""))].map(x => String(x).toLowerCase()).filter(Boolean);
    if (body.kind === "artifact" && /no flake scars|hidden by|rough and pebbly|caliche|cobble/i.test(JSON.stringify(attrs))) names.push("natural rock");
    if (names.length) { const { data: mm } = await sb.rpc("similar_reference_media", { p_names: names.slice(0, 8), p_kind: body.kind === "rock" ? "mineral" : body.kind, p_limit: 3 });
      (mm || []).filter((m: { thumb_url?: string }) => /^https:\/\//.test(m.thumb_url || "")).slice(0, 2).forEach((m: { id: string; title: string; thumb_url: string; license: string; source_url: string; attribution?: string }) => { refContent.push({ type: "text", text: `REFERENCE IMAGE (not the find; do not mark): ${String(m.title).slice(0, 80)} (${m.license}). Use it only to compare features.` }); refContent.push({ type: "image_url", image_url: { url: m.thumb_url, detail: "low" } }); mediaUsed.push({ id: m.id, title: String(m.title).slice(0, 120), license: m.license, source_url: m.source_url }); }); } } catch { /* optional */ }

  const base = (Deno.env.get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = Deno.env.get("AI_MODEL") || "gpt-4o-mini";
  const call = (withRefs: boolean) => fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, ...(/^(gpt-[56]|o\d)/.test(model) ? { max_completion_tokens: 6000 } : { temperature: 0.2, max_tokens: 2500 }) /* reasoning models reject temperature/max_tokens */, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: withRefs ? [...content, ...refContent] : content }] }) });
  let r: Response, usedRefs = refContent.length > 0;
  try { r = await call(usedRefs);
    // a hot-linked reference image the provider cannot fetch makes it answer 400; retry once without reference images (never without the owner's photos)
    if (r.status === 400 && usedRefs) { usedRefs = false; r = await call(false); } }
  catch { await refund(); return json({ error: "The AI service couldn't be reached. Please try again later.", code: "ai_unavailable" }, 503); }
  if (!r.ok) { // provider problems are never reported as a plan/gate refusal, and do not use up the daily allowance
    let pe: { error?: { code?: string; type?: string } } = {}; try { pe = await r.json(); } catch { /* not JSON */ }
    const pc = String(pe.error?.code || pe.error?.type || "");
    await refund();
    if (r.status === 402 || /insufficient_quota|billing|credit/i.test(pc)) return json({ error: "AI photo analysis is unavailable right now (the AI account is out of credits). Your find is saved; try again later.", code: "ai_no_credits", provider_status: r.status }, 503);
    if (r.status === 401 || r.status === 403) return json({ error: "AI photo analysis is unavailable right now (AI service configuration).", code: "ai_unavailable", provider_status: r.status }, 503);
    if (r.status === 429) return json({ error: "The AI service is busy. Please try again in a minute.", code: "ai_busy", provider_status: r.status }, 503);
    return json({ error: `AI photo analysis is unavailable right now (provider error ${r.status}).`, code: "ai_unavailable", provider_status: r.status }, 502); }
  const out = await r.json();
  let res: Result;
  try { res = JSON.parse(out.choices?.[0]?.message?.content || "{}"); } catch { await refund(); return json({ error: "The AI returned an unreadable answer. Please try again.", code: "ai_unavailable" }, 502); }
  // sanitize: clamp coords, cap confidence, enforce caveat
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  res.candidates = Score.clampCandidates(res.candidates); // 0-100, AI ceiling 95 (config), factors sanitized; .confidence keeps the old band label
  Object.assign(res, Matching.extras(res, photos.length)); // artifact_likelihood, diagnostic_checklist, photo_quality (sanitized, no coordinates)
  const cal = Matching.calibrate(res, { nPhotos: photos.length, history: hist }); res.candidates = cal.candidates; (res as { calibration_notes?: string[] }).calibration_notes = cal.notes; // never raises a percentage
  (res as { reference_images_used?: unknown[] }).reference_images_used = usedRefs ? mediaUsed : [];
  res.external_references_used = extRefs.map((x: { id: string; name: string; source: string }) => ({ id: x.id, name: x.name, source: x.source })); res.reference_status = reference_status;
  res.marks = (res.marks || []).filter(m => Number.isInteger(m.photo_index) && m.photo_index >= 0 && m.photo_index < photos.length)
    .map(m => ({ photo_index: m.photo_index, marks: (m.marks || []).slice(0, 8).filter(k => ["arrow", "circle", "line", "measure", "box"].includes(k.type)).map(k => ({ ...k, coords: (k.coords || []).slice(0, k.type === "circle" ? 3 : 4).map(clamp), label: String(k.label || "").slice(0, 80), explanation: String(k.explanation || "").slice(0, 500) })) }));
  res.gaps = (res.gaps || []).slice(0, 8).map(String);
  res.next_photos = (res.next_photos || []).slice(0, 4).map(x => String(x).slice(0, 200));
  res.alternatives = (res.alternatives || []).slice(0, 4).map(x => String(x).slice(0, 80));
  const mm = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : null; };
  const m = res.measurements || {}; res.measurements = m.scale_visible ? { scale_visible: true, length_mm: mm(m.length_mm), width_mm: mm(m.width_mm), thickness_mm: mm(m.thickness_mm), note: String(m.note || "").slice(0, 300) } : { scale_visible: false, length_mm: null, width_mm: null, thickness_mm: null, note: "No usable scale visible." };
  res.similar_used = similar.map(x => ({ catalog_id: x.catalog_id, confirmed_type: x.confirmed_type, why: x.why_similar }));
  res.caveat = "AI-generated research possibilities with an evidence-based confidence score (AI alone is capped at 95%), not an identification. No authenticity or value claims. Review every mark before saving.";
  try { await sb.from("ai_cache").upsert({ user_id: user.id, cache_key: cacheKey, result: res, model, created_at: new Date().toISOString() }); } catch { /* cache is best effort */ }
  return json({ ok: true, catalog_id: body.catalog_id, model, result: res, cached: false, prompt_version: Matching.VERSION, usage: out.usage ? { prompt_tokens: out.usage.prompt_tokens, completion_tokens: out.usage.completion_tokens } : null });
});
