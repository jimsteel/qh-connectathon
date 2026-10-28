#!/usr/bin/env python3
"""Build testdata-bundle.json: one test patient, soln-A10-patient-1, with enough data for every
module of the assembled PAM form, by merging the other scenarios' test bundles with ids remapped.

    python3 testdata.py      # reads ../A*/test-data bundles, writes testdata-bundle.json

Ids: soln-A<n>-patient-1 (and A2's soln-A2-patient-1) -> soln-A10-patient-1; every other
soln-A<n>-<rest> -> soln-A10-a<n>-<rest>. The Patient is A1's (richest demographics), renamed
"Ada Assembletest", with A2's generalPractitioner. What is taken from where:

  A1  height + weight Observations           A5  pathology Observations (3 dates) + IV iron order
  A2  GP practices / practitioners / roles,  A3  waitlist ServiceRequest (active) + an old one
      referral ServiceRequest, admission     A9  referral, EpisodeOfCare, Tasks
  A4  problem list, procedures, meds,        A11 the patient's completed pre-admission response
      allergy
Not used (they would duplicate what's above): A6 and A7 (pathology, surgery, height / weight), A8
(another waitlist entry), A2's second patient.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SOLN = HERE.parent
PATIENT = "soln-A10-patient-1"

SOURCES = [
    ("A1", "A1-patient-details/testdata-bundle.json", None),
    ("A2", "A2-gp-details/testdata-bundle.json", lambda r: r["id"] != "soln-A2-patient-2"),
    ("A3", "A3-proposed-surgery/test-data.json", None),
    ("A4", "A4-history/test-data.json", None),
    ("A5", "A5-pathology/test-data.json", None),
    ("A9", "A9-follow-up/test-data.json", None),
    ("A11", "A11-pre-admission/test-data.json", None),
]


def remap(text, n):
    text = re.sub(rf"soln-A{n}-patient-1(?![\w-])", PATIENT, text)
    return re.sub(rf"soln-A{n}-", f"soln-A10-a{n}-", text)


entries, seen = [], set()
patient_extra = {}
for n_, f, keep in SOURCES:
    n = n_[1:]
    bundle = json.loads((SOLN / f).read_text())
    for e in bundle["entry"]:
        r = e["resource"]
        if keep and not keep(r):
            continue
        if r["resourceType"] == "Patient":
            if n_ == "A2":
                patient_extra["generalPractitioner"] = json.loads(remap(json.dumps(r["generalPractitioner"]), n))
            if n_ != "A1":
                continue
        r = json.loads(remap(json.dumps(r), n))
        assert r["id"].startswith("soln-A10-"), r["id"]
        key = f"{r['resourceType']}/{r['id']}"
        assert key not in seen, key
        seen.add(key)
        entries.append({"resource": r, "request": {"method": "PUT", "url": key}})

patient = next(e["resource"] for e in entries if e["resource"]["resourceType"] == "Patient")
patient["name"] = [{"use": "official", "given": ["Ada"], "family": "Assembletest"}]
patient.update(patient_extra)
patient.setdefault("address", [{"use": "home", "city": "Chermside", "state": "QLD", "postalCode": "4032", "country": "AU"}])

# no reference may point at another scenario's test resources or at a pam-* patient
text = json.dumps(entries)
assert not re.search(r"soln-A(?!10-)\d+-", text), re.search(r"soln-A(?!10-)\d+-.{0,30}", text).group(0)
assert "Patient/pam-" not in text

out = {"resourceType": "Bundle", "type": "transaction", "entry": entries}
(HERE / "testdata-bundle.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
counts = {}
for e in entries:
    counts[e["resource"]["resourceType"]] = counts.get(e["resource"]["resourceType"], 0) + 1
print(f"wrote testdata-bundle.json: {len(entries)} resources {counts}")
