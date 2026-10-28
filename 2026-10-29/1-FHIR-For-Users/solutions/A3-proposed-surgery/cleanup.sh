#!/usr/bin/env bash
# Delete the test patient soln-A3-patient-1 and everything that refers to it (the test data from
# test-data.json and anything a write-back test created) from a FHIR server (default: Meld open
# endpoint). The Questionnaires are left in place. Recreate the test data with ./load.sh.
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
P=soln-A3-patient-1
for T in ServiceRequest Condition Procedure MedicationStatement AllergyIntolerance Observation Task EpisodeOfCare QuestionnaireResponse; do
  for id in $(curl -sS "$BASE/$T?patient=$P&_count=200&_elements=id&_format=json" -H 'Accept: application/fhir+json' \
      | python3 -c 'import json,sys; b=json.load(sys.stdin); print(" ".join(e["resource"]["id"] for e in b.get("entry",[])))' 2>/dev/null); do
    echo "DELETE $T/$id $(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/$T/$id")"
  done
done
echo "DELETE Patient/$P $(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/Patient/$P")"
