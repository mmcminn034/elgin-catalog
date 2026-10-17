// PGlite test for migration 012 (local only; never touches production).
// Usage: node tests/sql/membership_v1_test.mjs   (needs /tmp/pgl harness: stubs.sql + apply.mjs; npm i @electric-sql/pglite)
import { build } from "/tmp/pgl/apply.mjs";
import fs from "fs";
const M = new URL("../../supabase/migrations/", import.meta.url).pathname;
const db = await build([M + "012_membership_v1.sql"]);
process.on("unhandledRejection", e => { console.log("FATAL:", e.message, e.query || ""); process.exit(2); });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const OWNER = "a4779d71-ff10-4c11-864d-c79f83214b00", FREE = "11111111-1111-1111-1111-111111111111", ANN = "22222222-2222-2222-2222-222222222222", EXP = "33333333-3333-3333-3333-333333333333", OTHER = "44444444-4444-4444-4444-444444444444";
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false), set_config('request.jwt.claim.role', '${role}', false), set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, email: uid ? uid.slice(0, 4) + "@x.test" : null, role })}', false); set role ${role};`); };
const su = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false);`); };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const err = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };

await su();
for (const [id, e] of [[OWNER, "mark@x.test"], [FREE, "free@x.test"], [ANN, "ann@x.test"], [EXP, "exp@x.test"], [OTHER, "other@x.test"]]) await q(`insert into auth.users (id, email) values ($1, $2)`, [id, e]);
// legacy row checks
const cnt = await q(`select count(*)::int n from public.profiles`); ok(cnt[0].n === 5, "profiles auto-created for new users");
await q(`update public.profiles set membership='lifetime' where id=$1`, [OWNER]);   // migration already did this if the owner existed; users created after
console.log("\n[plans]");
const plans = await q(`select id, price_cents, billing_interval from public.plans where active order by sort`);
ok(JSON.stringify(plans.map(p => p.id)) === '["free","annual","lifetime"]', "plans are free/annual/lifetime (no monthly, old member removed)");
ok(plans[1].price_cents === 2999 && plans[1].billing_interval === "year" && plans[2].price_cents === 5999 && plans[2].billing_interval === "once", "Annual $29.99/yr, Lifetime $59.99 once");
ok((await err(`update public.profiles set membership='member' where id=$1`, [FREE])) !== null, "legacy 'member' value rejected by constraint");
ok((await q(`select public.plan_of($1) p`, [OWNER]))[0].p === "lifetime", "owner is always Lifetime");
await q(`update public.profiles set membership='free', is_admin=false where id=$1`, [OWNER]);
ok((await q(`select public.plan_of($1) p, public.is_admin($1) a`, [OWNER]))[0].p === "lifetime", "owner stays Lifetime/admin even if the row says free (config owner)");

console.log("\n[admin grant]");
await as(FREE); ok(/admin only/.test(await err(`select public.admin_grant_plan($1,'lifetime')`, [FREE]) || ""), "non-admin cannot grant plans");
ok((await err(`update public.profiles set membership='lifetime' where id=$1`, [FREE])) !== null || (await q(`select membership from public.profiles where id=$1`, [FREE]))[0].membership === "free", "user cannot self-upgrade membership column");
ok((await err(`update public.profiles set is_admin=true where id=$1`, [FREE])) !== null, "user cannot set is_admin");
await as(OWNER); await q(`select public.admin_grant_plan($1,'annual', now() + interval '1 year', 'test')`, [ANN]);
ok((await q(`select public.plan_of($1) p`, [ANN]))[0].p === "annual", "admin granted Annual");
ok((await q(`select count(*)::int n from public.plan_grants`))[0].n === 1, "grant logged");
ok((await q(`select id from public.admin_find_user('ANN@x.test')`)).length === 1, "admin can look up a user by email");
await as(FREE); ok((await q(`select id from public.admin_find_user('ann@x.test')`)).length === 0, "non-admin lookup returns nothing");

console.log("\n[private gate: free]");
await as(FREE);
for (let i = 1; i <= 5; i++) await q(`insert into public.finds (catalog_id, owner, visibility) values ($1, $2, 'private')`, ["FRE-00" + i, FREE]);
ok((await q(`select public.private_count($1) n`, [FREE]))[0].n === 5, "free user saved 5 private items");
ok(/free_private_limit/.test(await err(`insert into public.finds (catalog_id, owner, visibility) values ('FRE-006', $1, 'private')`, [FREE]) || ""), "6th private item is refused by the server");
ok((await err(`insert into public.finds (catalog_id, owner, visibility) values ('FRE-006', $1, 'public')`, [FREE])) === null, "6th item can be created public");
{ const e = await err(`insert into public.finds (catalog_id, owner, visibility, is_public) values ('FRE-007', $1, null, false)`, [FREE]); ok(/free_private_limit/.test(e || ""), "legacy is_public=false path is gated too"); }
ok(/toggle_locked/.test(await err(`update public.finds set visibility='private' where catalog_id='FRE-006'`) || ""), "free user cannot switch public back to private");
ok(/toggle_locked/.test(await err(`update public.finds set is_public=false where catalog_id='FRE-006'`) || ""), "...nor via is_public=false");
ok((await err(`update public.finds set visibility='public' where catalog_id='FRE-001'`)) === null, "free user can make a private item public");
ok(/free_private_limit|toggle_locked/.test(await err(`update public.finds set visibility='private' where catalog_id='FRE-001'`) || ""), "...but not back again");

console.log("\n[public UF ids]");
const f1 = (await q(`select public_id from public.finds where catalog_id='FRE-001'`))[0].public_id, f2 = (await q(`select public_id from public.finds where catalog_id='FRE-002'`))[0].public_id;
ok(/^UF-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(f1), "public item got a UF id: " + f1);
ok(f2 === null, "private item has no public id");
await as(null, "anon");
ok((await q(`select * from public.public_find($1)`, [f1])).length === 1, "anon can open a public item by UF id");
ok((await q(`select catalog_id from public.finds where catalog_id='FRE-002'`)).length === 0, "anon cannot read a private item");
ok((await q(`select * from public.public_ids where ref='FRE-002'`)).length === 0, "no public id row is visible for a private item");
ok((await q(`select public.public_id_for('FRE-001') u`))[0].u === f1 && (await q(`select public.public_id_for('FRE-002') u`))[0].u === null, "legacy id -> UF redirect works only for public items");
const pf = (await q(`select * from public.public_find($1)`, [f1]))[0];
ok(!("catalog_id" in pf) && !Object.keys(pf).some(k => /lat|lon|location|owner/.test(k)), "public_find exposes no internal id, owner or location fields");
// member: make public -> private -> public reuses the same UF id
await as(ANN); await q(`insert into public.finds (catalog_id, owner, visibility) values ('ANN-001', $1, 'public')`, [ANN]);
const a1 = (await q(`select public_id from public.finds where catalog_id='ANN-001'`))[0].public_id;
await q(`update public.finds set visibility='private' where catalog_id='ANN-001'`);
ok((await q(`select public_id from public.finds where catalog_id='ANN-001'`))[0].public_id === null, "member toggled to private: public id hidden");
await as(null, "anon"); ok((await q(`select * from public.public_find($1)`, [a1])).length === 0, "old UF link stops resolving while private");
await as(ANN); await q(`update public.finds set visibility='public' where catalog_id='ANN-001'`);
ok((await q(`select public_id from public.finds where catalog_id='ANN-001'`))[0].public_id === a1, "made public again: same UF id is reused");
await as(FREE); await err(`update public.finds set public_id='UF-AAAA' where catalog_id='FRE-001'`); await err(`update public.finds set public_id='UF-BBBB' where catalog_id='FRE-002'`);
ok((await q(`select public_id from public.finds where catalog_id='FRE-001'`))[0].public_id === f1 && (await q(`select public_id from public.finds where catalog_id='FRE-002'`))[0].public_id === null, "users cannot write or forge public_id");
// many ids unique
await su(); const ids = (await q(`select public.gen_uf_id() u from generate_series(1,300)`)).map(r => r.u); ok(ids.every(u => /^UF-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(u)) && new Set(ids).size > 295, "gen_uf_id: short, random, non-sequential UF ids (" + ids.slice(0, 3).join(", ") + ")");
// catalogs
await as(ANN); await q(`insert into public.collections (slug, name, owner, visibility) values ('ann-a', 'Ann Private', $1, 'private'), ('ann-b', 'Ann Public', $1, 'public')`, [ANN]);
const cs = await q(`select name, public_id from public.collections where owner=$1 order by name`, [ANN]);
ok(cs[0].public_id === null && /^UF-/.test(cs[1].public_id), "catalog gets a UF id only when public");
ok((await err(`update public.collections set name='Renamed' where slug='ann-a'`)) === null, "owner can rename a catalog");
await q(`update public.finds set title='My best point' where catalog_id='ANN-001'`); ok((await q(`select title from public.finds where catalog_id='ANN-001'`))[0].title === "My best point", "custom find name stored (catalog_id unchanged)");

console.log("\n[exact locations]");
await as(FREE); await q(`insert into public.find_locations (catalog_id, owner, lat, lon) values ('FRE-001', $1, 30.1, -97.3)`, [FREE]).catch(e => console.log("    (find_locations insert:", e.message, ")"));
const rowsOr0 = async sql => { try { return (await q(sql)).length; } catch { return 0; } };
await as(null, "anon"); ok((await rowsOr0(`select * from public.find_locations`)) === 0, "anon never sees exact locations, even for public items");
await as(OTHER); ok((await rowsOr0(`select * from public.find_locations`)) === 0, "other users never see exact locations");

console.log("\n[lapse]");
await as(ANN); for (let i = 2; i <= 9; i++) await q(`insert into public.finds (catalog_id, owner, visibility, created_at) values ($1, $2, 'private', now() - make_interval(days => $3))`, ["ANN-00" + i, ANN, 100 - i]);
await q(`update public.finds set keep_private=true where catalog_id='ANN-009'`);   // user-chosen keeper (newest)
await su(); await q(`update public.profiles set membership_expires = now() - interval '1 day' where id=$1`, [ANN]);
ok((await q(`select public.plan_of($1) p`, [ANN]))[0].p === "free", "expired Annual is treated as Free for new gates");
await q(`select public.apply_membership_lapses()`);
ok((await q(`select count(*)::int n from public.membership_notices where user_id=$1 and kind='lapse_warning'`, [ANN]))[0].n === 1, "day 0: warning notice created, nothing changed yet");
ok((await q(`select public.private_count($1) n`, [ANN]))[0].n === 8, "still 8 private items during the grace period");
await q(`update public.profiles set lapse_notice_at = now() - interval '8 days' where id=$1`, [ANN]); await q(`select public.apply_membership_lapses()`);
const priv = (await q(`select catalog_id from public.finds where owner=$1 and visibility<>'public' order by catalog_id`, [ANN])).map(r => r.catalog_id);
ok(priv.length === 5 && priv.includes("ANN-009") && priv.includes("ANN-002") && !priv.includes("ANN-008"), "after grace: kept 5 (user-chosen first, then oldest): " + priv.join(","));
ok((await q(`select count(*)::int n from public.finds where owner=$1 and visibility='public' and public_id is null`, [ANN]))[0].n === 0, "items made public got UF ids");
await as(ANN); ok((await err(`select public.apply_membership_lapses()`)) !== null, "users cannot run the lapse job");

console.log("\n[AI daily cap]");
await su(); await q(`update public.app_config set value='3' where key='ai_daily_cap'`);
await as(FREE); const takes = []; for (let i = 0; i < 4; i++) takes.push((await q(`select public.ai_quota_take() r`))[0].r.allowed);
ok(JSON.stringify(takes) === "[true,true,true,false]", "per-account daily cap is configurable and enforced");
await as(null, "anon"); ok((await err(`select public.ai_quota_take()`)) !== null, "anon cannot use AI quota");

console.log("\n[merch]");
await as(FREE); ok((await err(`insert into public.products (name, price_cents) values ('Tee', 2500)`)) !== null, "non-admin cannot add products");
await as(OWNER); await q(`insert into public.products (name, price_cents, variants, active) values ('Field Tee', 2800, '[{"size":"M","color":"Clay"}]', true), ('Draft Hat', 2200, '[]', false)`);
await as(null, "anon"); ok((await q(`select name from public.products`)).length === 1, "anon sees active products only");

console.log("\n[experts]");
await as(EXP); await q(`insert into public.experts (user_id, name, credentials, specialties, links) values ($1, 'Dr. Exp', 'PhD', '{lithics}', '{https://x.test}')`, [EXP]);
ok((await err(`update public.experts set status='approved' where user_id=$1`, [EXP])) !== null || (await q(`select status from public.experts where user_id=$1`, [EXP]))[0].status === "pending", "applicant cannot self-approve");
await as(OTHER); ok((await q(`select * from public.experts`)).length === 0, "pending applications are not public");
await as(OWNER); await q(`insert into public.expert_invites (email) values ('invitee@x.test')`); await q(`select public.admin_decide_expert($1, 'approved')`, [EXP]);
await as(null, "anon"); ok((await q(`select name from public.experts`)).length === 1, "approved expert visible (verified badge)");
await su(); await q(`update public.app_config set value='3' where key='free_expert_questions_month'`);
await as(FREE); for (let i = 0; i < 3; i++) await q(`select public.ask_expert($1, 'FRE-002', '{"title":"Point","lat":30.1,"location":"secret"}')`, ["Is this a Clovis point? #" + i]);
ok(/expert_question_limit/.test(await err(`select public.ask_expert('One more question please')`) || ""), "free user limited to 3 questions/month");
ok((await q(`select context from public.expert_questions limit 1`))[0].context.lat === undefined, "question context strips location fields");
await as(OTHER); ok(/not your find/.test(await err(`select public.ask_expert('Whose is this find?', 'FRE-002')`) || ""), "cannot ask about someone else's private find");
ok((await q(`select * from public.expert_questions`)).length === 0, "other users cannot read questions");
await as(OWNER); for (let i = 0; i < 5; i++) await q(`select public.ask_expert($1)`, ["Member question number " + i]);
ok(true, "member (owner/Lifetime) asked 5 questions without a limit");
await as(EXP); const inbox = await q(`select id, priority from public.expert_questions where status='open' order by priority desc, created_at`);
ok(inbox.length === 8 && inbox[0].priority === 10, "expert inbox lists open questions with members first");
await q(`insert into public.expert_answers (question_id, body) values ($1, 'Looks like a Gary point.')`, [inbox[0].id]);
ok((await q(`select status from public.expert_questions where id=$1`, [inbox[0].id]))[0].status === "answered", "answer marks the question answered");
await as(OTHER); ok((await err(`insert into public.expert_answers (question_id, body) values ($1, 'spam')`, [inbox[1].id])) !== null, "non-experts cannot answer");

console.log("\n[down migration]");
await su(); try { await db.exec(fs.readFileSync(M + "012_membership_v1_down.sql", "utf8")); ok(true, "down script runs cleanly"); } catch (e) { ok(false, "down script: " + e.message); }
ok((await q(`select count(*)::int n from information_schema.tables where table_name in ('products','experts','app_config')`))[0].n === 0, "down removed new tables");
console.log("\n[upgrade path: existing data, then 012]");
{ const d2 = await build([]); await d2.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
  await d2.query(`insert into auth.users (id, email) values ($1, 'mark@x.test'), ($2, 'old@x.test')`, [OWNER, FREE]);
  await d2.query(`update public.profiles set membership='member' where id=$1`, [FREE]);
  let c = (await d2.query(`select id from public.collections where slug='rolling-oak'`)).rows[0]?.id;
  if (!c) c = (await d2.query(`insert into public.collections (slug, name, owner, visibility) values ('rolling-oak', 'Rolling Oak', $1, 'members') returning id`, [OWNER])).rows[0].id;
  else await d2.query(`update public.collections set owner=$1, name='Rolling Oak', visibility='members' where id=$2`, [OWNER, c]);
  for (let i = 1; i <= 6; i++) await d2.query(`insert into public.finds (catalog_id, owner, collection_id, visibility, show_on_discover) values ($1, $2, $3, $4, $5) on conflict (catalog_id) do update set owner=excluded.owner, collection_id=excluded.collection_id, visibility=excluded.visibility, show_on_discover=excluded.show_on_discover`, ["ELG-00" + i, OWNER, c, i <= 4 ? "public" : "private", i <= 2]);
  await d2.exec(fs.readFileSync(M + "012_membership_v1.sql", "utf8"));
  const r = (await d2.query(`select catalog_id, public_id from public.finds where catalog_id in ('ELG-001','ELG-002','ELG-003','ELG-004','ELG-005','ELG-006') order by 1`)).rows;
  ok(r.filter(x => x.public_id).map(x => x.catalog_id).join() === "ELG-001,ELG-002", "backfill: only finds public on the web today (on Discover) got UF ids; members-only and private got none: " + r.filter(x => x.public_id).map(x => x.catalog_id).join());
  await d2.exec(`select set_config('request.jwt.claim.role','anon',false); set role anon;`);
  const anonRows = (await d2.query(`select catalog_id from public.finds where catalog_id like 'ELG-00%' order by 1`)).rows.map(x => x.catalog_id);
  ok(anonRows.length === 0, "exposure unchanged: anon still reads no rows from finds directly (" + anonRows.join() + ")");
  ok((await d2.query(`select count(*)::int n from public.discover_finds`)).rows[0].n === 2, "Discover still shows exactly the Discover finds");
  ok((await d2.query(`select count(*)::int n from public.find_locations`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n === 0, "anon reads no locations");
  await d2.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false);`);
  await d2.query(`update public.collections set visibility='public' where id=$1`, [c]);
  ok((await d2.query(`select count(*)::int n from public.finds where catalog_id in ('ELG-003','ELG-004') and public_id is not null`)).rows[0].n === 2, "making the catalog public cascades UF ids to its public finds");
  await d2.query(`update public.collections set visibility='members' where id=$1`, [c]);
  ok((await d2.query(`select string_agg(catalog_id, ',' order by catalog_id) s from public.finds where catalog_id like 'ELG-00%' and public_id is not null`)).rows[0].s === "ELG-001,ELG-002", "back to members-only: only Discover finds keep UF ids");
  ok((await d2.query(`select name from public.collections where id=$1`, [c])).rows[0].name === "Rolling Oak", "Mark's catalog keeps the name 'Rolling Oak'");
  const p = (await d2.query(`select id, membership, is_admin from public.profiles order by membership`)).rows;
  ok(p.find(x => x.id === OWNER).membership === "lifetime" && p.find(x => x.id === OWNER).is_admin, "owner profile set to Lifetime + admin");
  ok(p.find(x => x.id === FREE).membership === "annual", "legacy 'member' supporters mapped to Annual");
  ok(r.every(x => /^ELG-/.test(x.catalog_id)), "ELG internal ids unchanged");
  await d2.exec(fs.readFileSync(M + "012_membership_v1.sql", "utf8")); ok(true, "012 is re-runnable (idempotent)"); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
