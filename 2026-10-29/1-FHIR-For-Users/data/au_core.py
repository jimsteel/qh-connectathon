#!/usr/bin/env python3
"""Add AU Core 2.0.0 (hl7.fhir.au.core#2.0.0) conformance to the Track 1 synthetic data.

A post-pass over a transaction bundle's entries: it only ADDS elements (meta.profile, identifiers,
extensions, telecom, a SNOMED coding on height/weight) and never changes an existing value, so
ids, codes, categories, values and dates that apps and forms query stay as they were.
New values come from their own per-resource RNG (seeded by resource id), so they don't shift
anything generate.py draws, and re-running gives the same output.

    python3 au_core.py <bundle.json>    # upgrade a bundle file in place (idempotent),
                                        # e.g. ../decks/examples/pam-demo-bundle.json
generate.py calls upgrade() on its own entries.

All identifiers are synthetic: IHI 800360…, HPI-I 800361…, HPI-O 800362…, 16 digits with a valid
Luhn check digit as AU Base requires, but in a 99… block and tied to fictional people. Phone numbers
are in the 07 5550 xxxx range ACMA reserves for fiction.
"""
import json
import os
import random
import sys
from pathlib import Path

CORE = "http://hl7.org.au/fhir/core/StructureDefinition"
BASE = "http://hl7.org.au/fhir/StructureDefinition"
PROFILE = {
    "Patient": f"{CORE}/au-core-patient",
    "Condition": f"{CORE}/au-core-condition",
    "MedicationRequest": f"{CORE}/au-core-medicationrequest",
    "Practitioner": f"{CORE}/au-core-practitioner",
    "Organization": f"{CORE}/au-core-organization",
    "ServiceRequest": f"{BASE}/au-servicerequest",  # no AU Core profile; AU Base
    # EpisodeOfCare, Task: no AU Core or AU Base profile
}
OBS_PROFILE = {  # by LOINC code
    "8302-2": f"{CORE}/au-core-bodyheight",
    "29463-7": f"{CORE}/au-core-bodyweight",
}
PATHOLOGY = f"{CORE}/au-core-diagnosticresult-path"
# The data conforms to these profiles but doesn't claim them: Meld (HAPI) returns HTTP 500
# (HAPI-0389 TagDefinition) on any resource with meta.profile. AU_CORE_DECLARE=1 adds the claims,
# e.g. for a copy to validate (the validator picks the profile from meta.profile).
DECLARE = os.environ.get("AU_CORE_DECLARE") == "1"
SNOMED_VITAL = {  # AU Core body height / weight require this SNOMED coding alongside LOINC
    "8302-2": ("50373000", "Body height measure"),
    "29463-7": ("27113001", "Body weight"),
}

V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203"
INDIGENOUS_CS = "https://healthterminologies.gov.au/fhir/CodeSystem/australian-indigenous-status-1"
INDIGENOUS = [("1", "Aboriginal but not Torres Strait Islander origin", 4),
              ("2", "Torres Strait Islander but not Aboriginal origin", 1),
              ("3", "Both Aboriginal and Torres Strait Islander origin", 1),
              ("4", "Neither Aboriginal nor Torres Strait Islander origin", 90),
              ("9", "Not stated/inadequately described", 4)]
LANGUAGE = {  # family name -> plausible language needing an interpreter (BCP 47)
    "Nguyen": ("vi", "Vietnamese"), "Vu": ("vi", "Vietnamese"),
    "Chen": ("cmn", "Mandarin"), "Lam": ("yue", "Cantonese"),
    "Gupta": ("hi", "Hindi"), "Patel": ("hi", "Hindi"), "Singh": ("pa", "Punjabi"),
    "Ito": ("ja", "Japanese"),
}


def luhn(digits15):
    total = 0
    for i, ch in enumerate(reversed(digits15)):
        d = int(ch)
        if i % 2 == 0:  # these get doubled once the check digit is appended
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return digits15 + str((10 - total % 10) % 10)


def hi_number(prefix, n):
    """16-digit healthcare identifier: 6-digit prefix, synthetic 99… block, Luhn check digit."""
    return luhn(f"{prefix}99{n:07d}")


def cc(system, code, display, text=None):
    return {"coding": [{"system": system, "code": code, "display": display}], "text": text or display}


def ordered(resource, **new):
    """Insert new top-level elements after id (meta first), keeping the existing order."""
    if not DECLARE:
        new.pop("meta", None)
    out = {}
    for k, v in resource.items():
        out[k] = v
        if k == "id":
            out.update({k2: v2 for k2, v2 in new.items() if k2 not in resource})
    return out


def number_of(rid):
    """pam-001 -> 1 ... pam-040 -> 40; the demo patient -> 999 (its Medicare number ends 9991)."""
    tail = rid.split("-")[1]
    return 999 if tail == "demo" else int(tail)


def patient(p):
    n = number_of(p["id"])
    rng = random.Random(f"au-core:{p['id']}")
    code, display, _ = rng.choices(INDIGENOUS, weights=[w for *_, w in INDIGENOUS])[0]
    family = p["name"][0]["family"]
    language = LANGUAGE.get(family) if rng.random() < 0.5 else None
    if p["id"] == "pam-demo":  # the slides' demo patient: keep it plain
        code, display, language = "4", INDIGENOUS[3][1], None
    p["identifier"].append({
        "type": cc(V2_0203, "NI", "National unique individual identifier", "IHI"),
        "system": "http://ns.electronichealth.net.au/id/hi/ihi/1.0",
        "value": hi_number("800360", n),
    })
    ext = [
        {"url": "http://hl7.org.au/fhir/StructureDefinition/indigenous-status",
         "valueCoding": {"system": INDIGENOUS_CS, "code": code, "display": display}},
        {"url": "http://hl7.org/fhir/StructureDefinition/patient-interpreterRequired",
         "valueBoolean": language is not None},
    ]
    new = {"extension": ext}
    p = ordered(p, meta={"profile": [PROFILE["Patient"]]}, **new)
    # telecom and communication after name, where they sit in the FHIR element order
    out = {}
    for k, v in p.items():
        out[k] = v
        if k == "name" and "telecom" not in p:
            out["telecom"] = [{"system": "phone", "value": f"07 5550 {1000 + n:04d}", "use": "home"}]
    if language and "communication" not in out:
        out["communication"] = [{"language": cc("urn:ietf:bcp:47", *language), "preferred": True}]
    return out


def observation(o):
    loinc = next(c["code"] for c in o["code"]["coding"] if c["system"] == "http://loinc.org")
    if loinc in SNOMED_VITAL and not any(c["system"] == "http://snomed.info/sct" for c in o["code"]["coding"]):
        code, display = SNOMED_VITAL[loinc]
        o["code"]["coding"].append({"system": "http://snomed.info/sct", "code": code, "display": display})
    return ordered(o, meta={"profile": [OBS_PROFILE.get(loinc, PATHOLOGY)]})


def practitioner(p, n):
    if not any(i.get("system", "").endswith("/hpii/1.0") for i in p.get("identifier", [])):
        ident = [{"type": cc(V2_0203, "NPI", "National provider identifier", "HPI-I"),
                  "system": "http://ns.electronichealth.net.au/id/hi/hpii/1.0",
                  "value": hi_number("800361", n)}]
        p = ordered(p, meta={"profile": [PROFILE["Practitioner"]]}, identifier=ident)
    return ordered(p, meta={"profile": [PROFILE["Practitioner"]]})


def organization(o, n):
    if not o.get("partOf") and not o.get("identifier"):  # the service itself; units are its departments
        ident = [{"type": cc("http://terminology.hl7.org.au/CodeSystem/v2-0203", "NOI",
                             "National Organisation Identifier", "HPI-O"),
                  "system": "http://ns.electronichealth.net.au/id/hi/hpio/1.0",
                  "value": hi_number("800362", n)}]
        o = ordered(o, meta={"profile": [PROFILE["Organization"]]}, identifier=ident)
    return ordered(o, meta={"profile": [PROFILE["Organization"]]})


def upgrade(entries):
    """Upgrade transaction-bundle entries in place. Idempotent."""
    counters = {"Practitioner": 0, "Organization": 0}
    for e in entries:
        r = e["resource"]
        t = r["resourceType"]
        if t in counters:
            counters[t] += 1
        if t == "Patient":
            if any(i.get("system", "").endswith("/ihi/1.0") for i in r["identifier"]):
                continue
            r = patient(r)
        elif t == "Observation":
            r = observation(r)
        elif t == "Practitioner":
            r = practitioner(r, counters[t])
        elif t == "Organization":
            r = organization(r, counters[t])
        elif t in PROFILE:
            r = ordered(r, meta={"profile": [PROFILE[t]]})
        e["resource"] = r
    return entries


if __name__ == "__main__":
    path = Path(sys.argv[1])
    bundle = json.loads(path.read_text())
    upgrade(bundle["entry"])
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
    print(f"Upgraded {path.name}: {len(bundle['entry'])} entries")
