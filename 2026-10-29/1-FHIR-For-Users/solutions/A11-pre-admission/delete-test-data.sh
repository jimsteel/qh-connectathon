#!/usr/bin/env bash
# Delete the A11 test data from Meld: every QuestionnaireResponse for the test patient, then the patient.
# Recreate with:  curl -X POST -H 'Content-Type: application/fhir+json' --data-binary @test-data.json <base>
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
P=soln-A11-patient-1
for id in $(curl -s "$BASE/QuestionnaireResponse?subject=Patient/$P&_count=100&_elements=id" -H 'Accept: application/fhir+json' \
            | python3 -c 'import json,sys; [print(e["resource"]["id"]) for e in json.load(sys.stdin).get("entry",[])]'); do
  echo "DELETE QuestionnaireResponse/$id -> $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/QuestionnaireResponse/$id")"
done
echo "DELETE Patient/$P -> $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/Patient/$P")"
