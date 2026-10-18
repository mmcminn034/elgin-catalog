"""Delete my account (edge function delete-account) on a THROWAWAY account only. Also: owner account protected in the DB.
Usage: SVC_KEY=... python3 tests/account_delete_regress.py https://unearthedfinds.com/"""
import json, os, re, sys, secrets, urllib.request, urllib.error
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"
cfg = urllib.request.urlopen(U + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1); SVC = os.environ["SVC_KEY"]
fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
def call(method, path, body=None, tok=None, key=ANON, extra=None, raw=None):
    h = {"apikey": key, "Authorization": "Bearer " + (tok or key), "Content-Type": "application/json", "Prefer": "return=representation"}; h.update(extra or {})
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(SB + path, data=data, headers=h, method=method)
    try: x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t.decode()[:200]
email = f"del-test-{secrets.token_hex(3)}@unearthedfinds.test"; pw = secrets.token_urlsafe(16)
s, u = call("POST", "/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True}, key=SVC); UID = u["id"]; chk("throwaway account created", s == 200)
try:
    TOK = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})[1]["access_token"]
    s, cols = call("GET", "/rest/v1/collections?select=id,name", tok=TOK); cid = cols[0]["id"]
    s, f = call("POST", "/rest/v1/finds", {"owner": UID, "collection_id": cid, "object_type": "Test pebble", "category": "rock", "visibility": "private", "is_public": False}, tok=TOK); chk("test find created", s == 201, (s, f)); fid = f[0]["catalog_id"]
    s, _ = call("POST", f"/storage/v1/object/find-photos-private/{UID}/{fid}/01.jpg", raw=b"\xff\xd8\xff\xd9", tok=TOK, extra={"Content-Type": "image/jpeg"}); chk("test photo uploaded", s == 200, s)
    call("POST", "/rest/v1/photos", {"catalog_id": fid, "owner": UID, "sort": 0, "storage_path": f"{UID}/{fid}/01.jpg", "is_public": False}, tok=TOK)
    s, _ = call("POST", "/rest/v1/find_locations", {"catalog_id": fid, "owner": UID, "lat": 30.1, "lon": -97.4}, tok=TOK); chk("test exact location stored (owner-only)", s == 201, s)
    s, b = call("GET", f"/rest/v1/find_locations?catalog_id=eq.{fid}", tok=None); chk("anon can't read it", s >= 400 or b == [], s)
    s, b = call("POST", "/functions/v1/delete-account", {}, tok=TOK); chk("refused without typing DELETE", s == 400 and b.get("code") == "confirm_required", (s, b))
    s, b = call("POST", "/functions/v1/delete-account", {"confirm": "DELETE"}, tok=None); chk("refused signed out", s == 401, s)
    s, b = call("POST", "/functions/v1/delete-account", {"confirm": "DELETE"}, tok=TOK); chk("account deleted with DELETE", s == 200 and b.get("ok"), (s, b))
    for t, q in [("finds", f"owner=eq.{UID}"), ("collections", f"owner=eq.{UID}"), ("photos", f"catalog_id=eq.{fid}"), ("find_locations", f"catalog_id=eq.{fid}"), ("profiles", f"id=eq.{UID}")]:
        s, b = call("GET", f"/rest/v1/{t}?select=*&{q}", key=SVC); chk(f"{t} rows gone", b == [], b)
    s, b = call("POST", "/storage/v1/object/list/find-photos-private", {"prefix": f"{UID}/{fid}", "limit": 10}, key=SVC); chk("storage files gone", b == [], b)
    s, b = call("GET", f"/auth/v1/admin/users/{UID}", key=SVC); chk("auth user gone", s == 404, s)
    if s == 404: UID = None
finally:
    if UID: call("DELETE", f"/auth/v1/admin/users/{UID}", key=SVC)
print("FAILS", fails)
