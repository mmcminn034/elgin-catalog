// Supabase Edge Function: analyze-find
// Vision-model photo analysis for Rolling Oak Catalog (members only).
// Provider-agnostic: any OpenAI-compatible /chat/completions endpoint that accepts image_url content.
// Env: AI_API_KEY (required), AI_BASE_URL (default https://api.openai.com/v1), AI_MODEL (default gpt-4o-mini),
//      SUPABASE_URL / SUPABASE_ANON_KEY (provided automatically by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Mark = { type: "arrow" | "circle" | "line" | "measure" | "box"; coords: number[]; label: string; explanation: string; links_to?: { kind: "candidate" | "feature" | "date"; ref: string } };
type Result = { candidates: { name: string; type_id?: string; confidence: "Low" | "Low-moderate" | "Moderate"; why: string; why_not: string }[]; marks: { photo_index: number; marks: Mark[] }[]; gaps: string[]; caveat: string };

const SYSTEM = `You assist an amateur collector documenting Central Texas surface finds (artifacts, fossils, rocks/minerals).
Rules: give RESEARCH POSSIBILITIES, never definitive identifications; never claim authenticity or monetary value; confidence at most "Moderate".
Only describe and mark features you can actually see in the photos. If a feature is not visible, say so in "gaps".
Return ONLY JSON matching:
{"candidates":[{"name":str,"type_id":str|null,"confidence":"Low"|"Low-moderate"|"Moderate","why":str,"why_not":str}],
 "marks":[{"photo_index":int,"marks":[{"type":"arrow"|"circle"|"line"|"measure"|"box","coords":[...],"label":str,"explanation":str,"links_to":{"kind":"candidate"|"feature"|"date","ref":str}}]}],
 "gaps":[str],"caveat":str}
Coordinates are normalized 0-1 relative to each image (x by width, y by height). arrow/line/measure/box: [x1,y1,x2,y2]; circle: [cx,cy,r] with r as a fraction of width.
Use at most 3 candidates and at most 8 marks per photo. For "feature" links use the exact checklist names provided.`;

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
  const { data: ex } = await sb.from("verified_examples").select("catalog_id, confirmed_type, features, length_mm").eq("category", body.kind).limit(40);

  const context = { kind: body.kind, record: body.record, reference_types: body.kb, checklist_features: body.checklist, verified_examples: ex || body.examples || [] };
  const content: unknown[] = [{ type: "text", text: "Context (reference knowledge base, owner's notes, verified examples):\n" + JSON.stringify(context).slice(0, 60000) + `\nPhotos follow in order (photo_index 0..${photos.length - 1}).` }];
  photos.forEach((p, i) => { content.push({ type: "text", text: `photo_index ${i}: ${p.label || "photo"}` }); content.push({ type: "image_url", image_url: { url: p.url } }); });

  const base = (Deno.env.get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] }) });
  if (!r.ok) return json({ error: `AI provider error ${r.status}` }, 502);
  const out = await r.json();
  let res: Result;
  try { res = JSON.parse(out.choices?.[0]?.message?.content || "{}"); } catch { return json({ error: "Model did not return JSON" }, 502); }
  // sanitize: clamp coords, cap confidence, enforce caveat
  const clamp = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  const cap = (c: string) => (["Low", "Low-moderate", "Moderate"].includes(c) ? c : "Low") as Result["candidates"][0]["confidence"];
  res.candidates = (res.candidates || []).slice(0, 3).map(c => ({ ...c, confidence: cap(c.confidence) }));
  res.marks = (res.marks || []).filter(m => Number.isInteger(m.photo_index) && m.photo_index >= 0 && m.photo_index < photos.length)
    .map(m => ({ photo_index: m.photo_index, marks: (m.marks || []).slice(0, 8).filter(k => ["arrow", "circle", "line", "measure", "box"].includes(k.type)).map(k => ({ ...k, coords: (k.coords || []).slice(0, k.type === "circle" ? 3 : 4).map(clamp), label: String(k.label || "").slice(0, 80), explanation: String(k.explanation || "").slice(0, 500) })) }));
  res.gaps = (res.gaps || []).slice(0, 8);
  res.caveat = "AI-generated research possibilities from photos, not an identification. No authenticity or value claims. Review every mark before saving.";
  return json({ ok: true, catalog_id: body.catalog_id, model: Deno.env.get("AI_MODEL") || "gpt-4o-mini", result: res });
});
