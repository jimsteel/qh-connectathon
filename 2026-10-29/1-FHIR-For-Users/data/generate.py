#!/usr/bin/env python3
"""Generate synthetic Preoperative Anaemia Management (PAM) data as a FHIR R4 transaction bundle.

All people, names and organisations are fictional. Output is deterministic (fixed seed) and
uses PUT with fixed ids, so loading it again updates rather than duplicates.

    python3 generate.py            # writes pam-synthetic-bundle.json
    ./load.sh [FHIR base URL]      # posts it to the sandbox

Resource mapping follows ../FHIR-Mapping-DRAFT.md. au_core.py then adds what AU Core 2.0.0 needs
(profiles, IHI/HPI-I/HPI-O, Indigenous status, ...) without changing anything generated here.
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

from au_core import upgrade as au_core_upgrade

SEED = 20261008
N_PATIENTS = 40
FIRST_REFERRAL = date(2025, 7, 1)
LAST_REFERRAL = date(2026, 9, 25)
TODAY = date(2026, 10, 6)

SCT = "http://snomed.info/sct"
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
ID_SYS = "https://aehrc.github.io/qh-connectathon/track1/patient-id"

rng = random.Random(SEED)
entries = []


def add(resource):
    rid = f"{resource['resourceType']}/{resource['id']}"
    entries.append({
        "resource": resource,
        "request": {"method": "PUT", "url": rid},
    })
    return {"reference": rid}


def coding(system, code, display):
    return {"coding": [{"system": system, "code": code, "display": display}], "text": display}


def local(cs, code, display):
    return coding(f"{LOCAL}/{cs}", code, display)


# --- Reference data -------------------------------------------------------------------------

LABS = {
    "hb": ("718-7", "Hemoglobin [Mass/volume] in Blood", "g/L", "g/L"),
    "ferritin": ("2276-4", "Ferritin [Mass/volume] in Serum or Plasma", "ug/L", "µg/L"),
    "tsat": ("14801-5", "Iron saturation [Molar fraction] in Serum or Plasma", "%", "%"),  # RCPA SPIA code
    "crp": ("1988-5", "C reactive protein [Mass/volume] in Serum or Plasma", "mg/L", "mg/L"),
}

UNITS = {  # surgical unit -> typical procedures
    "Orthopaedics": [("609588000", "Total knee replacement"), ("52734007", "Total hip replacement"),
                     ("50172003", "Lumbar spinal fusion")],
    "Colorectal": [("359571009", "Right hemicolectomy"), ("4558008", "Anterior resection of rectum")],
    "Gynaecology": [("116143008", "Total abdominal hysterectomy")],
    "Cardiothoracic": [("232717009", "Coronary artery bypass graft")],
    "Urology": [("26294005", "Radical prostatectomy")],
}

REFERRAL_SOURCES = [("surgeon", "Surgeon"), ("preadmission", "Pre-admission clinic"),
                    ("anaesthetist", "Anaesthetist"), ("gp", "General practitioner")]

DIAGNOSES = {
    "ida": ("87522002", "Iron deficiency anaemia"),
    "id": ("35240004", "Iron deficiency"),
    "acd": ("234347009", "Anaemia of chronic disease"),
    "anaemia": ("271737000", "Anaemia"),
}

IV_IRON = [("1312141000168105", "Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial"),
           ("1086251000168104", "Iron (as ferric derisomaltose) 100 mg/mL injection, vial")]

GIVEN_F = ["Alice", "Bree", "Chloe", "Dana", "Erin", "Fiona", "Grace", "Hannah", "Isla", "Jade",
           "Kate", "Lena", "Maya", "Nina", "Olivia", "Pia", "Ruby", "Sophie", "Tess", "Zara"]
GIVEN_M = ["Aaron", "Ben", "Callum", "Dev", "Eli", "Finn", "George", "Harry", "Ivan", "Jack",
           "Kai", "Liam", "Max", "Noah", "Oscar", "Paul", "Ravi", "Sam", "Tom", "Will"]
FAMILY = ["Anderson", "Brooks", "Chen", "Dawson", "Evans", "Fraser", "Gupta", "Hughes", "Ito",
          "Jensen", "Kelly", "Lam", "Morgan", "Nguyen", "O'Brien", "Patel", "Quinn", "Reid",
          "Singh", "Taylor", "Usman", "Vu", "Walsh", "Young"]
SUBURBS = [("Chermside", "4032"), ("Kedron", "4031"), ("Nundah", "4012"), ("Aspley", "4034"),
           ("Redcliffe", "4020"), ("Caboolture", "4510"), ("Strathpine", "4500"),
           ("North Lakes", "4509"), ("Stafford", "4053"), ("Windsor", "4030"), ("Kallangur", "4503")]


def ganzoni(weight, hb):
    target, stores = (130, 15 * weight) if weight < 35 else (150, 500)
    return round(weight * (target - hb) * 0.24 + stores)


# --- Shared resources -----------------------------------------------------------------------

service = add({
    "resourceType": "Organization", "id": "pam-blood-management",
    "name": "Blood Management Service (synthetic)",
    "type": [coding("http://terminology.hl7.org/CodeSystem/organization-type", "dept", "Hospital Department")],
})
unit_refs = {
    u: add({"resourceType": "Organization", "id": f"pam-unit-{u.lower()}",
            "name": f"{u} (synthetic)", "partOf": service})
    for u in UNITS
}


def practitioner(pid, given, family, role):
    return add({"resourceType": "Practitioner", "id": pid,
                "name": [{"use": "official"} | ({"prefix": [role]} if role else {}) | {"given": [given], "family": family}]})


nurses = [practitioner(f"pam-nurse-{i}", g, f, None)
          for i, (g, f) in enumerate([("Megan", "Hart"), ("Priya", "Rao"), ("Tom", "Bell")], 1)]
surgeons = {u: practitioner(f"pam-surgeon-{u.lower()}", g, f, "Dr")
            for u, (g, f) in zip(UNITS, [("Alan", "Pierce"), ("Sara", "Lowe"), ("Helen", "Ford"),
                                         ("Mark", "Stone"), ("Ian", "Cole")])}

# --- Patients -------------------------------------------------------------------------------

span = (LAST_REFERRAL - FIRST_REFERRAL).days
profiles = ["ida"] * 22 + ["id"] * 6 + ["acd"] * 5 + ["none"] * 7
rng.shuffle(profiles)
used_names = set()

for n in range(1, N_PATIENTS + 1):
    pid = f"pam-{n:03d}"
    profile = profiles[n - 1]
    unit = rng.choice(list(UNITS))
    sex = {"Gynaecology": "female", "Urology": "male"}.get(unit, rng.choice(["female", "male"]))
    while True:
        given = rng.choice(GIVEN_F if sex == "female" else GIVEN_M)
        family = rng.choice(FAMILY)
        if (given, family) not in used_names:
            used_names.add((given, family))
            break
    age = rng.randint(38, 86)
    # Most referrals spread over the reporting period; the last few are recent, so still being managed
    recent = n > N_PATIENTS - 9
    referral = TODAY - timedelta(days=rng.randint(3, 42)) if recent else FIRST_REFERRAL + timedelta(days=rng.randint(0, span - 45))
    birth = referral - timedelta(days=age * 365 + rng.randint(0, 364))
    suburb, postcode = rng.choice(SUBURBS)
    height = rng.randint(152, 172) if sex == "female" else rng.randint(165, 190)
    weight = round(rng.uniform(52, 95) if sex == "female" else rng.uniform(65, 115), 1)

    patient = add({
        "resourceType": "Patient", "id": pid,
        "identifier": [
            {"system": ID_SYS, "value": f"SYN{n:05d}"},
            # Clearly fake: real Medicare numbers never start with 0
            {"type": coding("http://terminology.hl7.org/CodeSystem/v2-0203", "MC", "Patient's Medicare number"),
             "system": "http://ns.electronichealth.net.au/id/medicare-number", "value": f"0{n:08d}1"},
        ],
        "name": [{"use": "official", "given": [given], "family": family}],
        "gender": sex, "birthDate": birth.isoformat(),
        "address": [{"use": "home", "city": suburb, "state": "QLD", "postalCode": postcode, "country": "AU"}],
    })

    def obs(oid, when, code, display, value, unit_code, unit_display, category="laboratory"):
        return add({
            "resourceType": "Observation", "id": f"{pid}-{oid}", "status": "final",
            "category": [coding("http://terminology.hl7.org/CodeSystem/observation-category", category,
                                "Laboratory" if category == "laboratory" else "Vital Signs")],
            "code": coding(LOINC, code, display), "subject": patient,
            "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": unit_display, "system": UCUM, "code": unit_code},
        })

    pre_admit = referral - timedelta(days=rng.randint(1, 10))
    obs("height", pre_admit, "8302-2", "Body height", height, "cm", "cm", "vital-signs")
    obs("weight", pre_admit, "29463-7", "Body weight", weight, "kg", "kg", "vital-signs")

    # Initial pathology consistent with the profile
    lo = 120 if sex == "female" else 130
    if profile == "ida":
        hb, ferritin, tsat, crp = rng.randint(lo - 32, lo - 4), rng.randint(6, 60), rng.randint(5, 18), rng.randint(1, 9)
    elif profile == "id":
        hb, ferritin, tsat, crp = rng.randint(lo + 2, lo + 18), rng.randint(10, 85), rng.randint(8, 19), rng.randint(1, 8)
    elif profile == "acd":
        hb, ferritin, tsat, crp = rng.randint(lo - 22, lo - 3), rng.randint(110, 280), rng.randint(10, 19), rng.randint(14, 60)
    else:
        hb, ferritin, tsat, crp = rng.randint(lo + 5, lo + 30), rng.randint(110, 350), rng.randint(22, 40), rng.randint(1, 8)
    initial = {"hb": hb, "ferritin": ferritin, "tsat": tsat, "crp": crp}
    for k, v in initial.items():
        code, display, ucode, udisp = LABS[k]
        obs(f"{k}-1", pre_admit, code, display, v, ucode, udisp)

    # Surgical waitlist entry and referral to blood management
    procedure = rng.choice(UNITS[unit])
    category = rng.choices(["1", "2", "3"], weights=[3, 5, 2])[0]
    surgery_date = referral + timedelta(days=rng.randint(28, 90))
    waitlist = add({
        "resourceType": "ServiceRequest", "id": f"{pid}-surgery", "status": "active", "intent": "order",
        "category": [local("elective-category", category, f"Category {category}")],
        "code": coding(SCT, *procedure), "subject": patient,
        "occurrenceDateTime": surgery_date.isoformat(), "authoredOn": (referral - timedelta(days=rng.randint(7, 60))).isoformat(),
        "requester": surgeons[unit], "performer": [unit_refs[unit]],
    })
    source = rng.choices(REFERRAL_SOURCES, weights=[5, 4, 2, 1])[0]
    referral_sr = add({
        "resourceType": "ServiceRequest", "id": f"{pid}-referral", "status": "completed", "intent": "order",
        "category": [local("referral-source", *source)],
        "code": coding(SCT, "3457005", "Patient referral"), "subject": patient,
        "authoredOn": referral.isoformat(), "requester": surgeons[unit], "performer": [service],
        "supportingInfo": [waitlist],
    } | ({"reasonCode": [coding(SCT, "271737000", "Anaemia")]} if profile != "none" else {}))

    # Diagnosis
    if profile != "none":
        add({
            "resourceType": "Condition", "id": f"{pid}-diagnosis",
            "clinicalStatus": coding("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active"),
            "verificationStatus": coding("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed"),
            "category": [coding("http://terminology.hl7.org/CodeSystem/condition-category", "encounter-diagnosis", "Encounter Diagnosis")],
            "code": coding(SCT, *DIAGNOSES[profile]), "subject": patient,
            "recordedDate": (referral + timedelta(days=2)).isoformat(),
        })

    # Treatment: IV iron for iron deficiency (with or without anaemia)
    treated = profile in ("ida", "id")
    treat_date = referral + timedelta(days=rng.randint(5, 14))
    if treated:
        dose = min(max(ganzoni(weight, hb), 500), 2000)
        product = rng.choices(IV_IRON, weights=[3, 1])[0]
        add({
            "resourceType": "MedicationRequest", "id": f"{pid}-iv-iron",
            "status": "completed", "intent": "order",
            "medicationCodeableConcept": coding(SCT, *product), "subject": patient,
            "authoredOn": treat_date.isoformat(), "requester": nurses[n % 3],
            "reasonReference": [{"reference": f"Condition/{pid}-diagnosis"}],
            "dosageInstruction": [{
                "text": f"{dose} mg IV (Ganzoni total iron deficit)",
                "route": coding(SCT, "47625008", "Intravenous route"),
                "doseAndRate": [{"doseQuantity": {"value": dose, "unit": "mg", "system": UCUM, "code": "mg"}}],
            }],
        })

    # Post-treatment pathology, if it has happened yet
    recheck = treat_date + timedelta(days=rng.randint(21, 35))
    finished = (treated or profile == "acd") and recheck <= TODAY and recheck < surgery_date + timedelta(days=7)
    if finished:
        post = {
            "hb": hb + (rng.randint(8, 28) if treated else rng.randint(-3, 6)),
            "ferritin": (ferritin + rng.randint(150, 450)) if treated else ferritin + rng.randint(-20, 30),
            "tsat": (tsat + rng.randint(8, 20)) if treated else tsat + rng.randint(-2, 4),
            "crp": max(1, crp + rng.randint(-5, 3)),
        }
        for k, v in post.items():
            code, display, ucode, udisp = LABS[k]
            obs(f"{k}-2", recheck, code, display, v, ucode, udisp)

    # Episode with the blood management team
    if profile == "none":
        status, end = "finished", referral + timedelta(days=rng.randint(1, 4))  # cleared on screening
    elif finished:
        status, end = "finished", recheck + timedelta(days=rng.randint(0, 3))
    else:
        status, end = "active", None
    episode = add({
        "resourceType": "EpisodeOfCare", "id": f"{pid}-episode", "status": status,
        "type": [local("episode-type", "pam", "Preoperative anaemia management")],
        "patient": patient, "managingOrganization": service,
        "period": {"start": referral.isoformat()} | ({"end": end.isoformat()} if end else {}),
        "referralRequest": [referral_sr], "careManager": nurses[n % 3],
    })

    # Follow-up task for patients still being managed
    if status == "active":
        due = max(recheck, TODAY + timedelta(days=rng.randint(1, 14)))
        add({
            "resourceType": "Task", "id": f"{pid}-follow-up", "status": "requested", "intent": "order",
            "code": local("task-type", "follow-up", "Follow up post-treatment bloods" if treated else "Review"),
            "focus": episode, "for": patient, "owner": nurses[n % 3],
            "authoredOn": referral.isoformat(),
            "restriction": {"period": {"end": due.isoformat()}},
        })

au_core_upgrade(entries)
bundle = {"resourceType": "Bundle", "type": "transaction", "entry": entries}
out = Path(__file__).with_name("pam-synthetic-bundle.json")
out.write_text(json.dumps(bundle, indent=1, ensure_ascii=False) + "\n")
counts = {}
for e in entries:
    counts[e["resource"]["resourceType"]] = counts.get(e["resource"]["resourceType"], 0) + 1
print(f"Wrote {out.name}: {len(entries)} resources", counts)
