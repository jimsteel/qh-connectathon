#!/usr/bin/env python3
"""A8 Patient Education: full solution, extending questionnaires/modules/pam-education.json (0.1.0).

    python3 build.py      # writes soln-pam-education.json (module), soln-A8-standalone.json and
                          # CodeSystem-education-material.json

Pre-populates the patient's name and, from the surgical waitlist entry (ServiceRequest with an
elective category), the surgical unit (performer) and consultant (requester). The nurse records
the date, delivery methods and materials (both multi-select). Extraction writes a Procedure (the
education session: countable, e.g. for B3's "education sessions per month") and a Communication
(what was given and how: one medium per delivery method, one payload per material), linked by
Communication.partOf. Needs the root-level extractAllocateId eduProcedureId (see README).
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
FHIR_EXT = "http://hl7.org/fhir/StructureDefinition"
SCT = "http://snomed.info/sct"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
MATERIAL_CS = f"{LOCAL}/education-material"
MODE = "http://terminology.hl7.org/CodeSystem/v3-ParticipationMode"


def ext(url, **value):
    return {"url": url, **value}


def variable(name, expr, language="text/fhirpath"):
    return ext(f"{FHIR_EXT}/variable", valueExpression={"name": name, "language": language, "expression": expr})


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression", valueExpression={"language": "text/fhirpath", "expression": expr})


def hidden():
    return ext(f"{FHIR_EXT}/questionnaire-hidden", valueBoolean=True)


def control(code):
    return ext(f"{FHIR_EXT}/questionnaire-itemControl",
               valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control", "code": code}]})


def answer(link_id):
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def coding(system, code, display):
    return {"system": system, "code": code, "display": display}


def tv(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def tctx(expr):
    return ext(f"{SDC}/sdc-questionnaire-templateExtractContext", valueString=expr)


def template_extract(template_id, full_url=None):
    sub = [{"url": "template", "valueReference": {"reference": f"#{template_id}"}}]
    if full_url:
        sub.append({"url": "fullUrl", "valueString": full_url})
    return ext(f"{SDC}/sdc-questionnaire-templateExtract", extension=sub)


PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")
ALLOCATE_PROCEDURE_ID = ext(f"{SDC}/sdc-questionnaire-extractAllocateId", valueString="eduProcedureId")

# Delivery methods: HL7 v3 ParticipationMode, the binding of Communication.medium
METHODS = [("FACE", "face-to-face", "Face-to-face"), ("PHONE", "telephone", "Telephone"),
           ("VIDEOCONF", "videoconferencing", "Videoconference (telehealth)"),
           ("WRITTEN", "written", "Written information (printed)"), ("EMAILWRIT", "email", "Email"),
           ("ONLINEWRIT", "online written", "Online (website or patient portal)")]
# Materials: local codes (placeholder system, like the synthetic data's local codes)
MATERIALS = [
    ("anaemia-surgery", "Anaemia and iron deficiency before surgery (patient information)"),
    ("pbm-surgery", "Patient blood management: getting ready for surgery"),
    ("iv-iron", "Intravenous (IV) iron infusion: what to expect"),
    ("oral-iron", "Oral iron: how to take iron tablets"),
    ("iron-diet", "Iron-rich foods (dietary advice)"),
    ("transfusion", "Blood transfusion: risks, benefits and alternatives"),
    ("video", "Patient education video"),
    ("other", "Other"),
]

# Surgical waitlist entry with its requester (consultant) and performer (unit)
SURGERY_QUERY = (f"ServiceRequest?patient={{{{%patient.id}}}}&category={LOCAL}/elective-category|"
                 "&_sort=-authored&_count=1&_include=ServiceRequest:requester&_include=ServiceRequest:performer")
SURGERY = "%eduSurgery.entry.where(search.mode = 'match').resource"
INCLUDED = "%eduSurgery.entry.where(search.mode = 'include').resource"

EDUCATION = item("pam-education", "Patient education", "group", variable("eduSurgery", SURGERY_QUERY, "application/x-fhir-query"), item=[
    item("pam-education-module", "Module", "string", hidden(), initial=[{"valueString": f"soln-pam-education|{VERSION}"}]),
    item("pam-edu-patient", "Patient", "string", initial(
        "%patient.name.where(use = 'official').union(%patient.name).first().select(given.first() & ' ' & family)"),
        readOnly=True),
    item("pam-edu-unit", "Surgical unit", "string", initial(
        f"{INCLUDED}.ofType(Organization).where({SURGERY}.performer.first().reference.endsWith('/' + id)).name"),
        readOnly=True),
    item("pam-edu-consultant", "Consultant", "string", initial(
        f"{INCLUDED}.ofType(Practitioner).where({SURGERY}.requester.reference.endsWith('/' + id)).name.first()"
        ".select((prefix.first() & ' ' & given.first() & ' ' & family).trim())"), readOnly=True),
    item("pam-edu-procedure", "Proposed surgery", "string", initial(f"{SURGERY}.code.select(text | coding.display).first()"),
         readOnly=True),
    item("pam-edu-surgery-ref", "Waitlist entry", "string", hidden(),
         initial(f"'ServiceRequest/' + {SURGERY}.id")),
    item("pam-edu-date", "Date education given", "date", initial("today()"), required=True),
    item("pam-edu-method", "Delivery method (select all that apply)", "choice", control("check-box"),
         template_extract("PAMEducationProcedureTemplate", "'urn:uuid:' + %eduProcedureId"),
         template_extract("PAMEducationCommunicationTemplate"),
         repeats=True, required=True,
         answerOption=[{"valueCoding": coding(MODE, c, d)} for c, _, d in METHODS]),
    item("pam-edu-material", "Materials given (select all that apply)", "choice", control("check-box"), repeats=True,
         answerOption=[{"valueCoding": coding(MATERIAL_CS, c, d)} for c, d in MATERIALS]),
    item("pam-edu-material-other", "Other material", "string",
         enableWhen=[{"question": "pam-edu-material", "operator": "=", "answerCoding": coding(MATERIAL_CS, "other", "Other")}]),
    item("pam-edu-notes", "Notes (questions asked, understanding, follow-up)", "text"),
])

DATE_V = answer("pam-edu-date")
MATERIAL_V = answer("pam-edu-material")
# "Other" is recorded as the text typed in pam-edu-material-other (no code)
MATERIAL_TEXT = f"iif(code = 'other', {answer('pam-edu-material-other')}, display)"
procedure_template = {
    "resourceType": "Procedure", "id": "PAMEducationProcedureTemplate", "status": "completed",
    "category": {"coding": [coding(SCT, "409073007", "Education")]},
    "code": {"coding": [coding(SCT, "311401005", "Patient education")],
             "text": "Patient education (preoperative anaemia management)"},
    "subject": {"_reference": tv("%resource.subject.reference")},
    "_performedDateTime": tv(f"{DATE_V}.toString()"),
    "performer": [{"actor": {"_reference": tv("%resource.author.reference")}}],
    # (no link to the waitlist ServiceRequest here: R4 Procedure.reasonReference can't point to a
    # ServiceRequest (Meld rejects it, HAPI-0931) and basedOn would mean the session fulfils the
    # surgery request. Communication.about carries that link.)
    # one usedCode per material ("other": text only)
    # (one templated element per array: a second, separately templated element in the same array
    # is merged by index into the context's elements by sdc-template-extract 1.0.16)
    "usedCode": [{"extension": [tctx(MATERIAL_V)], "coding": [tv("iif(code = 'other', {}, $this)")], "_text": tv(MATERIAL_TEXT)}],
    "note": [{"_text": tv(answer("pam-edu-notes"))}],
}
communication_template = {
    "resourceType": "Communication", "id": "PAMEducationCommunicationTemplate", "status": "completed",
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/communication-category", "instruction", "Instruction")]}],
    "partOf": [{"_reference": tv("'urn:uuid:' + %eduProcedureId")}],
    "subject": {"_reference": tv("%resource.subject.reference")},
    "recipient": [{"_reference": tv("%resource.subject.reference")}],
    "sender": {"_reference": tv("%resource.author.reference")},
    "about": [{"_reference": tv(answer("pam-edu-surgery-ref"))}],
    "topic": {"coding": [coding(SCT, "311401005", "Patient education")], "text": "Preoperative anaemia management"},
    "_sent": tv(f"{DATE_V}.toString()"),
    # one medium per delivery method selected (context: the pam-edu-method item)
    "medium": [{"extension": [tctx("answer.value")], "coding": [tv("$this")], "_text": tv("display")}],
    # one payload per material given
    "payload": [{"extension": [tctx(MATERIAL_V)], "_contentString": tv(MATERIAL_TEXT)}],
    "note": [{"_text": tv(answer("pam-edu-notes"))}],
}


def questionnaire(id_, url, name, title, items, extensions, description):
    return {
        "resourceType": "Questionnaire", "id": id_, "extension": extensions, "url": url, "version": VERSION,
        "name": name, "title": title, "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": description, "item": items, "contained": [procedure_template, communication_template],
    }


module = questionnaire(
    "soln-pam-education", f"{BASE}/pam-education", "PAMEducation", "PAM module — Patient education (solution)",
    [EDUCATION], [CHILD, PATIENT_CONTEXT, ALLOCATE_PROCEDURE_ID],
    "Scenario A8 full solution: extends pam-education 0.1.0. Pre-populates patient, unit and consultant; "
    "multi-select delivery method and materials; extracts a Procedure (education session) and a Communication. "
    "Needs the root-level extractAllocateId eduProcedureId (see README).")
standalone_item = json.loads(json.dumps(EDUCATION))
standalone_item["item"][0]["initial"] = [{"valueString": f"soln-A8-standalone|{VERSION}"}]
standalone = questionnaire(
    "soln-A8-standalone", f"{BASE}/A8-standalone", "PAMEducationStandalone", "A8 Patient education — standalone test form",
    [standalone_item], [PATIENT_CONTEXT, ALLOCATE_PROCEDURE_ID],
    "Standalone test form for scenario A8 (the module needs no shared root variables).")

codesystem = {
    "resourceType": "CodeSystem", "id": "soln-A8-education-material", "url": MATERIAL_CS, "version": VERSION,
    "name": "PAMEducationMaterial", "title": "PAM patient education materials (placeholder, connectathon)",
    "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER, "content": "complete",
    "caseSensitive": True, "count": len(MATERIALS),
    "concept": [{"code": c, "display": d} for c, d in MATERIALS],
}

for obj, f in [(module, "soln-pam-education.json"), (standalone, "soln-A8-standalone.json"),
               (codesystem, "CodeSystem-education-material.json")]:
    (HERE / f).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
print("Wrote soln-pam-education.json, soln-A8-standalone.json, CodeSystem-education-material.json")
