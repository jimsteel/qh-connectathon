#!/usr/bin/env python3
"""C1 closed-loop test patient (synthetic, fictional), shaped like a PAM patient from data/generate.py.

Writes two transaction Bundles (PUT, fixed ids starting soln-C1-):

* testdata-baseline.json: what exists *before* the nurse fills in A6 / A7 -- Patient, height and weight,
  initial pathology (Hb, ferritin, TSAT, CRP, MCV, eGFR), the surgical waitlist entry, the referral to
  blood management (ServiceRequest 3457005, supportingInfo -> waitlist) and the PAM EpisodeOfCare.
  No Condition and no MedicationRequest: those come from the forms (write-back).
* testdata-recheck.json: the post-treatment bloods (Hb, ferritin, TSAT, CRP), dated 2026-11-25,
  i.e. ~4 weeks after the IV iron order that A7 writes back with authoredOn = now. They have to be
  *after* the order date to count as post-treatment in B6, so they are future-dated ("fast forward").

    python3 test_data.py
    python3 meld.py load baseline     # / recheck
    python3 meld.py clean             # delete the patient and everything that references it
"""
import json
from pathlib import Path

PID = "soln-C1-patient-1"
SCT, LOINC, UCUM = "http://snomed.info/sct", "http://loinc.org", "http://unitsofmeasure.org"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
PAT = {"reference": f"Patient/{PID}"}

REFERRAL = "2026-10-14"     # 2026-27 Q2 (financial year)
PRE_ADMIT = "2026-10-09"    # initial bloods, 5 days before referral (generator: 1-10 days)
WAITLISTED = "2026-09-15"   # added to the surgical waitlist (generator: 7-60 days before referral)
SURGERY = "2026-12-10"
RECHECK = "2026-11-25"      # post-treatment bloods (generator: 21-35 days after the IV iron order)

LABS = {  # key: (LOINC, display, UCUM, unit text)
    "hb": ("718-7", "Hemoglobin [Mass/volume] in Blood", "g/L", "g/L"),
    "ferritin": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma", "ug/L", "µg/L"),
    "tsat": ("2502-3", "Iron saturation [Mass Fraction] in Serum or Plasma", "%", "%"),
    "crp": ("1988-5", "C reactive protein [Mass/volume] in Serum or Plasma", "mg/L", "mg/L"),
    "mcv": ("787-2", "MCV [Entitic mean volume] in Red Blood Cells by Automated count", "fL", "fL"),
    "egfr": ("62238-1", "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by "
             "Creatinine-based formula (CKD-EPI)/1.73 sq M", "mL/min/{1.73_m2}", "mL/min/1.73 m²"),
}
INITIAL = {"hb": 98, "ferritin": 18, "tsat": 9, "crp": 4, "mcv": 76, "egfr": 85}   # iron deficiency anaemia
POST = {"hb": 121, "ferritin": 385, "tsat": 27, "crp": 3}


def coding(system, code, display):
    return {"coding": [{"system": system, "code": code, "display": display}], "text": display}


def put(entries, r):
    entries.append({"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}})


def obs(entries, oid, when, code, display, value, ucum, unit, category="laboratory"):
    put(entries, {
        "resourceType": "Observation", "id": f"soln-C1-p1-{oid}", "status": "final",
        "category": [coding("http://terminology.hl7.org/CodeSystem/observation-category", category,
                            "Laboratory" if category == "laboratory" else "Vital Signs")],
        "code": coding(LOINC, code, display), "subject": PAT, "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit, "system": UCUM, "code": ucum}})


baseline = []
put(baseline, {
    "resourceType": "Patient", "id": PID,
    "identifier": [{"system": "https://aehrc.github.io/qh-connectathon/track1/patient-id", "value": "SOLN-C1-1"}],
    "name": [{"use": "official", "given": ["Clara"], "family": "Loopdemo"}],
    "gender": "female", "birthDate": "1958-03-12",
    "address": [{"use": "home", "city": "Chermside", "state": "QLD", "postalCode": "4032", "country": "AU"}]})
obs(baseline, "height", PRE_ADMIT, "8302-2", "Body height", 165, "cm", "cm", "vital-signs")
obs(baseline, "weight", PRE_ADMIT, "29463-7", "Body weight", 68, "kg", "kg", "vital-signs")
for k, v in INITIAL.items():
    obs(baseline, f"{k}-1", PRE_ADMIT, *LABS[k][:2], v, *LABS[k][2:])
put(baseline, {
    "resourceType": "ServiceRequest", "id": "soln-C1-p1-surgery", "status": "active", "intent": "order",
    "category": [coding(f"{LOCAL}/elective-category", "2", "Category 2")],
    "code": coding(SCT, "609588000", "Total knee replacement"), "subject": PAT,
    "occurrenceDateTime": SURGERY, "authoredOn": WAITLISTED,
    "requester": {"display": "Dr Alan Pierce (synthetic)"}, "performer": [{"display": "Orthopaedics (synthetic)"}]})
put(baseline, {
    "resourceType": "ServiceRequest", "id": "soln-C1-p1-referral", "status": "completed", "intent": "order",
    "category": [coding(f"{LOCAL}/referral-source", "preadmission", "Pre-admission clinic")],
    "code": coding(SCT, "3457005", "Patient referral"), "subject": PAT, "authoredOn": REFERRAL,
    "requester": {"display": "Dr Alan Pierce (synthetic)"}, "performer": [{"display": "Blood Management Service (synthetic)"}],
    "reasonCode": [coding(SCT, "271737000", "Anaemia")],
    "supportingInfo": [{"reference": "ServiceRequest/soln-C1-p1-surgery"}]})
put(baseline, {
    "resourceType": "EpisodeOfCare", "id": "soln-C1-p1-episode", "status": "active",
    "type": [coding(f"{LOCAL}/episode-type", "pam", "Preoperative anaemia management")],
    "patient": PAT, "managingOrganization": {"display": "Blood Management Service (synthetic)"},
    "period": {"start": REFERRAL}, "referralRequest": [{"reference": "ServiceRequest/soln-C1-p1-referral"}]})

recheck = []
for k, v in POST.items():
    obs(recheck, f"{k}-2", RECHECK, *LABS[k][:2], v, *LABS[k][2:])

here = Path(__file__).parent
for name, entries in [("baseline", baseline), ("recheck", recheck)]:
    assert all(e["resource"]["id"].startswith("soln-C1-") for e in entries)
    (here / f"testdata-{name}.json").write_text(json.dumps(
        {"resourceType": "Bundle", "type": "transaction", "entry": entries}, indent=1, ensure_ascii=False) + "\n")
    print(f"testdata-{name}.json: {len(entries)} resources")
