#!/usr/bin/env python3
"""Load or remove A10's Questionnaires and test data on the Meld open endpoint.

    python3 meld.py forms        # PUT soln-pam-root and soln-pam-assembled
    python3 meld.py modules      # compare the solution modules on Meld with the local files
    python3 meld.py data         # PUT testdata-bundle.json (transaction)
    python3 meld.py clean        # DELETE everything about soln-A10-patient-1: the test data and
                                 # anything written back for the patient (any id), then the
                                 # non-patient test resources (soln-A10-… practitioners etc.)
    python3 meld.py ... --base <url>

Only touches resources whose id starts with soln- or whose subject/patient is soln-A10-patient-1.
"""
import collections
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SOLN = HERE.parent
BASE = "https://gw.interop.community/QHConnectathon2026/open"
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]
BASE = BASE.rstrip("/")
PATIENT = "soln-A10-patient-1"
sys.path.insert(0, str(HERE))


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body and json.dumps(body).encode(),
                                 headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"})
    with urllib.request.urlopen(req) as r:
        text = r.read()
        return json.loads(text) if text else {}


def transaction(entries):
    if not entries:
        return
    r = call("POST", BASE, {"resourceType": "Bundle", "type": "transaction", "entry": entries})
    print(collections.Counter(e["response"]["status"] for e in r.get("entry", [])))


def module_files():
    # same list as build.mjs (MODULES)
    src = (HERE / "build.mjs").read_text()
    import re
    return [SOLN / m for m in re.findall(r"file: '([^']+)'", src)]


def modules():
    """Compare the solution modules on Meld with the local files (they belong to the A1–A11 agents:
    A10 doesn't PUT them, it only reports differences)."""
    for f in module_files():
        q = json.loads(f.read_text())
        try:
            m = call("GET", f"{BASE}/Questionnaire/{q['id']}")
        except Exception as ex:  # noqa: BLE001
            print(f"MISSING Questionnaire/{q['id']} on the server ({ex})")
            continue
        strip = lambda r: {k: v for k, v in r.items() if k not in ("meta", "text")}
        print(f"{'same' if strip(m) == strip(q) else 'DIFFERENT'}  Questionnaire/{q['id']}  (local {f.relative_to(SOLN)})")


def forms():
    entries = []
    for f in [HERE / "soln-pam-root.json", HERE / "soln-pam-assembled.json"]:
        q = json.loads(f.read_text())
        assert q["id"].startswith("soln-")
        entries.append({"resource": q, "request": {"method": "PUT", "url": f"Questionnaire/{q['id']}"}})
        print(f"PUT Questionnaire/{q['id']}  {q['url']}|{q['version']}")
    transaction(entries)


def data():
    bundle = json.loads((HERE / "testdata-bundle.json").read_text())
    assert all(e["resource"]["id"].startswith("soln-A10-") for e in bundle["entry"])
    transaction(bundle["entry"])


def search_ids(rtype, query):
    ids, url = [], f"{BASE}/{rtype}?{query}&_elements=id&_count=200"
    while url:
        page = call("GET", url)
        ids += [f"{rtype}/{e['resource']['id']}" for e in page.get("entry", []) if e.get("search", {}).get("mode", "match") == "match"]
        url = next((l["url"] for l in page.get("link", []) if l["relation"] == "next"), None)
    return ids


def clean():
    p = urllib.parse.quote(f"Patient/{PATIENT}")
    dels = []
    for rtype, param in [("Observation", "subject"), ("MedicationRequest", "subject"), ("MedicationStatement", "subject"),
                         ("Condition", "subject"), ("Procedure", "subject"), ("AllergyIntolerance", "patient"),
                         ("Flag", "subject"), ("Goal", "subject"), ("ServiceRequest", "subject"),
                         ("Encounter", "subject"), ("EpisodeOfCare", "patient"), ("Task", "patient"),
                         ("Communication", "subject"), ("QuestionnaireResponse", "subject")]:
        dels += search_ids(rtype, f"{param}={p}")
    bundle = json.loads((HERE / "testdata-bundle.json").read_text())
    others = [e["request"]["url"] for e in bundle["entry"] if e["resource"]["resourceType"] != "Patient"]
    dels = list(dict.fromkeys(dels))
    print(f"deleting {len(dels)} patient resources")
    transaction([{"request": {"method": "DELETE", "url": u}} for u in dels])
    call("DELETE", f"{BASE}/Patient/{PATIENT}")  # before the GP roles it references
    print(f"deleted Patient/{PATIENT}")
    # PractitionerRoles before Practitioners / Organizations (referential integrity)
    order = {"PractitionerRole": 0, "Practitioner": 1, "Organization": 2}
    rest = sorted([u for u in others if u not in dels], key=lambda u: order.get(u.split("/")[0], -1))
    print(f"deleting {len(rest)} other test resources")
    for u in rest:
        try:
            call("DELETE", f"{BASE}/{u}")
        except Exception as ex:  # noqa: BLE001
            print("  ", u, ex)


{"forms": forms, "modules": modules, "data": data, "clean": clean}[sys.argv[1]]()
