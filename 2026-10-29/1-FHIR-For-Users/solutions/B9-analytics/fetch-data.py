#!/usr/bin/env python3
"""Fetch the PAM data from the Meld open endpoint (read-only) into data/<ResourceType>.ndjson.

    python3 fetch-data.py [--all] [FHIR base]

By default, resources belonging to test patients other teams add to the shared sandbox
(patient ids starting `soln-`) are left out, so the KPIs match the synthetic PAM data set.
--all keeps everything. data/ is a cache: it is git-ignored and rebuilt by this script.
"""
import json
import sys
import urllib.request
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
BASE = args[0] if args else "https://gw.interop.community/QHConnectathon2026/open"
KEEP_ALL = "--all" in sys.argv
TYPES = ["Patient", "ServiceRequest", "EpisodeOfCare", "Observation", "Condition", "MedicationRequest", "Task", "Organization"]
OUT = Path(__file__).with_name("data")
OUT.mkdir(exist_ok=True)


def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/fhir+json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def patient_of(r):
    if r["resourceType"] == "Patient":
        return r["id"]
    ref = (r.get("subject") or r.get("patient") or r.get("for") or {}).get("reference", "")
    return ref.split("/")[-1] if ref.startswith("Patient/") else None


for t in TYPES:
    url, rows, skipped = f"{BASE}/{t}?_count=500&_format=json", [], 0
    while url:
        b = get(url)
        for e in b.get("entry", []):
            r = e["resource"]
            p = patient_of(r)
            if not KEEP_ALL and p and p.startswith("soln-"):
                skipped += 1
                continue
            rows.append(r)
        url = next((l["url"] for l in b.get("link", []) if l["relation"] == "next"), None)
    (OUT / f"{t}.ndjson").write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows))
    print(f"{t:18} {len(rows):4} written, {skipped} test resources skipped")
