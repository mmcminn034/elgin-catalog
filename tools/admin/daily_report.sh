#!/bin/bash
# UnEarthed Finds: owner-only daily report (previous day, America/Chicago). Prints concise text to stdout.
# Usage: daily_report.sh [YYYY-MM-DD]   (default: yesterday in America/Chicago)
# Emails appear only in this owner report. Reads the service key from /workspace/.svc; never prints it.
set -euo pipefail
set -a; source /workspace/.svc; set +a
SB="https://qqllbazrwfebpnqhdwox.supabase.co"
DAY="${1:-}"; BODY='{}'; [ -n "$DAY" ] && BODY="{\"p_day\":\"$DAY\"}"
JSON=$(curl -sf -X POST "$SB/rest/v1/rpc/report_daily" -H "apikey: $SVC_KEY" -H "Authorization: Bearer $SVC_KEY" -H "Content-Type: application/json" -d "$BODY") || { echo "UnEarthed Finds daily report: could not reach the database"; exit 1; }
REPORT_JSON="$JSON" python3 - <<'PY'
import json, os
r = json.loads(os.environ["REPORT_JSON"]); L = []
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
