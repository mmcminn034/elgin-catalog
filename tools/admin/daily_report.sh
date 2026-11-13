#!/bin/bash
# UnEarthed Finds: owner-only daily report (previous day, America/Chicago). Prints concise text to stdout.
# Usage: daily_report.sh [YYYY-MM-DD]   (default: yesterday in America/Chicago)
# Emails appear only in this owner report. Reads the service key from /workspace/.svc; never prints it.
set -euo pipefail
set -a; source /workspace/.svc; set +a
SB="https://qqllbazrwfebpnqhdwox.supabase.co"
DAY="${1:-}"; BODY='{}'; [ -n "$DAY" ] && BODY="{\"p_day\":\"$DAY\"}"
JSON=$(curl -sf -X POST "$SB/rest/v1/rpc/report_daily" -H "apikey: $SVC_KEY" -H "Authorization: Bearer $SVC_KEY" -H "Content-Type: application/json" -d "$BODY") || { echo "UnEarthed Finds daily report: could not reach the database"; exit 1; }
REPORT_JSON="$JSON" SB="$SB" python3 - <<'PY'
import json, os, urllib.request, urllib.error, urllib.parse, collections, datetime, zoneinfo
r = json.loads(os.environ["REPORT_JSON"]); L = []
def traffic(day):
    """Yesterday's site traffic (migration 028 page views in analytics_events). report_traffic() once 028 is applied;
    otherwise the same numbers straight from the table. Returns None if traffic logging isn't switched on yet."""
    sb, k = os.environ["SB"], os.environ["SVC_KEY"]; h = {"apikey": k, "Authorization": "Bearer " + k, "Content-Type": "application/json"}
    try: return json.loads(urllib.request.urlopen(urllib.request.Request(sb + "/rest/v1/rpc/report_traffic", data=json.dumps({"p_day": day}).encode(), headers=h), timeout=20).read())
    except urllib.error.HTTPError as e:
        if e.code != 404: return {"error": e.code}
    tz = zoneinfo.ZoneInfo("America/Chicago"); d = datetime.date.fromisoformat(day)
    a = datetime.datetime.combine(d, datetime.time(), tz).astimezone(datetime.timezone.utc).isoformat(); b = datetime.datetime.combine(d + datetime.timedelta(days=1), datetime.time(), tz).astimezone(datetime.timezone.utc).isoformat()
    q = f"/rest/v1/analytics_events?select=ref,meta&kind=eq.pageview&created_at=gte.{urllib.parse.quote(a)}&created_at=lt.{urllib.parse.quote(b)}&limit=50000"
    try: rows = json.loads(urllib.request.urlopen(urllib.request.Request(sb + q, headers=h), timeout=20).read())
    except Exception: return {"error": "read"}
    refs = collections.Counter(x["meta"].get("r") for x in rows if x["meta"].get("r")); pages = collections.Counter(x["ref"] for x in rows)
    return {"visits": len(rows), "visitors": len({x["meta"].get("v") for x in rows}), "pending_028": True,
            "top_referrers": [{"domain": k2, "visits": n} for k2, n in refs.most_common(1)], "top_pages": [{"path": k2, "views": n} for k2, n in pages.most_common(1)]}
L.append(f"UnEarthed Finds daily report: {r['day']} (America/Chicago)")
s = r["signups"]; L.append(f"Signups: {len(s)} (total accounts {r['users_total']})")
L += [f"  - {x['email']} ({x.get('plan') or 'free'})" for x in s]
L.append(f"Finds added: {r['finds']} ({r['finds_public']} public, {r['finds'] - r['finds_public']} private). Totals: {r['finds_total']} finds, {r['public_total']} public / {r['private_total']} private")
vc = r["vis_changes"]; L.append(f"Public/private changes: {len(vc)}" + (": " + ", ".join(f"{v['ref']} {v['from']}→{v['to']}" for v in vc[:8]) if vc else ""))
L.append(f"AI identifications: {r['ai']} by {r['ai_users']} user(s)")
L.append(f"Expert questions: {r['questions']}")
if r["grants"]: L.append("Plan grants: " + ", ".join(f"{g['email']} → {g['plan']}" for g in r["grants"]))
if r["deletions"]: L.append(f"Account deletions: {r['deletions']}")
L.append(f"App errors logged: {r['errors']}")
t = traffic(r["day"])
if t is None or "error" in t: L.append("Site traffic: unavailable")
elif t.get("pending_028") and not t["visits"]: L.append("Site traffic: not counting yet (database update 028 pending)")
else:
    tr, tp = (t.get("top_referrers") or [{}])[0], (t.get("top_pages") or [{}])[0]
    L.append(f"Site traffic: {t['visits']} visits, {t['visitors']} unique visitors · top referrer {tr.get('domain') or 'none (direct)'}" + (f" ({tr['visits']})" if tr.get("visits") else "") + f" · top page {tp.get('path') or '—'}" + (f" ({tp['views']})" if tp.get("views") else ""))
A = []
if r["errors"] >= 10: A.append(f"{r['errors']} client errors")
if r["ai_max_user"] >= 20: A.append(f"one account used AI {r['ai_max_user']} times")
if len(s) >= 20: A.append(f"{len(s)} signups in one day")
if r["finds"] >= 200: A.append(f"{r['finds']} finds added in one day")
if sum(1 for v in vc if v["to"] == "public") >= 25: A.append("many items made public")
L.append("Anomalies: " + ("; ".join(A) if A else "none"))
L += [f"  error: {m}" for m in r["error_samples"][:3]]
print("\n".join(L))
PY
