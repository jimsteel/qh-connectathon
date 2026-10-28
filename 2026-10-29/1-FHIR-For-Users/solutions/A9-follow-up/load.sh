#!/usr/bin/env bash
# PUT the A9 Questionnaires to the forms server (default: the Meld open endpoint), by id.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${1:-https://gw.interop.community/QHConnectathon2026/open}"
for f in pam-follow-up.json A9-standalone.json A9-standalone-put.json; do
  id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$HERE/$f")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/Questionnaire/$id" \
    -H 'Content-Type: application/fhir+json' --data-binary @"$HERE/$f")
  echo "$code Questionnaire/$id ($f)"
done
