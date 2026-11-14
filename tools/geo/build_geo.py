#!/usr/bin/env python3
"""Build + load the coarse IP -> (country, state/region) lookup used by track_view() (migration 029).

Source: DB-IP "IP to City Lite" (https://db-ip.com/db/download/ip-to-city-lite), licensed CC BY 4.0.
Attribution required: "IP geolocation by DB-IP" (shown on the privacy note and the owner Traffic section).
We keep ONLY country + region: city, latitude and longitude are dropped while building.

Packing (keeps the whole world under ~30 MB inside Postgres, no third-party call per visit):
  geo_regions(ver, id, cc, region)        id 0 = unknown
  geo_v4(ver, k, data)  k = top 16 bits of the IPv4 address; data = sorted entries of
                        2-byte offset (low 16 bits) + 2-byte region id; first entry always at offset 0
  geo_v6(ver, k, data)  k = top 32 bits of the IPv6 address; data = 4-byte offset (bits 32-63) + 2-byte region id
                        (IPv6 is resolved at /64 granularity, which is finer than any region boundary)
A shard row exists only where a range starts; addresses in a shard without a row use the last entry of the previous row.

Usage:  tools/geo/build_geo.py [YYYY-MM] [--if-stale] [--dry]   (default: current month; downloads the free CSV, loads a NEW version,
        switches geo_meta to it, then deletes older versions). Needs /workspace/.sbp_token (management API). Never prints secrets.
"""
import csv, datetime, gzip, ipaddress, json, os, struct, sys, time, urllib.request

PROJECT = "qqllbazrwfebpnqhdwox"
WORK = "/workspace/geo"

def token():
    for line in open("/workspace/.sbp_token"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            if "TOKEN" in k.upper(): return v.strip().strip('"').strip("'")
    raise SystemExit("no token in /workspace/.sbp_token")

def q(sql, tries=4):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{PROJECT}/database/query", data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json", "User-Agent": "unearthedfinds-geo/1.0"})
    for i in range(tries):
        try: return json.loads(urllib.request.urlopen(req, timeout=120).read() or b"null")
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode(errors="replace")
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1: time.sleep(3 * (i + 1)); continue
            raise SystemExit(f"query failed {e.code}: {body}")
        except Exception:
            if i < tries - 1: time.sleep(3 * (i + 1)); continue
            raise

def build(path):
    regions = {("", ""): 0}; v4 = {}; v6 = {}
    def rid(cc, rg):
        if cc in ("", "ZZ"): return 0
        key = (cc, rg)
        if key not in regions: regions[key] = len(regions)
        return regions[key]
    prev4 = prev6 = None   # region of the previous range (to seed offset 0 of a new shard)
    last4 = last6 = None
    for row in csv.reader(gzip.open(path, "rt", encoding="utf-8")):
        s, cc, rg = row[0], row[3].strip().upper(), row[4].strip()
        r = rid(cc, rg); a = int(ipaddress.ip_address(s))
        if ":" in s:
            k, off = a >> 96, (a >> 64) & 0xFFFFFFFF; sh = v6.setdefault(k, [])
            if not sh and off: sh.append([0, last6 if last6 is not None else 0])
            if sh and sh[-1][0] == off: sh[-1][1] = r          # sub-/64 split: keep the later range
            elif not sh or sh[-1][1] != r: sh.append([off, r])
            last6 = r
        else:
            k, off = a >> 16, a & 0xFFFF; sh = v4.setdefault(k, [])
            if not sh and off: sh.append([0, last4 if last4 is not None else 0])
            if not sh or sh[-1][1] != r: sh.append([off, r])
            last4 = r
    if len(regions) > 65535: raise SystemExit("too many regions for 2-byte ids")
    p4 = {k: b"".join(struct.pack(">HH", o, r) for o, r in e) for k, e in v4.items()}
    p6 = {k: b"".join(struct.pack(">IH", o, r) for o, r in e) for k, e in v6.items()}
    return regions, p4, p6

def lit(s): return "null" if s is None else "'" + s.replace("'", "''") + "'"

def load(ver, regions, p4, p6, label):
    q(f"delete from public.geo_regions where ver = {ver}; delete from public.geo_v4 where ver = {ver}; delete from public.geo_v6 where ver = {ver};")
    rows = [f"({ver},{i},{lit(cc)},{lit(rg or None)})" for (cc, rg), i in regions.items() if i]
    for i in range(0, len(rows), 3000): q("insert into public.geo_regions (ver, id, cc, region) values " + ",".join(rows[i:i + 3000]))
    for tbl, data in (("geo_v4", p4), ("geo_v6", p6)):
        batch, size, done = [], 0, 0
        for k in sorted(data):
            v = f"({ver},{k},'\\x{data[k].hex()}'::bytea)"; batch.append(v); size += len(v)
            if size > 1_500_000:
                q(f"insert into public.{tbl} (ver, k, data) values " + ",".join(batch)); done += len(batch); batch, size = [], 0
                print(f"  {tbl}: {done}/{len(data)}", flush=True)
        if batch: q(f"insert into public.{tbl} (ver, k, data) values " + ",".join(batch))
    n = q(f"select (select count(*) from public.geo_v4 where ver={ver}) a, (select count(*) from public.geo_v6 where ver={ver}) b, (select count(*) from public.geo_regions where ver={ver}) c")[0]
    if (n["a"], n["b"], n["c"]) != (len(p4), len(p6), len(regions) - 1): raise SystemExit(f"row count mismatch {n}")
    q(f"insert into public.geo_meta (id, ver, source, built_at) values (1, {ver}, {lit(label)}, now()) on conflict (id) do update set ver = excluded.ver, source = excluded.source, built_at = now();"
      f"delete from public.geo_v4 where ver <> {ver}; delete from public.geo_v6 where ver <> {ver}; delete from public.geo_regions where ver <> {ver};")

if __name__ == "__main__":
    if sys.argv[1:2] == ["--json"]:   # tests: pack a fixture CSV and print it as JSON (no database access)
        regions, p4, p6 = build(sys.argv[2])
        print(json.dumps({"regions": [[i, cc, rg] for (cc, rg), i in regions.items() if i],
                          "v4": [[k, v.hex()] for k, v in sorted(p4.items())], "v6": [[k, v.hex()] for k, v in sorted(p6.items())]})); sys.exit(0)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    month = args[0] if args else datetime.date.today().strftime("%Y-%m")
    if "--if-stale" in sys.argv:   # weekly job: only rebuild when DB-IP has published a month we haven't loaded yet
        cur = (q("select ver from public.geo_meta where id = 1") or [{}])[0].get("ver") or 0
        if str(cur).startswith(month.replace("-", "")): print("geo data already current:", cur); sys.exit(0)
        try: urllib.request.urlopen(urllib.request.Request(f"https://download.db-ip.com/free/dbip-city-lite-{month}.csv.gz", method="HEAD"), timeout=30)
        except Exception: print("DB-IP", month, "not published yet; keeping", cur); sys.exit(0)
        for f in os.listdir(WORK) if os.path.isdir(WORK) else []:
            if f.startswith("dbip-city-lite-") and month not in f: os.remove(os.path.join(WORK, f))
    os.makedirs(WORK, exist_ok=True); path = f"{WORK}/dbip-city-lite-{month}.csv.gz"
    if not os.path.exists(path):
        print("downloading DB-IP City Lite", month, flush=True)
        urllib.request.urlretrieve(f"https://download.db-ip.com/free/dbip-city-lite-{month}.csv.gz", path)
    regions, p4, p6 = build(path)
    print(f"regions {len(regions) - 1}, v4 shards {len(p4)} ({sum(map(len, p4.values()))/1e6:.1f} MB), v6 shards {len(p6)} ({sum(map(len, p6.values()))/1e6:.1f} MB)", flush=True)
    if "--dry" in sys.argv: sys.exit(0)
    cur = (q("select ver from public.geo_meta where id = 1") or [{}])
    ver = int(month.replace("-", ""))
    if cur and cur[0].get("ver") == ver: ver = ver * 10 + 1   # rebuild of the same month
    load(ver, regions, p4, p6, f"DB-IP IP to City Lite {month} (CC BY 4.0)")
    print("loaded geo version", ver)
