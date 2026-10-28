#!/usr/bin/env python3
"""Test patient for A6 (synthetic, fictional): male, anaemia with inflammation and possible functional
iron deficiency (expected pathway 'acd', suggested diagnosis 234347009), booked surgery 2026-12-03.

    python3 test_data.py && python3 meld.py data      # create on Meld
    python3 meld.py clean                             # remove (including anything written back)
"""
import json
from pathlib import Path

PID = "soln-A6-patient-1"
LOINC, UCUM, SCT = "http://loinc.org", "http://unitsofmeasure.org", "http://snomed.info/sct"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
LABS = {
    "hb": ("718-7", "Hemoglobin [Mass/volume] in Blood", "g/L", "g/L", 118),
    "ferritin": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma", "ug/L", "µg/L", 160),
    "tsat": ("2502-3", "Iron saturation [Mass Fraction] in Serum or Plasma", "%", "%", 14),
    "crp": ("1988-5", "C reactive protein [Mass/volume] in Serum or Plasma", "mg/L", "mg/L", 28),
    "mcv": ("787-2", "MCV [Entitic mean volume] in Red Blood Cells by Automated count", "fL", "fL", 84),
    "egfr": ("62238-1", "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by "
             "Creatinine-based formula (CKD-EPI)/1.73 sq M", "mL/min/{1.73_m2}", "mL/min/1.73 m²", 55),
}
entries = []


def put(r):
    entries.append({"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}})


put({"resourceType": "Patient", "id": PID,
     "identifier": [{"system": "https://aehrc.github.io/qh-connectathon/track1/patient-id", "value": "SOLN-A6-1"}],
     "name": [{"use": "official", "given": ["Arlo"], "family": "Diagtest"}],
     "gender": "male", "birthDate": "1950-07-21",
     "address": [{"use": "home", "city": "Kedron", "state": "QLD", "postalCode": "4031", "country": "AU"}]})
for k, (code, display, ucum, udisp, v) in LABS.items():
    put({"resourceType": "Observation", "id": f"soln-A6-p1-{k}", "status": "final",
         "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                   "code": "laboratory", "display": "Laboratory"}]}],
         "code": {"coding": [{"system": LOINC, "code": code, "display": display}]},
         "subject": {"reference": f"Patient/{PID}"}, "effectiveDateTime": "2026-10-05",
         "valueQuantity": {"value": v, "unit": udisp, "system": UCUM, "code": ucum}})
put({"resourceType": "ServiceRequest", "id": "soln-A6-p1-surgery", "status": "active", "intent": "order",
     "category": [{"coding": [{"system": f"{LOCAL}/elective-category", "code": "2", "display": "Category 2"}],
                   "text": "Category 2"}],
     "code": {"coding": [{"system": SCT, "code": "52734007", "display": "Total hip replacement"}]},
     "subject": {"reference": f"Patient/{PID}"}, "occurrenceDateTime": "2026-12-03", "authoredOn": "2026-09-20"})

out = Path(__file__).with_name("test-data.json")
out.write_text(json.dumps({"resourceType": "Bundle", "type": "transaction", "entry": entries}, indent=1,
                          ensure_ascii=False) + "\n")
print(f"Wrote {out.name}: {len(entries)} resources")
