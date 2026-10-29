#!/usr/bin/env python3
"""Test patient for A5: three collection dates around an IV iron order (synthetic, fictional).

    python3 test_data.py              # writes test-data.json (transaction bundle, PUT with fixed ids)
    ./load-test-data.sh               # PUTs it to the Meld open endpoint
    ./load-test-data.sh --delete      # removes it (and any Observation written back for the patient)

Expected values are checked by verify.mjs.
"""
import json
from pathlib import Path

PID = "soln-A5-patient-1"
LOINC, UCUM, SCT = "http://loinc.org", "http://unitsofmeasure.org", "http://snomed.info/sct"
LABS = {  # key: (code, LOINC display, UCUM, unit display)
    "hb": ("718-7", "Hemoglobin [Mass/volume] in Blood", "g/L", "g/L"),
    "ferritin": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma", "ug/L", "µg/L"),
    "tsat": ("14801-5", "Iron saturation [Molar fraction] in Serum or Plasma", "%", "%"),
    "crp": ("1988-5", "C reactive protein [Mass/volume] in Serum or Plasma", "mg/L", "mg/L"),
    "mcv": ("787-2", "MCV [Entitic mean volume] in Red Blood Cells by Automated count", "fL", "fL"),
    "b12": ("14685-2", "Cobalamin (Vitamin B12) [Moles/volume] in Serum or Plasma", "pmol/L", "pmol/L"),
    "folate": ("14732-2", "Folate [Moles/volume] in Serum or Plasma", "nmol/L", "nmol/L"),
    "egfr": ("62238-1", "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by "
             "Creatinine-based formula (CKD-EPI)/1.73 sq M", "mL/min/{1.73_m2}", "mL/min/1.73 m²"),
}
# (suffix, date, lab, results)
DRAWS = [
    ("gp", "2026-06-03", "Northside Community Pathology (synthetic)", {"hb": 112, "ferritin": 25, "tsat": 12, "crp": 4}),
    ("initial", "2026-08-12", "Hospital pathology (synthetic)",
     {"hb": 104, "ferritin": 15, "tsat": 9, "crp": 6, "mcv": 76, "b12": 310, "folate": 22, "egfr": 72}),
    ("post", "2026-09-24", "Hospital pathology (synthetic)",
     {"hb": 121, "ferritin": 310, "tsat": 26, "crp": 5, "mcv": 82, "egfr": 70}),
]
IV_IRON_DATE = "2026-08-20"

entries = []


def put(r):
    entries.append({"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}})


put({"resourceType": "Patient", "id": PID,
     "identifier": [{"system": "https://aehrc.github.io/qh-connectathon/track1/patient-id", "value": "SOLN-A5-1"}],
     "name": [{"use": "official", "given": ["Paula"], "family": "Pathtest"}],
     "gender": "female", "birthDate": "1958-03-14",
     "address": [{"use": "home", "city": "Chermside", "state": "QLD", "postalCode": "4032", "country": "AU"}]})
for suffix, day, lab, results in DRAWS:
    for k, v in results.items():
        code, display, ucum, udisp = LABS[k]
        put({"resourceType": "Observation", "id": f"soln-A5-p1-{k}-{suffix}", "status": "final",
             "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                       "code": "laboratory", "display": "Laboratory"}]}],
             "code": {"coding": [{"system": LOINC, "code": code, "display": display}]},
             "subject": {"reference": f"Patient/{PID}"}, "effectiveDateTime": day,
             "performer": [{"display": lab}],
             "valueQuantity": {"value": v, "unit": udisp, "system": UCUM, "code": ucum}})
put({"resourceType": "MedicationRequest", "id": "soln-A5-p1-iv-iron", "status": "completed", "intent": "order",
     "medicationCodeableConcept": {"coding": [{"system": SCT, "code": "1312141000168105",
                                               "display": "Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial"}],
                                   "text": "Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial"},
     "subject": {"reference": f"Patient/{PID}"}, "authoredOn": IV_IRON_DATE,
     "dosageInstruction": [{"text": "1000 mg IV",
                            "route": {"coding": [{"system": SCT, "code": "47625008", "display": "Intravenous route"}]},
                            "doseAndRate": [{"doseQuantity": {"value": 1000, "unit": "mg", "system": UCUM, "code": "mg"}}]}]})

out = Path(__file__).with_name("test-data.json")
out.write_text(json.dumps({"resourceType": "Bundle", "type": "transaction", "entry": entries}, indent=1,
                          ensure_ascii=False) + "\n")
print(f"Wrote {out.name}: {len(entries)} resources")
