#!/usr/bin/env bash
# Load the A2 test data and Questionnaires (PUT, fixed soln-A2- ids) to the Meld open endpoint.
#   ./load.sh [base]           test data + questionnaires
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
HERE="$(cd "$(dirname "$0")" && pwd)"
post() {
  curl -sS -X POST "$BASE" -H 'Content-Type: application/fhir+json' --data-binary @"$1" \
  | python3 -c 'import json,sys,collections; r=json.load(sys.stdin); print(collections.Counter(e["response"]["status"] for e in r["entry"]) if r.get("resourceType")=="Bundle" else json.dumps(r)[:1500])'
}
post "$HERE/testdata-bundle.json"
python3 - "$HERE" > "$HERE/.q.json" <<'PY'
import json, sys, pathlib
here = pathlib.Path(sys.argv[1])
entries = []
for f in sorted(p for p in here.glob("*.json") if not p.name.startswith(".")):
    r = json.loads(f.read_text())
    if r.get("resourceType") == "Questionnaire":
        entries.append({"resource": r, "request": {"method": "PUT", "url": f"Questionnaire/{r['id']}"}})
print(json.dumps({"resourceType": "Bundle", "type": "transaction", "entry": entries}))
PY
post "$HERE/.q.json"; rm -f "$HERE/.q.json"
