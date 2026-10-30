#!/usr/bin/env python3
"""Build the modular PAM questionnaire: one Questionnaire per module plus a root form.

The working items are deliberately few — the ones shown in the webinar demos — and every
section ends with scaffolding that points to the connectathon scenario that would finish it.

    python3 build.py          # writes modules/*.json and pam-root.json
    node assemble.mjs         # writes pam-assembled.json (needs @aehrc/sdc-assemble)
    ./load.sh                 # PUTs everything to the forms server (default: Meld open endpoint)
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
BASE = "https://aehrc.github.io/qh-connectathon/track1/Questionnaire"
VERSION = "0.1.0"
DATE = "2026-10-06"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
LOINC = "http://loinc.org"
SCT = "http://snomed.info/sct"
UCUM = "http://unitsofmeasure.org"
MEDICARE = "http://ns.electronichealth.net.au/id/medicare-number"
SCENARIOS = "https://github.com/aehrc/qh-connectathon/blob/main/2026-10-29/1-FHIR-For-Users/Scenarios.md"


# --- Helpers --------------------------------------------------------------------------------

def ext(url, **value):
    return {"url": url, **value}


def fhirpath(name, expr, language="text/fhirpath"):
    return ext("http://hl7.org/fhir/StructureDefinition/variable",
               valueExpression={"name": name, "language": language, "expression": expr})


def query(name, q):
    return fhirpath(name, q, "application/x-fhir-query")


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def calculated(expr):
    return ext(f"{SDC}/sdc-questionnaire-calculatedExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def unit(code, display=None):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
               valueCoding={"system": UCUM, "code": code, "display": display or code})


def answer(link_id):
    """FHIRPath for an answer anywhere in the (assembled) response."""
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def xhtml_display(link_id, plain, html):
    return {
        "linkId": link_id, "type": "display", "text": plain,
        "_text": {"extension": [ext("http://hl7.org/fhir/StructureDefinition/rendering-xhtml",
                                    valueString=f'<div xmlns="http://www.w3.org/1999/xhtml">{html}</div>')]},
    }


def todo(link_id, scenario, title, ideas):
    """Scaffolding: a clearly-marked box listing what's left to build."""
    lis = "".join(f"<li>{i}</li>" for i in ideas)
    html = (
        '<div style="border:2px dashed #B9531A;border-radius:8px;padding:12px 16px;background:#FFF6EF">'
        f'<p style="margin:0 0 6px;font-weight:600;color:#B9531A">&#x1F6A7; To be built at the connectathon — '
        f'<a href="{SCENARIOS}">scenario {scenario}</a>: {title}</p>'
        f'<ul style="margin:0;padding-left:20px">{lis}</ul></div>'
    )
    plain = f"To be built at the connectathon — scenario {scenario}: {title}. " + "; ".join(ideas)
    return xhtml_display(link_id, plain, html)


def readonly(it):
    it["readOnly"] = True
    return it


def coding(system, code, display):
    return {"system": system, "code": code, "display": display}


TAB = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
          valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control", "code": "tab-container"}]})
PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
USER_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "user"}},
    {"url": "type", "valueCode": "Practitioner"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")
ROOT = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-root")


def tpl_value(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def template_extract(template_id):
    return ext(f"{SDC}/sdc-questionnaire-templateExtract",
               extension=[{"url": "template", "valueReference": {"reference": f"#{template_id}"}}])


def latest_obs(var, code):
    return query(var, f"Observation?code={LOINC}|{code}&patient={{{{%patient.id}}}}&_sort=-date&_count=1")


def module(slug, title, top_item, contained=None, contexts=()):
    # Hidden item with an initial value, so the section exists in the response from the start.
    # Works around a Smart Forms renderer bug: calculated answers in a section with no answers yet
    # are written to a throwaway group and lost.
    top_item["item"].insert(0, {
        "linkId": f"pam-{slug}-module", "text": "Module", "type": "string",
        "extension": [ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)],
        "initial": [{"valueString": f"pam-{slug}|{VERSION}"}],
    })
    q = {
        "resourceType": "Questionnaire",
        "id": f"pam-{slug}",
        "extension": [CHILD, PATIENT_CONTEXT, *contexts],
        "url": f"{BASE}/pam-{slug}",
        "version": VERSION,
        "name": "PAM" + "".join(w.capitalize() for w in slug.split("-")),
        "title": f"PAM module — {title}",
        "status": "draft",
        "experimental": True,
        "date": DATE,
        "publisher": PUBLISHER,
        "item": [top_item],
    }
    if contained:
        q["contained"] = contained
    return q


# Templates: the extracted resources conform to AU Core 2.0.0 (Pathology Result Observation, Condition,
# MedicationRequest) without claiming it in meta.profile (Meld rejects PUTs with meta.profile: HAPI-0389).

# --- Modules --------------------------------------------------------------------------------

modules = []

# Patient details (demo 1: from the Patient, from Observations, calculated as you go)
modules.append(module("patient-details", "Patient details", {
    "linkId": "pam-patient", "text": "Patient details", "type": "group",
    "extension": [latest_obs("obsHeight", "8302-2"), latest_obs("obsWeight", "29463-7")],
    "item": [
        item("pam-name", "Name", "string", initial("%patient.name.first().given.first() + ' ' + %patient.name.first().family")),
        item("pam-dob", "Date of birth", "date", initial("%patient.birthDate")),
        readonly(item("pam-age", "Age", "integer", unit("a", "years"), calculated(
            "today().toString().substring(0,4).toInteger() - %dob.toString().substring(0,4).toInteger()"
            " - iif(today().toString().substring(5,5) < %dob.toString().substring(5,5), 1, 0)"))),
        item("pam-sex", "Sex", "choice", initial("%patient.gender"), answerOption=[
            {"valueCoding": coding("http://hl7.org/fhir/administrative-gender", c, d)}
            for c, d in [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Unknown")]]),
        item("pam-medicare", "Medicare number", "string",
             initial(f"%patient.identifier.where(system='{MEDICARE}').value.first()")),
        item("pam-height", "Height", "decimal", unit("cm"), initial("%obsHeight.entry.resource.value.value")),
        item("pam-weight", "Weight", "decimal", unit("kg"), initial("%obsWeight.entry.resource.value.value")),
        readonly(item("pam-bmi", "BMI", "decimal", unit("kg/m2", "kg/m²"),
                      calculated("(%weightKg / ((%heightCm / 100).power(2))).round(1)"))),
        todo("pam-patient-todo", "A1", "the rest of Patient details", [
            "Indigenous status, interpreter required, preferred language, address and contacts — from the Patient",
            "Write height and weight back as Observations when they are measured in clinic",
            "Next of kin / emergency contact (RelatedPerson)",
        ]),
    ],
}))

modules.append(module("gp-details", "GP details", {
    "linkId": "pam-gp", "text": "GP details", "type": "group",
    "item": [todo("pam-gp-todo", "A2", "GP details", [
        "Pre-populate the GP from Patient.generalPractitioner (Practitioner / PractitionerRole)",
        "Choose the source: referring doctor, GP from the latest admission, or manual entry (enableWhen)",
        "Write back an updated Patient.generalPractitioner",
    ])],
}))

modules.append(module("proposed-surgery", "Proposed surgery", {
    "linkId": "pam-surgery", "text": "Proposed surgery", "type": "group",
    "item": [todo("pam-surgery-todo", "A3", "Proposed surgery and referral", [
        "Pre-populate procedure, surgeon, unit, category and booked date from the waitlist ServiceRequest",
        "Calculate days until surgery",
        "Write back the referral to the blood management service (ServiceRequest)",
    ])],
}))

modules.append(module("history", "Past medical and surgical history", {
    "linkId": "pam-history", "text": "History", "type": "group",
    "item": [todo("pam-history-todo", "A4", "Past medical and surgical history", [
        "Pre-populate Conditions, Procedures, medications and allergies",
        "SNOMED CT-AU value sets bound with ECL on Ontoserver",
        "enableWhen trees for follow-up questions (e.g. GI symptoms → gastroscopy / colonoscopy)",
    ])],
}))

# Pathology (demo 1: latest Hb, ferritin, TSAT and CRP; demo 2: Observation write-back)
PATH_TESTS = [("hb", "718-7", "Haemoglobin (Hb)", "g/L"), ("ferritin", "2276-4", "Ferritin", "ug/L"),
              ("tsat", "14801-5", "Transferrin saturation (TSAT)", "%"), ("crp", "1988-5", "C-reactive protein (CRP)", "mg/L")]
UNIT_DISPLAY = {"ug/L": "µg/L"}
obs_template = {
    "resourceType": "Observation", "id": "PAMExternalResultTemplate", "status": "final",
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/observation-category", "laboratory", "Laboratory")]}],
    # LOINC code without the answer's display (the form's labels aren't LOINC display names); label in text
    "code": {"coding": [{"system": LOINC, "_code": tpl_value("item.where(linkId='pam-ext-test').answer.value.code")}],
             "_text": tpl_value("item.where(linkId='pam-ext-test').answer.value.display")},
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_effectiveDateTime": tpl_value("item.where(linkId='pam-ext-date').answer.value.toString()"),
    "valueQuantity": {
        "_value": tpl_value("item.where(linkId='pam-ext-value').answer.value"),
        "system": UCUM,
        "_code": tpl_value(
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '718-7', 'g/L', "
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '2276-4', 'ug/L', "
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '14801-5', '%', 'mg/L')))"),
        "_unit": tpl_value(
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '718-7', 'g/L', "
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '2276-4', 'µg/L', "
            "iif(item.where(linkId='pam-ext-test').answer.value.code = '14801-5', '%', 'mg/L')))"),
    },
}
modules.append(module("pathology", "Pathology results", {
    "linkId": "pam-pathology", "text": "Pathology", "type": "group",
    "extension": [latest_obs("latestHb", "718-7"), latest_obs("latestFerritin", "2276-4"),
                  latest_obs("latestTsat", "14801-5"), latest_obs("latestCrp", "1988-5")],
    "item": [
        item(f"pam-{k}", text, "decimal", unit(u, UNIT_DISPLAY.get(u)),
             initial(f"%latest{k.capitalize()}.entry.resource.value.value"))
        for k, _, text, u in PATH_TESTS
    ] + [
        item("pam-hb-date", "Date of latest Hb", "date",
             initial("%latestHb.entry.resource.effective.toString().substring(0, 10)")),
        item("pam-ext", "Results from an external lab", "group", template_extract("PAMExternalResultTemplate"),
             repeats=True, item=[
                 item("pam-ext-test", "Test", "choice", answerOption=[
                     {"valueCoding": coding(LOINC, code, text)} for _, code, text, _ in PATH_TESTS]),
                 item("pam-ext-value", "Result", "decimal"),
                 item("pam-ext-date", "Collected", "date"),
             ]),
        todo("pam-pathology-todo", "A5", "the rest of Pathology", [
            "MCV, B12, folate and eGFR",
            "Repeating time points: initial vs post-treatment results side by side",
            "Show the result date and lab for every pre-populated value",
        ]),
    ],
}, contained=[obs_template]))

# Diagnosis (demo 1: calculated findings; demo 2: Condition write-back)
HB, FERRITIN, TSAT, CRP = (answer(f"pam-{k}") for k in ("hb", "ferritin", "tsat", "crp"))
condition_template = {
    "resourceType": "Condition", "id": "PAMDiagnosisTemplate",
    "clinicalStatus": {"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active")]},
    "verificationStatus": {"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed")]},
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-category", "encounter-diagnosis", "Encounter Diagnosis")]}],
    "code": {"coding": [tpl_value("answer.value")]},
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_recordedDate": tpl_value("now().toString()"),
}
modules.append(module("diagnosis", "Diagnosis", {
    "linkId": "pam-diagnosis-section", "text": "Diagnosis", "type": "group",
    "item": [
        xhtml_display("pam-findings-intro", "Findings, calculated from the pathology results",
                      "<p><b>Findings</b>, calculated from the pathology results (thresholds to confirm with Metro North)</p>"),
        readonly(item("pam-anaemia", "Anaemia (Hb ≤ 130 g/L male, ≤ 120 g/L female)", "boolean",
                      calculated("%hb <= %hbThreshold"))),
        readonly(item("pam-iron-deficiency", "Iron deficiency (ferritin < 100, or TSAT < 20% with ferritin 100–300 and CRP > 10)", "boolean",
                      calculated("%ferritin < 100 or (%tsat < 20 and %ferritin >= 100 and %ferritin <= 300 and %crp > 10)"))),
        readonly(item("pam-inflammation", "Inflammation (CRP > 10 mg/L)", "boolean", calculated("%crp > 10"))),
        item("pam-diagnosis", "Diagnosis", "choice", template_extract("PAMDiagnosisTemplate"), answerOption=[
            {"valueCoding": coding(SCT, c, d)} for c, d in [
                ("87522002", "Iron deficiency anaemia"), ("35240004", "Iron deficiency"),
                ("234347009", "Anaemia of chronic disease"), ("271737000", "Anaemia")]]),
        todo("pam-diagnosis-todo", "A6", "the rest of Diagnosis", [
            "Suggest the diagnosis from the findings, so the nurse confirms rather than chooses",
            "A SNOMED CT-AU value set on Ontoserver instead of four hard-coded options",
            "Limited consent or refusal of blood products → Flag; requested target Hb → Goal",
        ]),
    ],
}, contained=[condition_template]))

# Treatment (demo 1: Ganzoni; demo 2: MedicationRequest write-back)
med_template = {
    "resourceType": "MedicationRequest", "id": "PAMIVIronTemplate", "status": "active", "intent": "order",
    "medicationCodeableConcept": {"coding": [tpl_value("item.where(linkId='pam-iron-product').answer.value")]},
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_authoredOn": tpl_value("now().toString()"),
    # AU Core requester is 1..1: the launch user (%user) if there is one, else the name typed in
    "requester": {"_reference": tpl_value("item.where(linkId='pam-iron-prescriber-ref').answer.value"),
                  "_display": tpl_value("item.where(linkId='pam-iron-prescriber').answer.value")},
    "dosageInstruction": [{
        "route": {"coding": [coding(SCT, "47625008", "Intravenous route")]},
        "doseAndRate": [{"doseQuantity": {
            "_value": tpl_value("item.where(linkId='pam-iron-dose').answer.value"),
            "unit": "mg", "system": UCUM, "code": "mg"}}],
    }],
}
modules.append(module("treatment", "Treatment and iron dose", {
    "linkId": "pam-treatment", "text": "Treatment", "type": "group",
    "item": [
        xhtml_display("pam-ganzoni-intro", "Total iron dose (Ganzoni)",
                      "<p><b>Total iron dose (Ganzoni)</b> = weight × (target Hb − actual Hb) × 0.24 + iron stores</p>"),
        readonly(item("pam-ideal-weight", "Ideal body weight", "decimal", unit("kg"), calculated("%idealWeight.round(1)"))),
        readonly(item("pam-dosing-weight", "Dosing weight (lower of actual and ideal body weight)", "decimal", unit("kg"),
                      calculated("%weight.round(1)"))),
        readonly(item("pam-ganzoni", "Calculated total iron dose", "decimal", unit("mg"),
                      calculated("iif(%actualHb >= %targetHb, 0, (%weight * (%targetHb - %actualHb) * 0.24 + %ironStores).round(0))"))),
        item("pam-iv-iron", "IV iron order", "group", template_extract("PAMIVIronTemplate"), item=[
            item("pam-iron-product", "Product", "choice", answerOption=[
                {"valueCoding": coding(SCT, c, d)} for c, d in [
                    ("1312141000168105", "Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial"),
                    ("1086251000168104", "Iron (as ferric derisomaltose) 100 mg/mL injection, vial")]]),
            item("pam-iron-dose", "Prescribed dose", "decimal", unit("mg")),
            item("pam-iron-prescriber", "Prescriber", "string",
                 initial("%user.name.first().given.first() + ' ' + %user.name.first().family")),
            item("pam-iron-prescriber-ref", "Prescriber reference", "string",
                 ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True),
                 initial("%user.resourceType + '/' + %user.id")),
        ]),
        todo("pam-treatment-todo", "A7", "the rest of Treatment", [
            "Confirm the dosing-weight rule against the REDCap specification",
            "Cap the dose per infusion and split into infusions; book the day-unit infusion (ServiceRequest / Appointment)",
            "AMT value set from Ontoserver; oral iron, ESA and transfusion options",
        ]),
    ],
}, contained=[med_template], contexts=[USER_CONTEXT]))

modules.append(module("education", "Patient education", {
    "linkId": "pam-education", "text": "Patient education", "type": "group",
    "item": [todo("pam-education-todo", "A8", "Patient education", [
        "Delivery method and materials given (multi-select)",
        "Write back what was given (Communication or Procedure)",
    ])],
}))

modules.append(module("follow-up", "Follow-up and status", {
    "linkId": "pam-follow-up", "text": "Follow-up and status", "type": "group",
    "item": [todo("pam-follow-up-todo", "A9", "Follow-up and status", [
        "Pre-populate previous notes, status and referral date",
        "Days with the blood management team; follow-up due date",
        "Write back a follow-up Task and the EpisodeOfCare status (being managed / cleared)",
    ])],
}))

# --- Root -----------------------------------------------------------------------------------

SHARED_VARIABLES = [
    fhirpath("sexCode", answer("pam-sex") + ".code"),
    fhirpath("dob", answer("pam-dob")),
    fhirpath("heightCm", answer("pam-height")),
    fhirpath("weightKg", answer("pam-weight")),
    fhirpath("hb", HB), fhirpath("ferritin", FERRITIN), fhirpath("tsat", TSAT), fhirpath("crp", CRP),
    fhirpath("hbThreshold", "iif(%sexCode = 'male', 130, 120)"),
    # Ganzoni (as on the webinar slide)
    fhirpath("actualHb", "%hb"),
    fhirpath("idealWeight", "iif(%sexCode = 'male', 50, 45.5) + 0.9 * (%heightCm - 152.4)"),
    fhirpath("weight", "iif(%weightKg < %idealWeight, %weightKg, %idealWeight)"),
    fhirpath("targetHb", "iif(%weight < 35, 130, 150)"),
    fhirpath("ironStores", "iif(%weight < 35, 15 * %weight, 500)"),
]

root = {
    "resourceType": "Questionnaire",
    "id": "pam",
    # Shared FHIRPath variables live on the root: Smart Forms only evaluates an item's variables once
    # that item has answers, so module-level variables would never feed calculation-only sections.
    # Modules refer to these by name — part of the shared conventions for module authors.
    "extension": [ROOT, PATIENT_CONTEXT] + SHARED_VARIABLES,
    "url": f"{BASE}/pam",
    "version": VERSION,
    "name": "PreoperativeAnaemiaManagement",
    "title": "Preoperative Anaemia Management (connectathon starter)",
    "status": "draft",
    "experimental": True,
    "date": DATE,
    "publisher": PUBLISHER,
    "description": "Starter form for track 1: a few working items per module, with scaffolding for the rest.",
    "item": [{
        "linkId": "pam-tabs", "text": "Preoperative anaemia management", "type": "group",
        "extension": [TAB],
        "item": [{
            "linkId": f"pam-sub-{m['id'][4:]}", "type": "display", "text": m["title"],
            "extension": [ext(f"{SDC}/sdc-questionnaire-subQuestionnaire", valueCanonical=f"{m['url']}|{VERSION}")],
        } for m in modules],
    }],
}

out = HERE / "modules"
out.mkdir(exist_ok=True)
for m in modules:
    (out / f"{m['id']}.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
(HERE / "pam-root.json").write_text(json.dumps(root, indent=2, ensure_ascii=False) + "\n")
print(f"Wrote {len(modules)} modules and pam-root.json")
