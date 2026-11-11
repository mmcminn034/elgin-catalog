"""data/reference/public-catalog.json -> idempotent upsert SQL (stdout) for reference_media (needs migration 027).
New rows: keywords = '{}' (so AI look-alike matching is unchanged), data = {"pc": "1"} (marks loader-created rows for the down script).
Rows that already exist (the reused Smithsonian / Met rows) only get public_catalog = true and the catalog jsonb; their title,
keywords and credits are left exactly as they were. Records no longer in the JSON are un-flagged (public_catalog = false), never deleted."""
import json, pathlib
SITE = "https://unearthedfinds.com/"
d = json.load(open(pathlib.Path(__file__).resolve().parents[2] / "data/reference/public-catalog.json"))
q = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
F = ["name", "type", "material", "period", "age", "formation", "culture", "region", "institution", "catalog_number", "creator", "description", "thumb", "tx", "us", "gbif_url"]
rows = []
for i in d["items"]:
    cat = {k: i.get(k) for k in F if i.get(k) not in (None, "")}
    rows.append(f"({q(i['id'])},{q(i['source'])},{q(i['category'])},{q(i['name'])},'{{}}'::text[],'public-catalog',{q(SITE + i['thumb'])},null,{q(i['source_url'])},{q(i['license'])},{q(i.get('license_url'))},{q(i['attribution'])},'{{\"pc\":\"1\"}}'::jsonb,true,{q(json.dumps(cat, ensure_ascii=False))}::jsonb)")
print("begin;")
print("insert into public.reference_media (id,source,kind,title,keywords,category,thumb_url,image_url,source_url,license,license_url,attribution,data,public_catalog,catalog) values\n" + ",\n".join(rows) +
      "\non conflict (id) do update set public_catalog = true, catalog = excluded.catalog;")
print("update public.reference_media set public_catalog = false where public_catalog and id <> all(array[" + ",".join(q(i["id"]) for i in d["items"]) + "]::text[]);")
print("commit;")
