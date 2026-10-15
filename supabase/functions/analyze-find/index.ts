// Supabase Edge Function: analyze-find
// Vision-model photo analysis for Rolling Oak Catalog (members only).
// Provider-agnostic: any OpenAI-compatible /chat/completions endpoint that accepts image_url content.
// Env: AI_API_KEY (required), AI_BASE_URL (default https://api.openai.com/v1), AI_MODEL (default gpt-4o-mini),
//      SUPABASE_URL / SUPABASE_ANON_KEY (provided automatically by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import "../_shared/retrieve.js"; // sets globalThis.Retrieve (same code as assets/js/retrieve.js)
import "../_shared/prompt.js"; // globalThis.Prompt: region-neutral SYSTEM prompt, external-reference retrieval, user text builder
import "../_shared/score.js"; // globalThis.Score: 0-100 clamp (AI ceiling 95), factors
// deno-lint-ignore no-explicit-any
const Retrieve = (globalThis as any).Retrieve as { rankSimilar: (t: unknown, ex: unknown[], o?: unknown) => { example: Record<string, any>; score: number; why: string[] }[] };
// deno-lint-ignore no-explicit-any
const Prompt = (globalThis as any).Prompt; // deno-lint-ignore no-explicit-any
const Score = (globalThis as any).Score;
import "../_shared/ai_schema.js"; // sets globalThis.AiSchema (Stage 3 classification/origin clamp; tests/ai_schema_test.js)
// deno-lint-ignore no-explicit-any
const AiSchema = (globalThis as any).AiSchema as { clampClassification: (r: unknown) => { classification: unknown; origin: unknown[] } };
const SITE = (Deno.env.get("SITE_URL") || "https://mmcminn034.github.io/elgin-catalog/").replace(/\/?$/, "/");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Mark = { type: "arrow" | "circle" | "line" | "measure" | "box"; coords: number[]; label: string; explanation: string; links_to?: { kind: "candidate" | "feature" | "date"; ref: string } };
type Result = { candidates: { name: string; type_id?: string; confidence?: string; confidence_pct?: number; factors?: { sign: string; reason: string; source: string | null }[]; reference_ids?: string[]; why: string; why_not: string }[]; external_references_used?: unknown[]; reference_status?: string; alternatives?: string[]; marks: { photo_index: number; marks: Mark[] }[];
  measurements?: { length_mm?: number | null; width_mm?: number | null; thickness_mm?: number | null; scale_visible?: boolean; note?: string }; next_photos?: string[]; gaps: string[]; caveat: string; similar_used?: { catalog_id: string; confirmed_type: string; why: string[] }[] };

const SYSTEM: string = Prompt.SYSTEM; // full text in supabase/functions/_shared/prompt.js (also shown in the app's 'View AI prompt')

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("AI_API_KEY"); if (!key) return json({ error: "AI_API_KEY not configured" }, 503);
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sb.auth.getUser(); if (!user) return json({ error: "Sign in required" }, 401);
  const { data: prof } = await sb.from("profiles").select("membership, membership_expires").eq("id", user.id).single();
  const active = prof?.membership === "member" && (!prof.membership_expires || new Date(prof.membership_expires) > new Date());
  if (!active) return json({ error: "Supporter membership required for AI photo analysis" }, 402);

  let body: { catalog_id: string; kind: string; photos: { url: string; label?: string }[]; record?: Record<string, unknown>; kb?: unknown; checklist?: string[]; examples?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const photos = (body.photos || []).filter(p => /^https:\/\//.test(p.url)).slice(0, 6);
  if (!photos.length) return json({ error: "No https photo URLs" }, 400);
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
  try { const pj = await (await fetch(SITE + "data/reference/public-types.json")).json(); patterns = pj.meta?.trait_patterns || {}; refRows = pj.types || [];
    const { data: rt, error: re } = await sb.from("reference_types").select("id, name, aliases, typology_system, category, period, dates, continent, country, admin1, length_mm, width_mm, thickness_mm, traits, similar_types, sources").limit(5000);
    if (!re && rt && rt.length) refRows = rt.map((x: Record<string, unknown>) => ({ ...x, similar: x.similar_types })); } catch (e) { reference_status = "unavailable: " + String(e).slice(0, 80); }
  if (!refRows.length && reference_status === "ok") reference_status = "unavailable: no reference rows";
  const rh = (body as { region_hint?: { admin1?: string; country?: string; continent?: string } }).region_hint || {};
  const extRefs = Prompt.rankReferences({ ...(body.record || {}) }, refRows, patterns, { k: 5, region: rh, category: body.kind, hintNames: ((body as { rules_top?: string[] }).rules_top || []).slice(0, 3).map(String) }).map(Prompt.refBrief);
  const context = { external_references: extRefs, reference_status, kind: body.kind, record: body.record, region: target.region, region_check: body.region_check ?? null, /* rule-based out-of-area hints + owner provenance; owner provenance wins */ reference_types: body.kb, checklist_features: body.checklist, similar_verified_examples: similar };
  const content: unknown[] = [{ type: "text", text: Prompt.buildUserText(context, photos.length) }];
  photos.forEach((p, i) => { content.push({ type: "text", text: `photo_index ${i}: ${p.label || "photo"}` }); content.push({ type: "image_url", image_url: { url: p.url } }); });
  similar.filter(x => x.photo && /^https:\/\//.test(x.photo)).forEach(x => { content.push({ type: "text", text: `REFERENCE (not the find; do not mark): ${x.catalog_id}, verified as ${x.confirmed_type}` }); content.push({ type: "image_url", image_url: { url: x.photo } }); });

  const base = (Deno.env.get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] }) });
  if (!r.ok) return json({ error: `AI provider error ${r.status}` }, 502);
  const out = await r.json();
  let res: Result;
  try { res = JSON.parse(out.choices?.[0]?.message?.content || "{}"); } catch { return json({ error: "Model did not return JSON" }, 502); }
  // sanitize: clamp coords, cap confidence, enforce caveat
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  res.candidates = Score.clampCandidates(res.candidates); // 0-100, AI ceiling 95 (config), factors sanitized; .confidence keeps the old band label
  res.external_references_used = extRefs.map((x: { id: string; name: string; source: string }) => ({ id: x.id, name: x.name, source: x.source })); res.reference_status = reference_status;
  res.marks = (res.marks || []).filter(m => Number.isInteger(m.photo_index) && m.photo_index >= 0 && m.photo_index < photos.length)
    .map(m => ({ photo_index: m.photo_index, marks: (m.marks || []).slice(0, 8).filter(k => ["arrow", "circle", "line", "measure", "box"].includes(k.type)).map(k => ({ ...k, coords: (k.coords || []).slice(0, k.type === "circle" ? 3 : 4).map(clamp), label: String(k.label || "").slice(0, 80), explanation: String(k.explanation || "").slice(0, 500) })) }));
  res.gaps = (res.gaps || []).slice(0, 8).map(String);
  res.next_photos = (res.next_photos || []).slice(0, 4).map(x => String(x).slice(0, 200));
  res.alternatives = (res.alternatives || []).slice(0, 4).map(x => String(x).slice(0, 80));
  const mm = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : null; };
  const m = res.measurements || {}; res.measurements = m.scale_visible ? { scale_visible: true, length_mm: mm(m.length_mm), width_mm: mm(m.width_mm), thickness_mm: mm(m.thickness_mm), note: String(m.note || "").slice(0, 300) } : { scale_visible: false, length_mm: null, width_mm: null, thickness_mm: null, note: "No usable scale visible." };
  res.similar_used = similar.map(x => ({ catalog_id: x.catalog_id, confirmed_type: x.confirmed_type, why: x.why_similar }));
  // Stage 3: classification + origin, clamped server-side (0-100%, AI ceiling 95; coordinates/addresses dropped)
  const cl = AiSchema.clampClassification(res); res.classification = cl.classification; res.origin = cl.origin;
  res.caveat = "AI-generated research possibilities with an evidence-based confidence score (AI alone is capped at 95%), not an identification. No authenticity or value claims. Review every mark before saving.";
  return json({ ok: true, catalog_id: body.catalog_id, model: Deno.env.get("AI_MODEL") || "gpt-4o-mini", result: res });
});
