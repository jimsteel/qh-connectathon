#!/usr/bin/env bash
# (Re)load the A9 test patient and its episode/referral/tasks, and delete anything written back
# for that patient since (Tasks created by the form's write-back get server-assigned ids).
#
#   ./reset-test-data.sh [base]      default base: the Meld open endpoint
#
# Only touches resources for Patient/soln-A9-patient-1.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
P=soln-A9-patient-1

# Delete written-back Tasks (any Task for the test patient that isn't one of the fixtures).
for id in $(curl -s "$BASE/Task?patient=$P&_count=100&_elements=id" -H 'Accept: application/fhir+json' \
            | python3 -c 'import json,sys; [print(e["resource"]["id"]) for e in json.load(sys.stdin).get("entry",[])]'); do
  case "$id" in soln-A9-task-1|soln-A9-task-2) ;; *) echo "delete Task/$id"; curl -s -o /dev/null -X DELETE "$BASE/Task/$id";; esac
done

# PUT the fixtures (puts the EpisodeOfCare back to 'active' with no period.end).
curl -s -X POST "$BASE" -H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json' \
  --data-binary @"$HERE/test-data.json" \
  | python3 -c 'import json,sys; b=json.load(sys.stdin); [print(e["response"]["status"], e["response"].get("location","")) for e in b.get("entry",[])] if b.get("resourceType")=="Bundle" else print(json.dumps(b)[:500])'
