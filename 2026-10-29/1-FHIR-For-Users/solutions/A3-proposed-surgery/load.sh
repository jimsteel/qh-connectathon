#!/usr/bin/env bash
# PUT the A3 test patient + data and both Questionnaires to a FHIR server (default: Meld open endpoint).
# Fixed ids and PUT, so re-running is idempotent.
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
HERE="$(cd "$(dirname "$0")" && pwd)"
python3 - "$HERE" > "$HERE/.bundle.json" <<'PY'
import json, sys, pathlib
here = pathlib.Path(sys.argv[1])
bundle = json.loads((here / "test-data.json").read_text())
for f in ["soln-pam-proposed-surgery.json", "soln-A3-standalone.json"]:
    r = json.loads((here / f).read_text())
    bundle["entry"].append({"resource": r, "request": {"method": "PUT", "url": f"Questionnaire/{r['id']}"}})
print(json.dumps(bundle))
PY
curl -sS -X POST "$BASE" -H 'Content-Type: application/fhir+json' --data-binary @"$HERE/.bundle.json" \
  | python3 -c 'import json,sys,collections; r=json.load(sys.stdin); ok=r.get("resourceType")=="Bundle"; print(collections.Counter(e["response"]["status"] for e in r["entry"]) if ok else json.dumps(r)[:1500]); sys.exit(0 if ok else 1)'
rm -f "$HERE/.bundle.json"
