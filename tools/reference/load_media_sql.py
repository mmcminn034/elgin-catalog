"""Turn data/reference/reference-media.json into an idempotent upsert SQL file (stdout)."""
import json, pathlib
d = json.load(open(pathlib.Path(__file__).resolve().parents[2] / "data/reference/reference-media.json"))
q = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
arr = lambda a: "array[" + ",".join(q(x) for x in a) + "]::text[]"
rows = [f"({q(i['id'])},{q(i['source'])},{q(i['kind'])},{q(i['title'])},{arr(i['keywords'])},{q(i.get('category'))},{q(i.get('thumb_url'))},{q(i.get('image_url'))},{q(i['source_url'])},{q(i['license'])},{q(i.get('license_url'))},{q(i['attribution'])},{q(json.dumps(i['data'])) + '::jsonb' if i.get('data') else 'null'})" for i in d["items"]]
print("insert into public.reference_media (id,source,kind,title,keywords,category,thumb_url,image_url,source_url,license,license_url,attribution,data) values\n" + ",\n".join(rows) +
      "\non conflict (id) do update set source=excluded.source,kind=excluded.kind,title=excluded.title,keywords=excluded.keywords,category=excluded.category,thumb_url=excluded.thumb_url,image_url=excluded.image_url,source_url=excluded.source_url,license=excluded.license,license_url=excluded.license_url,attribution=excluded.attribution,data=excluded.data,imported_at=now();")
