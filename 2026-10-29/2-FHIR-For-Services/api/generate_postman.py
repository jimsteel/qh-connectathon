#!/usr/bin/env python3
"""Generate the Track 2 Postman collection + environments.

Edit this file, never the generated JSON. Run:  python3 -I generate_postman.py
Writes QH-Track2.postman_collection.json and QH-Track2-{public,incluster}.postman_environment.json
next to this script.
"""
import json
import pathlib
from urllib.parse import urlsplit

HERE = pathlib.Path(__file__).parent  # outputs land here; build.sh moves them to downloads/
IG = "http://aehrc.csiro.au/fhir/radiology-referral/StructureDefinition"
SNOMED = "http://snomed.info/sct"
HPIO = "http://ns.electronichealth.net.au/id/hi/hpio/1.0"
TAG_SYS = "urn:qh-connectathon:postman"
FHIR = "application/fhir+json"


def url(raw):
    """Postman url object from a raw string that starts with a {{variable}} base."""
    if "/" not in raw:
        return raw  # a bare {{variable}} holding a full URL
    base, _, qs = raw.partition("?")
    parts = base.split("/")
    q = []
    for kv in filter(None, qs.split("&")):
        k, _, v = kv.partition("=")
        q.append({"key": k, "value": v})
    out = {"raw": raw, "host": [parts[0]], "path": parts[1:]}
    if q:
        out["query"] = q
    return out


def req(name, method, raw, desc, body=None, ctype=FHIR, tests=None, prereq=None, headers=None):
    r = {"method": method, "header": [], "url": url(raw), "description": desc}
    if method in ("POST", "PUT", "PATCH"):
        r["header"].append({"key": "Content-Type", "value": ctype})
    for k, v in (headers or {}).items():
        r["header"].append({"key": k, "value": v})
    if body is not None:
        raw_body = body if isinstance(body, str) else json.dumps(body, indent=2)
        r["body"] = {"mode": "raw", "raw": raw_body, "options": {"raw": {"language": "json"}}}
    item = {"name": name, "request": r, "event": []}
    if prereq:
        item["event"].append({"listen": "prerequest", "script": {"type": "text/javascript", "exec": prereq}})
    if tests:
        item["event"].append({"listen": "test", "script": {"type": "text/javascript", "exec": tests}})
    if not item["event"]:
        del item["event"]
    return item


def folder(name, desc, items):
    return {"name": name, "description": desc, "item": items}


def status_test(*codes, extra=()):
    lines = [f"pm.test('status is one of {list(codes)}', () => pm.expect({list(codes)}).to.include(pm.response.code));"]
    lines += list(extra)
    return lines


def bundle_test(min_entries=1):
    return [
        "pm.test('searchset Bundle', () => {",
        "  const b = pm.response.json();",
        "  pm.expect(b.resourceType).to.eql('Bundle');",
        "  pm.expect(b.type).to.eql('searchset');",
        f"  pm.expect((b.entry || []).length).to.be.least({min_entries});",
        "});",
    ]


def patch(*ops):
    return json.dumps(list(ops), indent=2)


# --------------------------------------------------------------------------------------------
# 1. Directory
# --------------------------------------------------------------------------------------------
D = "{{directoryUrl}}"
directory = folder(
    "1 Discover (Provider Directory)",
    "Scenario step 1, test cases D-01 to D-03 and X-01. Targets the **directory** server (`{{directoryUrl}}`). "
    "Every request carries `X-Request-ID` (set by the collection pre-request script). "
    "Search parameters are Day-1 assumptions until the ADHA HCPD technical specification is published.",
    [
        req("D-01 Search imaging services (CT, QLD)", "GET",
            f"{D}/HealthcareService?service-type={SNOMED}|310128004&location.address-state=QLD"
            "&_include=HealthcareService:location&_include=HealthcareService:organization&_count=10",
            "Find CT services in Queensland and bring back the Location and Organization in the same Bundle. "
            "310128004 = Computed tomography service. Saves the first HealthcareService id for the next requests.",
            tests=bundle_test() + [
                "const hs = pm.response.json().entry.map(e => e.resource).find(r => r.resourceType === 'HealthcareService');",
                "if (hs) { pm.collectionVariables.set('healthcareServiceId', hs.id);",
                "  pm.collectionVariables.set('organizationId', hs.providedBy.reference.split('/')[1]); }",
            ]),
        req("D-01 Paging (_count=2, follow Bundle.link next)", "GET",
            f"{D}/HealthcareService?service-type={SNOMED}|310128004&_count=2",
            "Request a small page, then copy `Bundle.link[relation=next].url` into your client. "
            "The test stores the next link in `{{nextPageUrl}}`; use the 'Follow next link' request.",
            tests=bundle_test() + [
                "const nxt = (pm.response.json().link || []).find(l => l.relation === 'next');",
                "pm.test('has a next link', () => pm.expect(nxt).to.exist);",
                "if (nxt) pm.collectionVariables.set('nextPageUrl', nxt.url);",
            ]),
        req("D-01 Follow next link", "GET", "{{nextPageUrl}}",
            "Follows the `next` link saved by the previous request.", tests=bundle_test()),
        req("D-02 Resolve service, organization and endpoints", "GET",
            f"{D}/HealthcareService?_id={{{{healthcareServiceId}}}}&_include=HealthcareService:endpoint"
            "&_include=HealthcareService:organization&_include=HealthcareService:location",
            "One round trip from the chosen HealthcareService to its Organization, Location and **Endpoint** resources. "
            "Read `Endpoint.address` and `Endpoint.payloadType` to learn how to reach the receiving server. "
            "Note: the seeded `Endpoint.address` values are in-cluster URLs (`*.svc.cluster.local`), "
            "so use the public referral URL from the environment instead.",
            tests=bundle_test() + [
                "pm.test('an Endpoint came back', () =>",
                "  pm.expect(pm.response.json().entry.some(e => e.resource.resourceType === 'Endpoint')).to.be.true);",
            ]),
        req("D-02 Organization with its endpoints", "GET",
            f"{D}/Organization?_id={{{{organizationId}}}}&_include=Organization:endpoint",
            "Endpoint has no `organization` search parameter in R4. Reach it through the owning resource with `_include`."),
        req("D-02 Locations in a town, with their services", "GET",
            f"{D}/Location?address-city=Cairns&_revinclude=HealthcareService:location",
            "Location search by town, with every HealthcareService that is delivered there."),
        req("D-03 Referrer PractitionerRole (HPI-I / HPI-O)", "GET",
            f"{D}/PractitionerRole?organization=Organization/{{{{organizationId}}}}"
            "&_include=PractitionerRole:practitioner&_include=PractitionerRole:organization",
            "Look up practitioner roles for an organisation. HPI-I is on the Practitioner identifier, HPI-O on the Organization identifier.",
            tests=bundle_test()),
        req("X-01 (stretch) Bulk export kick-off", "GET",
            f"{D}/$export?_type=HealthcareService&_typeFilter=HealthcareService%3Fservice-type%3D310128004"
            "&_outputFormat=application/fhir%2Bndjson",
            "Asynchronous bulk export of the CT services. Expect `202 Accepted` with a `Content-Location` header. "
            "The test saves it in `{{exportStatusUrl}}`.",
            headers={"Prefer": "respond-async", "Accept": "application/fhir+json"},
            tests=status_test(202, extra=[
                "const loc = pm.response.headers.get('Content-Location');",
                "if (loc) pm.collectionVariables.set('exportStatusUrl', loc);",
            ])),
        req("X-01 (stretch) Poll export status", "GET", "{{exportStatusUrl}}",
            "`202` while running (honour `Retry-After`), `200` with an `output[].url` list when finished. "
            "Download each `url` as NDJSON.", tests=status_test(200, 202)),
    ],
)

# --------------------------------------------------------------------------------------------
# 2. Referral
# --------------------------------------------------------------------------------------------
R = "{{referralUrl}}"
PGN_SYS = "http://aehrc.csiro.au/fhir/radiology-referral/sid/placer-group-number"
PGN_TYPE = {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "PGN"}]}
TAG = {"system": TAG_SYS, "code": "{{runId}}"}

referral_bundle = {
    "resourceType": "Bundle",
    "type": "transaction",
    "entry": [
        {"fullUrl": "urn:uuid:11111111-0000-4000-8000-000000000001",
         "resource": {"resourceType": "Patient", "meta": {"tag": [TAG]},
                      "identifier": [{"system": "urn:qh-connectathon:postman-patient", "value": "{{runId}}"}],
                      "name": [{"family": "Postmantest", "given": ["Fictional"]}],
                      "gender": "other", "birthDate": "1968-04-02"},
         "request": {"method": "POST", "url": "Patient"}},
        {"fullUrl": "urn:uuid:11111111-0000-4000-8000-000000000002",
         "resource": {"resourceType": "Observation", "meta": {"tag": [TAG]}, "status": "final",
                      "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
                      "code": {"coding": [{"system": "http://loinc.org", "code": "98979-8"}], "text": "eGFR"},
                      "subject": {"reference": "urn:uuid:11111111-0000-4000-8000-000000000001"},
                      "effectiveDateTime": "{{today}}",
                      "valueQuantity": {"value": 82, "unit": "mL/min/1.73m2", "system": "http://unitsofmeasure.org", "code": "mL/min/{1.73_m2}"}},
         "request": {"method": "POST", "url": "Observation"}},
        {"fullUrl": "urn:uuid:11111111-0000-4000-8000-000000000003",
         "resource": {"resourceType": "ServiceRequest", "meta": {"profile": [f"{IG}/referral-servicerequest"], "tag": [TAG]},
                      "identifier": [{"system": PGN_SYS, "value": "{{runId}}-1"}],
                      "requisition": {"type": PGN_TYPE, "system": PGN_SYS, "value": "{{runId}}"},
                      "status": "active", "intent": "order",
                      "category": [{"coding": [{"system": SNOMED, "code": "3457005", "display": "Patient referral"}]},
                                   {"coding": [{"system": SNOMED, "code": "363679005", "display": "Imaging"}]}],
                      "priority": "routine",
                      "code": {"coding": [{"system": SNOMED, "code": "432370003", "display": "CT of abdomen and pelvis with contrast"}],
                               "text": "CT abdomen and pelvis with contrast"},
                      "subject": {"reference": "urn:uuid:11111111-0000-4000-8000-000000000001"},
                      "authoredOn": "{{now}}",
                      "requester": {"reference": "PractitionerRole/qhc-role-1", "display": "Dr Chen"},
                      "performer": [{"reference": "Organization/qhc-org-fill1", "type": "Organization",
                                     "identifier": {"system": HPIO, "value": "8003629999000017"},
                                     "display": "Tropic Coast Health Service"}],
                      "supportingInfo": [{"reference": "urn:uuid:11111111-0000-4000-8000-000000000002"}],
                      "note": [{"text": "Created from the Track 2 Postman collection. Fictional data."}]},
         "request": {"method": "POST", "url": "ServiceRequest"}},
        {"fullUrl": "urn:uuid:11111111-0000-4000-8000-000000000004",
         "resource": {"resourceType": "Task",
                      "meta": {"profile": ["http://hl7.org.au/fhir/ereq/StructureDefinition/au-erequesting-task-group"], "tag": [TAG]},
                      "groupIdentifier": {"type": PGN_TYPE, "system": PGN_SYS, "value": "{{runId}}"},
                      "status": "requested", "intent": "order",
                      "code": {"coding": [{"system": "http://hl7.org/fhir/CodeSystem/task-code", "code": "fulfill"}]},
                      "for": {"reference": "urn:uuid:11111111-0000-4000-8000-000000000001"},
                      "authoredOn": "{{now}}",
                      "requester": {"reference": "PractitionerRole/qhc-role-1"},
                      "owner": {"reference": "Organization/qhc-org-fill1"}},
         "request": {"method": "POST", "url": "Task"}},
        {"fullUrl": "urn:uuid:11111111-0000-4000-8000-000000000005",
         "resource": {"resourceType": "Task",
                      "meta": {"profile": [f"{IG}/referral-task"],
                               "tag": [TAG, {"system": "http://terminology.hl7.org.au/CodeSystem/resource-tag", "code": "fulfilment-task"}]},
                      "identifier": [{"system": PGN_SYS, "value": "{{runId}}-1"}],
                      "groupIdentifier": {"type": PGN_TYPE, "system": PGN_SYS, "value": "{{runId}}"},
                      "partOf": [{"reference": "urn:uuid:11111111-0000-4000-8000-000000000004"}],
                      "status": "requested", "intent": "order", "priority": "routine",
                      "code": {"coding": [{"system": "http://hl7.org/fhir/CodeSystem/task-code", "code": "fulfill"}]},
                      "focus": {"reference": "urn:uuid:11111111-0000-4000-8000-000000000003"},
                      "for": {"reference": "urn:uuid:11111111-0000-4000-8000-000000000001"},
                      "authoredOn": "{{now}}",
                      "requester": {"reference": "PractitionerRole/qhc-role-1"},
                      "owner": {"reference": "Organization/qhc-org-fill1"}},
         "request": {"method": "POST", "url": "Task"}},
    ],
}

SAVE_CREATED = [
    "const out = pm.response.json();",
    "const loc = {};",
    "(out.entry || []).forEach(e => { const [t, id] = e.response.location.split('/_history')[0].split('/').slice(-2); loc[t] = loc[t] || []; loc[t].push(id); });",
    "pm.test('all resources created', () => pm.expect(Object.keys(loc)).to.include.members(['Patient', 'ServiceRequest', 'Task']));",
    "pm.collectionVariables.set('patientId', loc.Patient[0]);",
    "pm.collectionVariables.set('observationId', loc.Observation[0]);",
    "// remembered separately so folder 9 can only ever delete what this run created, never seeded data",
    "pm.collectionVariables.set('createdPatientId', loc.Patient[0]);",
    "pm.collectionVariables.set('createdObservationId', loc.Observation[0]);",
    "pm.collectionVariables.set('createdServiceRequestId', loc.ServiceRequest[0]);",
    "pm.collectionVariables.set('createdGroupTaskId', loc.Task[0]);",
    "pm.collectionVariables.set('createdTaskId', loc.Task[1]);",
    "pm.collectionVariables.set('serviceRequestId', loc.ServiceRequest[0]);",
    "// the second Task in the Bundle is the fulfilment Task",
    "pm.collectionVariables.set('groupTaskId', loc.Task[0]);",
    "pm.collectionVariables.set('taskId', loc.Task[1]);",
]

referral = folder(
    "2 Create the referral (Referral Server)",
    "Scenario step 2, test cases R-01 and R-02. Targets the **referral** server (`{{referralUrl}}`).",
    [
        req("Capability statement", "GET", f"{R}/metadata?_summary=true",
            "Smoke check that the referral server is up and shows its FHIR version.", tests=status_test(200)),
        req("R-01 Create the referral (transaction Bundle)", "POST", f"{R}",
            "One transaction creating Patient, eGFR Observation, ServiceRequest, the Group Task and the fulfilment Task, "
            "linked with `urn:uuid:` references. The referrer is `PractitionerRole/qhc-role-1` and the receiving service "
            "is the seeded Tropic Coast Health Service. All resources are tagged with `{{runId}}` so you can clean up. "
            "The ids of what was created are saved to collection variables for the following requests.",
            body=referral_bundle, tests=status_test(200, 201, extra=SAVE_CREATED)),
        req("R-01 Validate the ServiceRequest against the IG", "POST", f"{R}/ServiceRequest/$validate",
            "Asks the server to validate a ServiceRequest against `referral-servicerequest`. "
            "Errors fail the test; warnings are fine. (Tip: the profile is claimed in `meta.profile`.)",
            body={"resourceType": "ServiceRequest", "meta": {"profile": [f"{IG}/referral-servicerequest"]},
                  "identifier": [{"system": PGN_SYS, "value": "validate-1"}],
                  "requisition": {"type": PGN_TYPE, "system": PGN_SYS, "value": "validate"},
                  "status": "active", "intent": "order",
                  "category": [{"coding": [{"system": SNOMED, "code": "3457005"}]}, {"coding": [{"system": SNOMED, "code": "363679005"}]}],
                  "priority": "routine",
                  "code": {"coding": [{"system": SNOMED, "code": "432370003"}]},
                  "subject": {"reference": "Patient/qhc-pat-01"}, "authoredOn": "{{now}}",
                  "requester": {"reference": "PractitionerRole/qhc-role-1"}},
            tests=status_test(200, extra=[
                "const errs = (pm.response.json().issue || []).filter(i => ['error', 'fatal'].includes(i.severity));",
                "pm.test('no validation errors', () => pm.expect(errs.map(i => i.diagnostics)).to.eql([]));",
            ])),
        req("R-02 Referral with its supporting information", "GET",
            f"{R}/ServiceRequest?_id={{{{serviceRequestId}}}}&_include=ServiceRequest:supporting-info&_include=ServiceRequest:patient",
            "Reads back the referral you created, with the eGFR Observation and Patient in the same Bundle. "
            "A contrast study should always carry an eGFR.",
            tests=bundle_test() + [
                "pm.test('eGFR Observation is present', () =>",
                "  pm.expect(pm.response.json().entry.some(e => e.resource.resourceType === 'Observation')).to.be.true);",
            ]),
        req("Browse the seeded referrals", "GET", f"{R}/ServiceRequest?status=active&_count=10&_sort=-_lastUpdated",
            "The server is pre-loaded with 22 fictional referrals for 20 patients. Use these if you only want to read.",
            tests=bundle_test()),
    ],
)

# --------------------------------------------------------------------------------------------
# 3. Filler triage
# --------------------------------------------------------------------------------------------
triage = folder(
    "3 Triage (Imaging Provider / filler)",
    "Scenario step 3, test cases T-01 and T-02. The filler finds new work and moves the Task through its states. "
    "These use JSON Patch so you do not need to resend the whole Task.",
    [
        req("T-01 Find new work for a filler", "GET",
            f"{R}/Task?owner={{{{fillerOrgId}}}}&status=requested&_include=Task:focus",
            "New Tasks for one filler organisation, with the focus ServiceRequest. Seeded filler: `qhc-org-fill1`. "
            "Note: the Group Task has no `focus`; the fulfilment Task does.", tests=bundle_test()),
        req("T-02 Accept the Task", "PATCH", f"{R}/Task/{{{{taskId}}}}",
            "Task `requested` to `accepted`. Run request R-01 first so `{{taskId}}` is set.",
            body=patch({"op": "replace", "path": "/status", "value": "accepted"}),
            ctype="application/json-patch+json",
            tests=status_test(200, extra=["pm.test('accepted', () => pm.expect(pm.response.json().status).to.eql('accepted'));"])),
        req("T-02 Put on hold with a coded reason", "PATCH", f"{R}/Task/{{{{taskId}}}}",
            "Variant: `on-hold` with a `statusReason`, as in the contrast-allergy storyline "
            "('contrast allergy, please confirm'). Resend the Accept request afterwards to continue the flow.",
            body=patch({"op": "replace", "path": "/status", "value": "on-hold"},
                       {"op": "add", "path": "/statusReason",
                        "value": {"coding": [{"system": SNOMED, "code": "293637006", "display": "Allergy to contrast media"}],
                                  "text": "Contrast allergy: please confirm with the patient before booking"}}),
            ctype="application/json-patch+json",
            tests=status_test(200, extra=["pm.test('on-hold', () => pm.expect(pm.response.json().status).to.eql('on-hold'));"])),
        req("T-02 Reject with a reason", "PATCH", f"{R}/Task/{{{{taskId}}}}",
            "Variant: `rejected`. Use on a throwaway referral, because a rejected Task is final.",
            body=patch({"op": "replace", "path": "/status", "value": "rejected"},
                       {"op": "add", "path": "/statusReason", "value": {"text": "Service does not offer this study"}}),
            ctype="application/json-patch+json", tests=status_test(200)),
    ],
)

# --------------------------------------------------------------------------------------------
# 4. Availability and booking
# --------------------------------------------------------------------------------------------
SCHED_ID = "pm-{{runId}}-sched"
SLOT_ID = "pm-{{runId}}-slot"
SLOT2_ID = "pm-{{runId}}-slot2"
CT = [{"coding": [{"system": SNOMED, "code": "310128004", "display": "Computed tomography service"}]}]


def slot(sid, start, end):
    return {"resourceType": "Slot", "id": sid, "meta": {"profile": [f"{IG}/booking-slot"], "tag": [TAG]},
            "serviceType": CT, "schedule": {"reference": f"Schedule/{SCHED_ID}"}, "status": "free",
            "start": start, "end": end}


appointment = {
    "resourceType": "Appointment", "meta": {"profile": [f"{IG}/referral-appointment"], "tag": [TAG]},
    "status": "proposed", "serviceType": CT, "created": "{{today}}",
    "start": "{{slotStart}}", "end": "{{slotEnd}}",
    "slot": [{"reference": "Slot/{{slotId}}"}],
    "basedOn": [{"reference": "ServiceRequest/{{serviceRequestId}}"}],
    "participant": [
        {"actor": {"reference": "Patient/{{patientId}}"}, "status": "accepted"},
        {"actor": {"reference": "HealthcareService/qhc-hcs-f1-ct"}, "status": "accepted"},
    ],
}

booking = folder(
    "4 Availability and booking",
    "Scenario steps 4 and 5, test cases B-01 to B-04. Run **2 Create the referral** first. "
    "The server does **not** stop two Appointments being created against one Slot, so a booking client must "
    "re-read the Slot and check `status=free` immediately before it books (see B-03).",
    [
        req("B-01 Filler publishes a Schedule", "PUT", f"{R}/Schedule/{SCHED_ID}",
            "A Schedule for a CT service. Uses a client-assigned id so the call is idempotent.",
            body={"resourceType": "Schedule", "id": SCHED_ID, "meta": {"profile": [f"{IG}/booking-schedule"], "tag": [TAG]},
                  "active": True, "serviceType": CT,
                  "actor": [{"reference": "HealthcareService/qhc-hcs-f1-ct", "display": "Cairns CT"}],
                  "planningHorizon": {"start": "{{now}}", "end": "{{in30Days}}"}},
            tests=status_test(200, 201)),
        req("B-01 Filler publishes a free Slot", "PUT", f"{R}/Slot/{SLOT_ID}",
            "A 30 minute free Slot, one week from now.", body=slot(SLOT_ID, "{{slotStart}}", "{{slotEnd}}"),
            prereq=[
                "const d = new Date(); d.setUTCDate(d.getUTCDate() + 7); d.setUTCHours(0, 0, 0, 0);",
                "const iso = h => new Date(d.getTime() + h * 3600e3).toISOString();",
                "pm.collectionVariables.set('slotStart', iso(9));",
                "pm.collectionVariables.set('slotEnd', iso(9.5));",
                "pm.collectionVariables.set('slotId', 'pm-' + pm.collectionVariables.get('runId') + '-slot');",
            ],
            tests=status_test(200, 201)),
        req("B-01 Referrer searches free Slots", "GET",
            f"{R}/Slot?schedule=Schedule/{SCHED_ID}&status=free&start=ge{{{{today}}}}&service-type={SNOMED}|310128004",
            "Free Slots for the schedule, from today, by service type. "
            "To search a seeded provider instead use `schedule=Schedule/qhc-sched-f1-ct` "
            "or `schedule.actor=HealthcareService/qhc-hcs-f1-ct` (seeded slots are free on 4 and 5 Nov 2026).",
            tests=bundle_test()),
        req("B-02 Referrer proposes an Appointment", "POST", f"{R}/Appointment",
            "Creates a `proposed` Appointment on the Slot, linked to the ServiceRequest through `basedOn`.",
            body=appointment,
            tests=status_test(201, extra=[
                "pm.collectionVariables.set('appointmentId', pm.response.json().id);",
                "pm.collectionVariables.set('createdAppointmentId', pm.response.json().id);",
            ])),
        req("B-02 Filler confirms: Appointment booked", "PATCH", f"{R}/Appointment/{{{{appointmentId}}}}",
            "Appointment `proposed` to `booked`.",
            body=patch({"op": "replace", "path": "/status", "value": "booked"}),
            ctype="application/json-patch+json", tests=status_test(200)),
        req("B-02 Filler confirms: Slot busy", "PATCH", f"{R}/Slot/{{{{slotId}}}}",
            "Slot `free` to `busy`. This is the filler's job; the server does not do it for you.",
            body=patch({"op": "replace", "path": "/status", "value": "busy"}),
            ctype="application/json-patch+json", tests=status_test(200)),
        req("B-02 Filler confirms: Task in-progress / booked", "PATCH", f"{R}/Task/{{{{taskId}}}}",
            "Task to `in-progress` with business status `service-booked`. If you ran an on-hold or reject request, "
            "re-run **R-01** for a fresh Task.",
            body=patch({"op": "replace", "path": "/status", "value": "in-progress"},
                       {"op": "add", "path": "/businessStatus",
                        "value": {"coding": [{"system": "http://terminology.hl7.org.au/CodeSystem/task-business-status", "code": "service-booked"}]}}),
            ctype="application/json-patch+json", tests=status_test(200)),
        req("B-03 Check the Slot before booking (taken Slot)", "GET", f"{R}/Slot/{{{{slotId}}}}",
            "After B-02 the Slot is `busy`. A well behaved referrer reads it and stops here. "
            "Creating a second Appointment against this Slot would currently succeed (no server-side conflict check), "
            "so the check belongs in your client.",
            tests=status_test(200, extra=["pm.test('slot is busy', () => pm.expect(pm.response.json().status).to.eql('busy'));"])),
        req("B-04 Cancel the Appointment", "PATCH", f"{R}/Appointment/{{{{appointmentId}}}}",
            "Appointment to `cancelled`, with a cancellation reason.",
            body=patch({"op": "replace", "path": "/status", "value": "cancelled"},
                       {"op": "add", "path": "/cancelationReason", "value": {"text": "Patient requested a different time"}}),
            ctype="application/json-patch+json", tests=status_test(200)),
        req("B-04 Free the Slot again", "PATCH", f"{R}/Slot/{{{{slotId}}}}",
            "Slot back to `free`.", body=patch({"op": "replace", "path": "/status", "value": "free"}),
            ctype="application/json-patch+json", tests=status_test(200)),
        req("B-04 Rebook on a second Slot", "PUT", f"{R}/Slot/{SLOT2_ID}",
            "Publishes a second free Slot an hour later; then re-run **B-02 Referrer proposes an Appointment** after "
            "pointing `{{slotId}}` at it (set it in the collection variables).",
            body=slot(SLOT2_ID, "{{slot2Start}}", "{{slot2End}}"),
            prereq=[
                "const s = new Date(pm.collectionVariables.get('slotStart'));",
                "pm.collectionVariables.set('slot2Start', new Date(s.getTime() + 3600e3).toISOString());",
                "pm.collectionVariables.set('slot2End', new Date(s.getTime() + 5400e3).toISOString());",
            ],
            tests=status_test(200, 201)),
    ],
)

# --------------------------------------------------------------------------------------------
# 5. Track
# --------------------------------------------------------------------------------------------
track = folder(
    "5 Track status",
    "Scenario step 6, test case S-01. The referrer reads the Task and Appointment and displays status and businessStatus.",
    [
        req("S-01 Task state for the referral", "GET", f"{R}/Task?focus=ServiceRequest/{{{{serviceRequestId}}}}",
            "The fulfilment Task for the referral. After the B-02 confirmations it reads `in-progress` / `service-booked`.",
            tests=bundle_test()),
        req("S-01 Appointments for the referral", "GET", f"{R}/Appointment?based-on=ServiceRequest/{{{{serviceRequestId}}}}",
            "All Appointments raised against the referral, any status."),
        req("S-01 Seeded example: booked appointments", "GET", f"{R}/Appointment?status=booked&_count=5",
            "Read-only: appointments already booked in the seed data (`qhc-appt-*`).", tests=bundle_test()),
    ],
)

summary = folder(
    "6 Patient summary",
    "Stretch, test case P-01. The Referral Server produces an AU Patient Summary (AU PS) document on demand with "
    "`Patient/[id]/$summary` (HAPI IPS module with the AU PS plugin). Seeded patients 01, 02, 04 to 07, 10 to 13 and 17 to 20 "
    "carry conditions, allergies, medications, procedures and results; the others return placeholder sections.",
    [
        req("P-01 Patient summary (rich history)", "GET", f"{R}/Patient/qhc-pat-01/$summary",
            "AU PS document for a seeded patient with history. The first call after a server restart can take around ten seconds.",
            tests=[
                "pm.test('AU PS document Bundle', () => {",
                "  const b = pm.response.json();",
                "  pm.expect(pm.response.code).to.eql(200);",
                "  pm.expect(b.resourceType).to.eql('Bundle');",
                "  pm.expect(b.type).to.eql('document');",
                "  pm.expect(b.meta.profile).to.include('http://hl7.org.au/fhir/ps/StructureDefinition/au-ps-bundle');",
                "  pm.expect(b.entry[0].resource.resourceType).to.eql('Composition');",
                "});",
                "pm.test('required sections and seeded history present', () => {",
                "  const sections = pm.response.json().entry[0].resource.section.map(s => s.title);",
                "  ['Allergies and Intolerances', 'Medication List', 'Problem List'].forEach(t => pm.expect(sections).to.include(t));",
                "  const types = pm.response.json().entry.map(e => e.resource.resourceType);",
                "  ['Condition', 'AllergyIntolerance', 'MedicationRequest'].forEach(t => pm.expect(types).to.include(t));",
                "});",
            ]),
        req("P-01 Patient summary (no history: placeholders)", "GET", f"{R}/Patient/qhc-pat-03/$summary",
            "A seeded patient with no clinical history: the required sections are still present, each with one generated 'no information' entry.",
            tests=status_test(200, extra=[
                "pm.test('required sections still present', () => {",
                "  const sections = pm.response.json().entry[0].resource.section.map(s => s.title);",
                "  ['Allergies and Intolerances', 'Medication List', 'Problem List'].forEach(t => pm.expect(sections).to.include(t));",
                "});",
            ])),
    ],
)

cleanup = folder(
    "9 Clean up",
    "Deletes everything this run created, by id (the server refuses a conditional delete that matches more than one "
    "resource). Run it after a full pass. A 400 or 404 only means that item was never created or is already gone.",
    [
        req(f"Delete {label}", "DELETE", f"{R}/{path}", f"Deletes {label}.", tests=status_test(200, 204, 400, 404))
        for label, path in (
            ("Appointment", "Appointment/{{createdAppointmentId}}"),
            ("second Slot", "Slot/pm-{{runId}}-slot2"),
            ("Slot", "Slot/pm-{{runId}}-slot"),
            ("Schedule", "Schedule/pm-{{runId}}-sched"),
            ("fulfilment Task", "Task/{{createdTaskId}}"),
            ("Group Task", "Task/{{createdGroupTaskId}}"),
            ("ServiceRequest", "ServiceRequest/{{createdServiceRequestId}}"),
            ("eGFR Observation", "Observation/{{createdObservationId}}"),
            ("Patient", "Patient/{{createdPatientId}}"),
        )
    ],
)

COLLECTION_PRE = [
    "// Every directory request must carry X-Request-ID (UUID v4); sending it everywhere is harmless.",
    "pm.request.headers.upsert({ key: 'X-Request-ID', value: pm.variables.replaceIn('{{$guid}}') });",
    "pm.request.headers.upsert({ key: 'Accept', value: 'application/fhir+json' });",
    "const c = pm.collectionVariables;",
    "if (!c.get('runId')) c.set('runId', 'pm' + Date.now().toString(36));",
    "const now = new Date();",
    "c.set('now', now.toISOString());",
    "c.set('today', now.toISOString().slice(0, 10));",
    "c.set('in30Days', new Date(now.getTime() + 30 * 864e5).toISOString());",
]

VARS = {
    "runId": "", "now": "", "today": "", "in30Days": "",
    "healthcareServiceId": "qhd-hcs-01", "organizationId": "qhd-org-01",
    "fillerOrgId": "qhc-org-fill1",
    "patientId": "qhc-pat-01", "serviceRequestId": "qhc-sr-0001", "taskId": "qhc-task-0001", "groupTaskId": "qhc-taskgroup-0001",
    "slotId": "", "slotStart": "", "slotEnd": "", "slot2Start": "", "slot2End": "",
    "appointmentId": "", "createdPatientId": "", "createdObservationId": "", "createdServiceRequestId": "", "createdGroupTaskId": "", "createdTaskId": "", "createdAppointmentId": "", "observationId": "qhc-egfr-0001", "nextPageUrl": "", "exportStatusUrl": "",
}

collection = {
    "info": {
        "name": "QH Connectathon Track 2: Radiology Referral",
        "description": (
            "Requests for the FHIR in Queensland Health Connectathon, Track 2 (FHIR for Services): "
            "discover an imaging service, create a referral, triage, book and track.\n\n"
            "1. Import this collection and one of the two environments.\n"
            "2. Run the folders in order (1 to 6; 6 is a stretch), or use the Collection Runner. Folder 9 cleans up what you created.\n"
            "3. Read the guide: https://aehrc.github.io/qh-connectathon/track2/QH-Track2-API-Guide.html\n\n"
            "All data is fictional. Pre-seeded ids (`qhd-*` directory, `qhc-*` referral) are used as defaults, so every "
            "folder also works on its own."),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "item": [directory, referral, triage, booking, track, summary, cleanup],
    "event": [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": COLLECTION_PRE}}],
    "variable": [{"key": k, "value": v} for k, v in VARS.items()],
}


def env(name, directory_url, referral_url, frog_url):
    return {
        "id": name.lower().replace(" ", "-"), "name": name, "_postman_variable_scope": "environment",
        "values": [
            {"key": "directoryUrl", "value": directory_url, "enabled": True},
            {"key": "referralUrl", "value": referral_url, "enabled": True},
            {"key": "frogRunnerUrl", "value": frog_url, "enabled": True},
        ],
    }


def main():
    (HERE / "QH-Track2.postman_collection.json").write_text(json.dumps(collection, indent=2) + "\n")
    envs = {
        "QH-Track2-public.postman_environment.json":
            env("QH Track 2 (public)", "https://directory.efiq.hospservices.net/fhir",
                "https://referrals.efiq.hospservices.net/fhir", "https://conformance.efiq.hospservices.net"),
        "QH-Track2-incluster.postman_environment.json":
            env("QH Track 2 (in-cluster)", "http://directory:8080/fhir",
                "http://fhir:8080/fhir", "http://frog:8080"),
    }
    for fn, e in envs.items():
        (HERE / fn).write_text(json.dumps(e, indent=2) + "\n")
    n = sum(len(f["item"]) for f in collection["item"])
    print(f"collection: {len(collection['item'])} folders, {n} requests; {len(envs)} environments")


if __name__ == "__main__":
    main()
