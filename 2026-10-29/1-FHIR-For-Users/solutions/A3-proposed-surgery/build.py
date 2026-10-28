#!/usr/bin/env python3
"""Scenario A3 — Proposed surgery / referral: full solution.

Extends the starter module questionnaires/modules/pam-proposed-surgery.json (same top-level group
`pam-surgery`, same hidden `pam-proposed-surgery-module` item; the 🚧 scaffolding is replaced).

    python3 build.py      # writes soln-pam-proposed-surgery.json, soln-A3-standalone.json, test-data.json

What it does
  * Pre-populates the surgical waitlist entry (ServiceRequest with an elective category) —
    procedure, surgeon (requester), surgical unit (performer), category, booked date — with one
    x-fhir-query that _includes the Practitioner and Organization.
  * Calculates days until surgery (needs the new shared root variable `surgeryDate`).
  * Shows an existing referral to the blood management service, if there is one.
  * Writes back a ServiceRequest referring the patient to the blood management service
    (template-based extraction), linked to the waitlist entry with supportingInfo.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
SCT = "http://snomed.info/sct"
SCT_AU = "http://snomed.info/sct/32506021000036107"  # SNOMED CT-AU edition (module id)
UCUM = "http://unitsofmeasure.org"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
ELECTIVE = f"{LOCAL}/elective-category"
REF_SOURCE = f"{LOCAL}/referral-source"


# --- Helpers (same shapes as questionnaires/build.py) ---------------------------------------

def ext(url, **value):
    return {"url": url, **value}


def variable(name, expr, language="text/fhirpath"):
    return ext("http://hl7.org/fhir/StructureDefinition/variable",
               valueExpression={"name": name, "language": language, "expression": expr})


def query(name, q):
    return variable(name, q, "application/x-fhir-query")


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def calculated(expr):
    return ext(f"{SDC}/sdc-questionnaire-calculatedExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def unit(code, display=None):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
               valueCoding={"system": UCUM, "code": code, "display": display or code})


def control(code):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
               valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control", "code": code}]})


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def coding(system, code, display):
    return {"system": system, "code": code, "display": display}


def options(system, pairs):
    return [{"valueCoding": coding(system, c, d)} for c, d in pairs]


def ecl_vs(ecl):
    """Implicit SNOMED CT-AU value set defined by ECL (expanded by Ontoserver)."""
    from urllib.parse import quote
    # Terms (|...|) are stripped: Smart Forms puts this URL in $expand?url= without encoding it,
    # Ontoserver decodes it once and would read a '|' as the canonical|version separator.
    ecl = " ".join(re.sub(r"\|[^|]*\|", "", ecl).split())
    return f"{SCT_AU}?fhir_vs=ecl/{quote(ecl, safe='')}"


def tpl_value(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def template_extract(template_id):
    return ext(f"{SDC}/sdc-questionnaire-templateExtract",
               extension=[{"url": "template", "valueReference": {"reference": f"#{template_id}"}}])


def answer(link_id):
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


def daynum(src):
    """FHIRPath: day number of a 'YYYY-MM-DD' string (days-from-civil). FHIRPath R4 / fhirpath.js
    has no date difference, so days between two dates = daynum(a) - daynum(b)."""
    y, m, d = "substring(0,4).toInteger()", "substring(5,2).toInteger()", "substring(8,2).toInteger()"
    yy = f"({y} - iif({m} <= 2, 1, 0))"
    mm = f"iif({m} > 2, {m} - 3, {m} + 9)"
    return f"{src}.select(365 * {yy} + {yy} div 4 - {yy} div 100 + {yy} div 400 + (153 * {mm} + 2) div 5 + {d})"


# --- Shared root variable this module needs (new) -------------------------------------------
# Like the root's other shared variables: Smart Forms only evaluates questionnaire-level variables
# for calculation-only items reliably, so surgeryDate goes on the root.
NEW_ROOT_VARIABLES = [variable("surgeryDate", answer("pam-surgery-date"))]

DAYS_TO_SURGERY = f"{daynum('%surgeryDate.toString()')} - {daynum('today().toString()')}"

# --- Pre-population -------------------------------------------------------------------------
# One query: the patient's active waitlist entry (identified by its elective category), soonest
# first, with the surgeon (requester) and unit (performer) included in the same Bundle.
WAITLIST_Q = (f"ServiceRequest?patient={{{{%patient.id}}}}&category={ELECTIVE}|&status=active"
              "&_sort=occurrence&_include=ServiceRequest:requester&_include=ServiceRequest:performer")
REFERRAL_Q = f"ServiceRequest?patient={{{{%patient.id}}}}&code={SCT}|3457005&_sort=-authored&_count=1"

SR = "%waitlist.entry.resource.where(resourceType='ServiceRequest').first()"
SURGEON = (f"%waitlist.entry.resource.where(resourceType='Practitioner' and ('Practitioner/' + id) = {SR}.requester.reference)")
UNIT = (f"%waitlist.entry.resource.where(resourceType='Organization' and ('Organization/' + id) = {SR}.performer.first().reference)")

CATEGORIES = [("1", "Category 1"), ("2", "Category 2"), ("3", "Category 3")]
SOURCES = [("surgeon", "Surgeon"), ("preadmission", "Pre-admission clinic"),
           ("anaesthetist", "Anaesthetist"), ("gp", "General practitioner")]
REASONS = [("271737000", "Anaemia"), ("87522002", "Iron deficiency anaemia"),
           ("35240004", "Iron deficiency"), ("234347009", "Anaemia of chronic disease")]

referral_template = {
    "resourceType": "ServiceRequest", "id": "PAMReferralTemplate",
    "status": "active", "intent": "order",
    "category": [{"coding": [tpl_value("item.where(linkId='pam-referral-source').answer.value")]}],
    "code": {"coding": [coding(SCT, "3457005", "Patient referral")],
             "text": "Referral to the blood management service"},
    # Urgent when surgery is less than 4 weeks away (rule to confirm with Metro North)
    "_priority": tpl_value(f"iif({answer('pam-surgery-days')} < 28, 'urgent', 'routine')"),
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_authoredOn": tpl_value("item.where(linkId='pam-referral-date').answer.value.toString()"),
    "requester": {"_reference": tpl_value(answer("pam-surgery-surgeon-ref"))},
    "performer": [{"reference": "Organization/pam-blood-management",
                   "display": "Blood Management Service (synthetic)"}],
    "reasonCode": [{"coding": [tpl_value("item.where(linkId='pam-referral-reason').answer.value")]}],
    "supportingInfo": [{"_reference": tpl_value(answer("pam-surgery-waitlist-ref"))}],
    "note": [{"_text": tpl_value("item.where(linkId='pam-referral-note').answer.value")}],
}

top = {
    "linkId": "pam-surgery", "text": "Proposed surgery", "type": "group",
    "extension": [query("waitlist", WAITLIST_Q), query("bmsReferral", REFERRAL_Q)],
    "item": [
        item("pam-proposed-surgery-module", "Module", "string", HIDDEN,
             initial=[{"valueString": f"pam-proposed-surgery|{VERSION}"}]),
        # References kept for write-back (hidden)
        item("pam-surgery-waitlist-ref", "Waitlist entry (reference)", "string", HIDDEN,
             initial(f"{SR}.select('ServiceRequest/' + id)")),
        item("pam-surgery-surgeon-ref", "Surgeon (reference)", "string", HIDDEN,
             initial(f"{SR}.requester.reference")),
        item("pam-surgery-unit-ref", "Surgical unit (reference)", "string", HIDDEN,
             initial(f"{SR}.performer.first().reference")),
        item("pam-surgery-procedure", "Procedure", "choice", control("autocomplete"),
             initial(f"{SR}.code.coding.where(system='{SCT}').first()"),
             answerValueSet=ecl_vs("<< 387713003 |Surgical procedure|")),
        item("pam-surgery-surgeon", "Surgeon", "string",
             initial(f"{SURGEON}.name.first().select(iif(prefix.exists(), prefix.first() + ' ', '') + given.first() + ' ' + family)")),
        item("pam-surgery-unit", "Surgical unit", "string", initial(f"{UNIT}.name")),
        item("pam-surgery-category", "Elective surgery category (1: within 30 days, 2: within 90 days, 3: within 365 days)",
             "choice", control("radio-button"),
             initial(f"{SR}.category.coding.where(system='{ELECTIVE}').first()"),
             answerOption=options(ELECTIVE, CATEGORIES)),
        item("pam-surgery-date", "Booked surgery date", "date",
             initial(f"{SR}.occurrence.toString().substring(0, 10)")),
        item("pam-surgery-days", "Days until surgery", "integer", unit("d", "days"),
             calculated(DAYS_TO_SURGERY), readOnly=True),
        item("pam-surgery-soon", "Less than 4 weeks to surgery: IV iron may not take full effect in time. "
             "Consider an urgent referral (threshold to confirm with Metro North).", "display",
             enableWhen=[{"question": "pam-surgery-days", "operator": "<", "answerInteger": 28}]),
        item("pam-surgery-existing-referral", "Previous referral to the blood management service (date, if any)", "date",
             initial("%bmsReferral.entry.resource.authoredOn.toString().substring(0, 10)"), readOnly=True),
        item("pam-referral-make", "Refer the patient to the blood management service now?", "boolean"),
        item("pam-referral", "Referral to the blood management service", "group",
             template_extract("PAMReferralTemplate"),
             enableWhen=[{"question": "pam-referral-make", "operator": "=", "answerBoolean": True}],
             item=[
                 item("pam-referral-date", "Referral date", "date", initial("today()"), required=True),
                 item("pam-referral-source", "Referral source", "choice", control("radio-button"),
                      required=True, answerOption=options(REF_SOURCE, SOURCES)),
                 item("pam-referral-reason", "Reason for referral", "choice", control("radio-button"),
                      answerOption=options(SCT, REASONS)),
                 item("pam-referral-note", "Notes for the blood management team", "text"),
             ]),
    ],
}

PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")

common = {
    "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
    "contained": [referral_template],
}

module = {
    "resourceType": "Questionnaire", "id": "soln-pam-proposed-surgery",
    "extension": [CHILD, PATIENT_CONTEXT],
    "url": f"{BASE}/pam-proposed-surgery", "version": VERSION,
    "name": "PAMProposedSurgery", "title": "PAM module — Proposed surgery (full solution A3)",
    **common,
    "description": "Solution to Track 1 scenario A3. Needs the shared root variable surgeryDate "
                   "(see the README); the standalone form soln-A3-standalone includes it.",
    "item": [top],
}

standalone = {
    "resourceType": "Questionnaire", "id": "soln-A3-standalone",
    "extension": [PATIENT_CONTEXT] + NEW_ROOT_VARIABLES,
    "url": f"{BASE}/A3-standalone", "version": VERSION,
    "name": "PAMProposedSurgeryStandalone", "title": "A3 Proposed surgery — standalone test form",
    **common,
    "description": "The A3 module with the root variable it needs, so it runs on its own in the Smart Forms playground.",
    "item": [top],
}

# --- Test data (own test patient; never the pam-* patients) --------------------------------
P = "soln-A3-patient-1"
test_bundle = {"resourceType": "Bundle", "type": "transaction", "entry": [
    {"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}} for r in [
        {"resourceType": "Patient", "id": P,
         "name": [{"use": "official", "given": ["Avery"], "family": "Solnthree"}],
         "gender": "female", "birthDate": "1957-03-14",
         "address": [{"use": "home", "city": "Chermside", "state": "QLD", "postalCode": "4032", "country": "AU"}]},
        # The booked surgery: active, elective category 2, ortho unit and surgeon from the synthetic data
        {"resourceType": "ServiceRequest", "id": f"{P}-surgery", "status": "active", "intent": "order",
         "category": [{"coding": [coding(ELECTIVE, "2", "Category 2")], "text": "Category 2"}],
         "code": {"coding": [coding(SCT, "52734007", "Total hip replacement")], "text": "Total hip replacement"},
         "subject": {"reference": f"Patient/{P}"},
         "occurrenceDateTime": "2026-11-18", "authoredOn": "2026-09-02",
         "requester": {"reference": "Practitioner/pam-surgeon-orthopaedics"},
         "performer": [{"reference": "Organization/pam-unit-orthopaedics"}]},
        # An older, completed waitlist entry that the query must skip (status != active)
        {"resourceType": "ServiceRequest", "id": f"{P}-surgery-old", "status": "completed", "intent": "order",
         "category": [{"coding": [coding(ELECTIVE, "3", "Category 3")], "text": "Category 3"}],
         "code": {"coding": [coding(SCT, "80146002", "Appendicectomy")], "text": "Appendicectomy"},
         "subject": {"reference": f"Patient/{P}"},
         "occurrenceDateTime": "2019-05-02", "authoredOn": "2019-04-20",
         "requester": {"reference": "Practitioner/pam-surgeon-colorectal"},
         "performer": [{"reference": "Organization/pam-unit-colorectal"}]},
    ]]}

for name, res in [("soln-pam-proposed-surgery.json", module), ("soln-A3-standalone.json", standalone),
                  ("test-data.json", test_bundle)]:
    (HERE / name).write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n")
print("Wrote soln-pam-proposed-surgery.json, soln-A3-standalone.json, test-data.json")
