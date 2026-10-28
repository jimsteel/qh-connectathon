#!/usr/bin/env bash
# Delete this scenario's test data from Meld (reverse order of testdata-bundle.json, so nothing is
# still referenced when it goes). The Questionnaires stay. Recreate with ./load.sh.
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
HERE="$(cd "$(dirname "$0")" && pwd)"
python3 -c 'import json,sys; [print(e["request"]["url"]) for e in reversed(json.load(open(sys.argv[1]))["entry"])]' "$HERE/testdata-bundle.json" |
while read -r ref; do
  printf '%s ' "$ref"; curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/$ref"
done
