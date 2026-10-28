#!/usr/bin/env python3
"""Synthetic test data for scenario A2 (GP details) -> testdata-bundle.json.

A test patient with three different doctors, one per pre-population source:

* GP on record (Patient.generalPractitioner)  -> Dr Ruth Ambrose, Chermside Family Practice
* Referring doctor (latest referral to the blood management service, ServiceRequest.requester)
                                               -> Dr Lucy Tran, Aspley Road Surgery
* GP recorded on the latest admission (Encounter.participant typed "General practitioner")
                                               -> Dr Omar Haddad, Kedron Medical Centre

plus soln-A2-patient-2, who has no GP at all (tests the "add" branch of the PATCH).
Every id starts with soln-A2-. All people and organisations are fictional.

    python3 testdata.py && ./load.sh
"""
import json
from pathlib import Path

SCT = "http://snomed.info/sct"
PROVIDER_NO = "http://ns.electronichealth.net.au/id/medicare-provider-number"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
entries = []


def add(r):
    entries.append({"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}})
    return {"reference": f"{r['resourceType']}/{r['id']}"}


def gp(key, given, family, provider_no, practice, suburb, postcode, phone):
    org = add({"resourceType": "Organization", "id": f"soln-A2-practice-{key}",
               "name": f"{practice} (synthetic)",
               "telecom": [{"system": "phone", "value": phone, "use": "work"}],
               "address": [{"use": "work", "line": [f"1 Test Street"], "city": suburb, "state": "QLD",
                            "postalCode": postcode, "country": "AU"}]})
    prac = add({"resourceType": "Practitioner", "id": f"soln-A2-gp-{key}",
                "identifier": [{"system": PROVIDER_NO, "value": provider_no}],
                "name": [{"use": "official", "prefix": ["Dr"], "given": [given], "family": family}]})
    role = add({"resourceType": "PractitionerRole", "id": f"soln-A2-role-{key}", "active": True,
                "practitioner": {**prac, "display": f"Dr {given} {family}"},
                "organization": {**org, "display": f"{practice} (synthetic)"},
                "code": [{"coding": [{"system": SCT, "code": "62247001", "display": "General practitioner"}]}],
                "telecom": [{"system": "phone", "value": phone, "use": "work"}]})
    return role


ambrose = gp("ambrose", "Ruth", "Ambrose", "0000001A", "Chermside Family Practice", "Chermside", "4032", "07 3000 0101")
haddad = gp("haddad", "Omar", "Haddad", "0000002B", "Kedron Medical Centre", "Kedron", "4031", "07 3000 0202")
tran = gp("tran", "Lucy", "Tran", "0000003C", "Aspley Road Surgery", "Aspley", "4034", "07 3000 0303")
attending = add({"resourceType": "Practitioner", "id": "soln-A2-dr-attending",
                 "name": [{"use": "official", "prefix": ["Dr"], "given": ["Peter"], "family": "Attending"}]})

p1 = add({"resourceType": "Patient", "id": "soln-A2-patient-1",
          "name": [{"use": "official", "given": ["Gina"], "family": "Testgp"}],
          "gender": "female", "birthDate": "1958-03-14",
          "generalPractitioner": [{**ambrose, "display": "Dr Ruth Ambrose"}]})
add({"resourceType": "Patient", "id": "soln-A2-patient-2",
     "name": [{"use": "official", "given": ["Noel"], "family": "Nogp"}],
     "gender": "male", "birthDate": "1949-11-02"})

add({"resourceType": "ServiceRequest", "id": "soln-A2-patient-1-referral", "status": "completed",
     "intent": "order",
     "category": [{"coding": [{"system": f"{LOCAL}/referral-source", "code": "gp", "display": "General practitioner"}]}],
     "code": {"coding": [{"system": SCT, "code": "3457005", "display": "Patient referral"}]},
     "subject": p1, "authoredOn": "2026-10-01", "requester": {**tran, "display": "Dr Lucy Tran"}})

add({"resourceType": "Encounter", "id": "soln-A2-patient-1-admission", "status": "finished",
     "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP", "display": "inpatient encounter"},
     "subject": p1, "period": {"start": "2026-08-10", "end": "2026-08-14"},
     "participant": [
         {"type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                "code": "ATND", "display": "attender"}]}],
          "individual": {**attending, "display": "Dr Peter Attending"}},
         {"type": [{"coding": [{"system": SCT, "code": "62247001", "display": "General practitioner"}]}],
          "individual": {**haddad, "display": "Dr Omar Haddad"}},
     ]})

out = Path(__file__).with_name("testdata-bundle.json")
out.write_text(json.dumps({"resourceType": "Bundle", "type": "transaction", "entry": entries}, indent=1) + "\n")
print(f"Wrote {out.name}: {len(entries)} resources")
