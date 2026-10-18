"""Exact find locations never leave the owner-only table: no public page, view, RPC, static file or photo EXIF carries them.
Usage: python3 tests/location_privacy_regress.py https://unearthedfinds.com/"""
import io, json, re, sys, glob, pathlib, secrets, urllib.request, urllib.error
from PIL import Image
U = sys.argv[1] if len(sys.argv) > 1 else "https://unearthedfinds.com/"; ROOT = pathlib.Path(__file__).resolve().parent.parent
cfg = urllib.request.urlopen(U + "assets/js/config.js?cb=" + secrets.token_hex(3)).read().decode()
SB = re.search(r"https://[a-z]+\.supabase\.co", cfg).group(0); ANON = re.search(r"(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)", cfg).group(1)
COORD = re.compile(r"(?<![\d.])-?\d{1,3}\.\d{4,}(?![\d])"); KEYS = re.compile(r'"(lat|lon|lng|latitude|longitude|gps|find_location_private|location)"\s*:', re.I)
fails = []
def chk(n, ok, i=""): print(("PASS " if ok else "FAIL ") + n, i); ok or fails.append(n)
def get(path, body=None):
    r = urllib.request.Request(SB + path, data=json.dumps(body).encode() if body is not None else None, headers={"apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    try: x = urllib.request.urlopen(r); return x.status, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def clean(txt): t = re.sub(r"\d{4}-\d\d-\d\dT[\d:.]+(\+\d\d:\d\d|Z)?", "", txt); return not COORD.search(t) and not KEYS.search(t)
s, t = get("/rest/v1/find_locations?select=*"); chk("anon can't read find_locations", s in (401, 403) or t.strip() == "[]", s)
for col in ["lat", "lon", "location", "find_location_private"]:
    s, t = get(f"/rest/v1/finds?select={col}&limit=1"); chk(f"finds table has no '{col}' column", s == 400 and "does not exist" in t, s)
s, t = get("/rest/v1/discover_finds?select=*"); chk("discover_finds: no coordinates / location keys", s == 200 and clean(t), COORD.findall(t)[:3])
ufs = [x["public_id"] for x in json.loads(t)]
for uf in ufs:
    s, t2 = get("/rest/v1/rpc/public_find", {"p_uf": uf})
    if not (s == 200 and clean(t2)): chk(f"public_find({uf}) clean", False, COORD.findall(t2)[:3])
chk(f"public_find RPC clean for all {len(ufs)} public finds", not [f for f in fails if f.startswith("public_find(")])
s, t = get("/rest/v1/photos?select=*"); chk("photos (public rows): no coordinates", clean(t))
cj = urllib.request.urlopen(U + "data/catalog.json?cb=" + secrets.token_hex(3)).read().decode(); chk("live catalog.json: no coordinates / location keys", clean(cj), COORD.findall(cj)[:3])
bad = [p.name for p in (ROOT / "share").glob("*.html") if not clean(p.read_text())]; chk("share stubs: no coordinates", not bad, bad)
for p in list((ROOT / "share").glob("*.html"))[:3]:
    t = urllib.request.urlopen(U + "share/" + p.name).read().decode(); chk(f"live share/{p.name} clean", clean(t))
gps = [f for f in glob.glob(str(ROOT / "images/**/*.jp*g"), recursive=True) if Image.open(f).getexif().get_ifd(0x8825)]
chk(f"repo images: no GPS EXIF ({len(glob.glob(str(ROOT / 'images/**/*.jp*g'), recursive=True))} files)", not gps, gps[:3])
live_gps = []
for x in json.loads(cj)[:14]:
    for ph in (x.get("photos") or [])[:2]:
        pth = ph.get("path") if isinstance(ph, dict) else ph
        if not pth: continue
        im = Image.open(io.BytesIO(urllib.request.urlopen(U + pth).read()))
        if im.getexif().get_ifd(0x8825): live_gps.append(pth)
chk("live public photos: no GPS EXIF", not live_gps, live_gps)
app = (ROOT / "assets/js/app.js").read_text(); chk("uploads re-encoded through canvas (EXIF/GPS stripped)", "function stripExif" in app and "toDataURL(\"image/jpeg\"" in app)
print("FAILS", fails)
