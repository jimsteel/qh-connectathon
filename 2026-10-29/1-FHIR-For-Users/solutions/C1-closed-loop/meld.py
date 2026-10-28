#!/usr/bin/env python3
"""Load / remove the C1 test data on the Meld open endpoint.

    python3 meld.py load baseline    # PUT testdata-baseline.json (transaction)
    python3 meld.py load recheck     # PUT testdata-recheck.json (post-treatment bloods)
    python3 meld.py list             # everything on Meld that belongs to / references the test patient
    python3 meld.py clean            # DELETE all of it (incl. write-back resources with server ids), then the Patient
    python3 meld.py check            # exit 1 unless nothing is left
    ... --base <url>                 # another FHIR server

Only touches the test patient soln-C1-patient-1 and resources that reference it.
"""
import collections
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
PID = "soln-C1-patient-1"
BASE = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "https://gw.interop.community/QHConnectathon2026/open"
BASE = BASE.rstrip("/")
SEARCHES = [("Observation", "subject"), ("Condition", "subject"), ("MedicationRequest", "subject"),
            ("ServiceRequest", "subject"), ("Flag", "subject"), ("Goal", "subject"),
            ("QuestionnaireResponse", "subject"), ("EpisodeOfCare", "patient"), ("Task", "patient"),
            ("Appointment", "patient"), ("MedicationAdministration", "subject"), ("Procedure", "subject")]


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body and json.dumps(body).encode(),
                                 headers={"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"})
    with urllib.request.urlopen(req) as r:
        text = r.read()
        return json.loads(text) if text else {}


def pages(url):
    while url:
        page = call("GET", url)
        yield from (e["resource"] for e in page.get("entry", []) if "resource" in e)
        url = next((l["url"] for l in page.get("link", []) if l["relation"] == "next"), None)


def transaction(entries):
    if not entries:
        return
    r = call("POST", BASE, {"resourceType": "Bundle", "type": "transaction", "entry": entries})
    print("  ", dict(collections.Counter(e["response"]["status"] for e in r.get("entry", []))))


def load(name):
    bundle = json.loads((HERE / f"testdata-{name}.json").read_text())
    assert all(e["resource"]["id"].startswith("soln-C1-") for e in bundle["entry"])
    print(f"PUT {len(bundle['entry'])} resources from testdata-{name}.json")
    transaction(bundle["entry"])


def find():
    """Resources that reference the test patient: type searches, plus $everything filtered to resources
    that actually contain a reference to the patient (it also returns shared Organizations etc.)."""
    found = set()
    for rtype, param in SEARCHES:
        for r in pages(f"{BASE}/{rtype}?{param}=Patient/{PID}&_elements=id&_count=200"):
            found.add(f"{rtype}/{r['id']}")
    try:
        for r in pages(f"{BASE}/Patient/{PID}/$everything?_count=200"):
            if r["resourceType"] != "Patient" and f'"Patient/{PID}"' in json.dumps(r):
                found.add(f"{r['resourceType']}/{r['id']}")
    except urllib.error.HTTPError as e:
        if e.code not in (404, 410):
            raise
    try:
        call("GET", f"{BASE}/Patient/{PID}")
        patient = True
    except urllib.error.HTTPError:
        patient = False
    return sorted(found), patient


def clean():
    found, patient = find()
    print(f"deleting {len(found)} resources" + (f" + Patient/{PID}" if patient else ""))
    for u in found:
        print("   DELETE", u)
    # referral, waitlist, episode and infusion booking reference each other: delete in one transaction,
    # dependants (EpisodeOfCare, ServiceRequests with basedOn/supportingInfo) are in the same batch
    try:
        transaction([{"request": {"method": "DELETE", "url": u}} for u in found])
    except urllib.error.HTTPError as e:
        print("   transaction failed", e.code, "- deleting one by one")
        order = ["EpisodeOfCare", "Task", "QuestionnaireResponse", "ServiceRequest", "MedicationRequest"]
        for u in sorted(found, key=lambda u: order.index(u.split("/")[0]) if u.split("/")[0] in order else 9):
            try:
                call("DELETE", f"{BASE}/{u}")
            except urllib.error.HTTPError as e2:
                print("   ", u, e2.code)
    if patient:
        transaction([{"request": {"method": "DELETE", "url": f"Patient/{PID}"}}])


def check():
    found, patient = find()
    print(f"left on Meld for {PID}: patient {'yes' if patient else 'no'}, {len(found)} other resources {found}")
    sys.exit(1 if (found or patient) else 0)


def list_():
    found, patient = find()
    print(f"Patient/{PID}: {'present' if patient else 'absent'}")
    for u in found:
        print(" ", u)


cmd = sys.argv[1]
if cmd == "load":
    load(sys.argv[2])
else:
    {"clean": clean, "check": check, "list": list_}[cmd]()
