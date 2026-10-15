#!/bin/sh
# Bump the service-worker VERSION and the ?v= cache-buster on every css/js URL in index.html together.
# The custom-domain host caches assets for 30 days, so the query string is what forces fresh files. Usage: tools/bump_version.sh ro-v9.0
set -e; V="$1"; [ -n "$V" ] || { echo "usage: $0 ro-vX.Y"; exit 1; }
sed -i "s/const VERSION = \"[^\"]*\"/const VERSION = \"$V\"/" sw.js
sed -i -E "s#((src|href)=\"assets/(css|js)/[A-Za-z0-9_.-]+\.(css|js))\?v=[A-Za-z0-9_.-]+\"#\1?v=$V\"#g" index.html
grep -o "VERSION = \"[^\"]*\"" sw.js
