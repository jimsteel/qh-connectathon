#!/usr/bin/env python3
"""Check every SNOMED CT and LOINC code (with its display) in the A5 and A6 Questionnaires against
Ontoserver ($validate-code; SNOMED CT-AU edition). Codes only: no patient data is sent.

    python3 check-codes.py
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

TX = "https://r4.ontoserver.csiro.au/fhir"
HERE = Path(__file__).parent
FILES = [HERE / "soln-pam-diagnosis.json", HERE.parent / "A5-pathology" / "soln-pam-pathology.json"]
SYSTEMS = {"http://snomed.info/sct": "http://snomed.info/sct/32506021000036107", "http://loinc.org": None}


def codings(node, out):
    if isinstance(node, list):
        for n in node:
            codings(n, out)
    elif isinstance(node, dict):
        if node.get("system") in SYSTEMS and isinstance(node.get("code"), str):
            out.add((node["system"], node["code"], node.get("display")))
        for v in node.values():
            codings(v, out)


found = set()
for f in FILES:
    codings(json.loads(f.read_text()), found)
bad = 0
for system, code, display in sorted(found):
    params = {"url": system, "code": code, "_format": "json"}
    if SYSTEMS[system]:
        params["version"] = SYSTEMS[system]
    with urllib.request.urlopen(f"{TX}/CodeSystem/$validate-code?{urllib.parse.urlencode(params)}") as r:
        p = {x["name"]: x for x in json.load(r)["parameter"]}
    ok = p["result"]["valueBoolean"]
    pref = p.get("display", {}).get("valueString")
    # Answer-option displays may be short local labels (e.g. LOINC "Haemoglobin (Hb)"); flag, don't fail
    note = "" if display in (None, pref) else f"  (form display '{display}', preferred '{pref}')"
    print(f"{'PASS' if ok else 'FAIL'} {system} {code}{note}")
    bad += not ok
print(f"\n{len(found) - bad}/{len(found)} codes valid")
sys.exit(1 if bad else 0)
