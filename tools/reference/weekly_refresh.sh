#!/bin/sh
# Weekly Reference Catalog growth: add N new museum records to the DATABASE, then rebuild the crawlable SEO pages from it.
# Usage: tools/reference/weekly_refresh.sh [N=100] [--push]
# Needs SVC_KEY (set -a; . /workspace/.svc; set +a). The pages are generated output; the database is the source of truth.
set -e; cd "$(dirname "$0")/../.."; N="${1:-100}"
python3 tools/reference/import_public_catalog.py --add "$N"
python3 tools/reference/build_seo_pages.py
python3 tests/seo_pages_regress.py
if [ "$2" = "--push" ]; then
  git add reference sitemap.xml
  git diff --cached --quiet || { git commit -q -m "reference: weekly SEO page rebuild from database ($(date +%F))"; git push -q origin main; echo "pushed"; }
fi
