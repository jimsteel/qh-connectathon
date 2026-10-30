#!/usr/bin/env bash
# Build the Track 2 API guide page and its downloads.
#   ./build.sh [OUT_DIR]     OUT_DIR (default ./build) gets the HTML page.
# The downloadable files are written to ./downloads and committed, so the Markdown links work on GitHub too.
# Publish by copying OUT_DIR/*.html and ./downloads into track2/ on the gh-pages branch.
# Needs python3, pandoc, zip.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-build}"
python3 -I generate_postman.py
DL=downloads
rm -rf "$DL" && mkdir -p "$DL" "$OUT"
mv QH-Track2.postman_collection.json QH-Track2-*.postman_environment.json "$DL/"
# the fhir-frog test library: the TestScript bundles exactly as the deployed frog-runner loads them
( cd ../deploy/frog-tests && zip -qr -X "$OLDPWD/$DL/QH-Track2-frog-testscripts.zip" \
    README.md cleanup-fixtures.py scenario1 scenario1-referral )
CSS="$(mktemp)"; trap 'rm -f "$CSS"' EXIT
cat > "$CSS" <<'S'
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { max-width: 56em; font-family: Calibri, "Segoe UI", system-ui, sans-serif; line-height: 1.5; }
  table { border-collapse: collapse; display: block; overflow-x: auto; }
  th, td { border: 1px solid #DDE4E9; padding: 4px 10px; text-align: left; vertical-align: top; }
  th { background: #E6F6FA; color: #001D34; }
  pre { overflow-x: auto; background: #F5F8FA; padding: 10px; }
  a { color: #1E22AA; }
  h1, h2 { color: #001D34; border-bottom: 2px solid #00A9CE; padding-bottom: 4px; }
</style>
S
pandoc -f gfm -t html -s --metadata title="Track 2 API guide: Radiology Referral" -H "$CSS" \
  QH-Track2-API-Guide.md -o "$OUT/QH-Track2-API-Guide.html"
ls -l "$OUT" "$DL"
