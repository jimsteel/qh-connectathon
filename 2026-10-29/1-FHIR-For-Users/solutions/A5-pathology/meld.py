#!/usr/bin/env python3
"""Load or remove this scenario's Questionnaires and test data on the Meld open endpoint.

    python3 meld.py forms                 # PUT soln-*.json Questionnaires
    python3 meld.py data                  # PUT test-data.json (transaction)
    python3 meld.py clean                 # DELETE everything for the test patient(s) in test-data.json,
                                          # including resources written back by the form (any id)
    python3 meld.py ... --base <url>      # another FHIR server (default: Meld open endpoint)

Only touches resources whose id starts with soln- or whose subject is a soln- test patient.
"""
import collections
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://gw.interop.community/QHConnectathon2026/open"
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]
BASE = BASE.rstrip("/")


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body and json.dumps(body).encode(),
                                 headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"})
    with urllib.request.urlopen(req) as r:
        text = r.read()
        return json.loads(text) if text else {}


def transaction(entries):
    r = call("POST", BASE, {"resourceType": "Bundle", "type": "transaction", "entry": entries})
    print(collections.Counter(e["response"]["status"] for e in r.get("entry", [])))


def forms():
    entries = []
    for f in sorted(HERE.glob("soln-*.json")):
        q = json.loads(f.read_text())
        assert q["id"].startswith("soln-")
        entries.append({"resource": q, "request": {"method": "PUT", "url": f"Questionnaire/{q['id']}"}})
        print("PUT Questionnaire/" + q["id"])
    transaction(entries)


def data():
    bundle = json.loads((HERE / "test-data.json").read_text())
    assert all(e["resource"]["id"].startswith("soln-") for e in bundle["entry"])
    transaction(bundle["entry"])


def clean():
    bundle = json.loads((HERE / "test-data.json").read_text())
    patients = [e["resource"]["id"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Patient"]
    dels = []
    for pid in patients:
        assert pid.startswith("soln-")
        for rtype, param in [("Observation", "subject"), ("MedicationRequest", "subject"), ("Condition", "subject"),
                             ("Flag", "subject"), ("Goal", "subject"), ("ServiceRequest", "subject"),
                             ("QuestionnaireResponse", "subject")]:
            url = f"{BASE}/{rtype}?{param}=Patient/{urllib.parse.quote(pid)}&_elements=id&_count=200"
            while url:
                page = call("GET", url)
                dels += [f"{rtype}/{e['resource']['id']}" for e in page.get("entry", [])]
                url = next((l["url"] for l in page.get("link", []) if l["relation"] == "next"), None)
        dels.append(f"Patient/{pid}")
    print(f"deleting {len(dels)} resources")
    # resources first, the Patient last (referential integrity)
    transaction([{"request": {"method": "DELETE", "url": u}} for u in dels if not u.startswith("Patient/")])
    transaction([{"request": {"method": "DELETE", "url": u}} for u in dels if u.startswith("Patient/")])


{"forms": forms, "data": data, "clean": clean}[sys.argv[1]]()
