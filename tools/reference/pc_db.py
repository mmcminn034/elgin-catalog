"""Supabase I/O for the public Reference Catalog (REST + Storage with the service key; no admin token needed).
Rows live in public.reference_media. Public-catalog rows carry data->>'public' = '1' and a data->'catalog' object with the
display fields. Rows created by the catalog importer also carry data->>'pc' = '1'. Thumbnails live in the public Storage bucket
'reference-media' (WebP <= 480 px, re-encoded so no EXIF/GPS). Service key: SVC_KEY in the environment (load /workspace/.svc).
Never prints the key."""
import json, os, re, urllib.parse, urllib.request
URL = os.environ.get("SUPABASE_URL", "https://qqllbazrwfebpnqhdwox.supabase.co")
BUCKET = "reference-media"
def _key():
    k = os.environ.get("SVC_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not k: raise SystemExit("SVC_KEY not set (run: set -a; . /workspace/.svc; set +a)")
    return k
def _req(method, path, body=None, headers=None, raw=False, timeout=60):
    h = {"apikey": _key(), "Authorization": "Bearer " + _key(), "User-Agent": "UnEarthedFinds-reference-import/3.0"}
    if body is not None and not raw: h["Content-Type"] = "application/json"; body = json.dumps(body).encode()
    h.update(headers or {})
    r = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            b = resp.read(); return resp.status, (json.loads(b) if b and b[:1] in b"[{" else b)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]
def ensure_bucket():
    st, b = _req("GET", "/storage/v1/bucket/" + BUCKET)
    if st == 200: return True
    st, b = _req("POST", "/storage/v1/bucket", {"id": BUCKET, "name": BUCKET, "public": True, "file_size_limit": 1048576, "allowed_mime_types": ["image/webp", "image/jpeg"]})
    if st not in (200, 201): raise SystemExit(f"could not create bucket: {st} {b}")
    return True
def public_url(path): return f"{URL}/storage/v1/object/public/{BUCKET}/{path}"
def upload(path, data, mime="image/webp"):
    st, b = _req("POST", f"/storage/v1/object/{BUCKET}/{path}", data, {"Content-Type": mime, "x-upsert": "true", "Cache-Control": "max-age=31536000"}, raw=True)
    if st not in (200, 201): raise RuntimeError(f"upload {path}: {st} {b}")
    return public_url(path)
def all_rows(select="id,source,data"):
    out, off = [], 0
    while True:
        st, b = _req("GET", f"/rest/v1/reference_media?select={select}&order=id&limit=1000&offset={off}")
        if st != 200: raise RuntimeError(f"read reference_media: {st} {b}")
        out += b; off += 1000
        if len(b) < 1000: return out
def seen_keys():
    """ids + (source, catalog_number) pairs already in reference_media: the dedupe keys."""
    ids, pairs = set(), set()
    for r in all_rows():
        ids.add(r["id"]); c = ((r.get("data") or {}).get("catalog") or {})
        if c.get("catalog_number"): pairs.add((r["source"], c["catalog_number"].strip().upper()))
    return ids, pairs
def upsert(rows):
    for i in range(0, len(rows), 200):
        st, b = _req("POST", "/rest/v1/reference_media?on_conflict=id", rows[i:i + 200], {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if st not in (200, 201, 204): raise RuntimeError(f"upsert: {st} {b}")
def patch_data(rid, data):
    st, b = _req("PATCH", "/rest/v1/reference_media?id=eq." + urllib.parse.quote(rid, safe=""), {"data": data}, {"Prefer": "return=minimal"})
    if st not in (200, 204): raise RuntimeError(f"patch {rid}: {st} {b}")
