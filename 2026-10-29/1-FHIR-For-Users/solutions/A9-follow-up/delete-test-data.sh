#!/usr/bin/env bash
# Delete the A9 test data from Meld: all Tasks for the test patient (fixtures and written-back ones),
# the EpisodeOfCare, the referral and the patient. Recreate with ./reset-test-data.sh.
set -euo pipefail
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
P=soln-A9-patient-1
del() { echo "DELETE $1 -> $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/$1")"; }
for t in Task EpisodeOfCare ServiceRequest; do
  for id in $(curl -s "$BASE/$t?patient=$P&_count=100&_elements=id" -H 'Accept: application/fhir+json' \
              | python3 -c 'import json,sys; [print(e["resource"]["id"]) for e in json.load(sys.stdin).get("entry",[])]'); do
    del "$t/$id"
  done
done
del "Patient/$P"
