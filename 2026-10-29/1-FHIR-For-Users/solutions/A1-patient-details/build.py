#!/usr/bin/env python3
"""Scenario A1 (Patient details): full module + standalone test form + test data.

Extends the starter module questionnaires/modules/pam-patient-details.json (same linkIds for
the items it already had: pam-name, pam-dob, pam-age, pam-sex, pam-medicare, pam-height,
pam-weight, pam-bmi; same variables obsHeight / obsWeight) and adds:

* Indigenous status, interpreter required, preferred language, address, phone, next of kin
  (pre-populated from the Patient, AU Base extensions);
* "Measured on" date and a read-only summary of the latest height/weight on record;
* template-based extraction of a height and a weight Observation (vital signs, LOINC).

    python3 build.py      # writes pam-patient-details.json, A1-standalone.json, testdata-bundle.json
    ./load.sh             # PUTs test data and questionnaires to the Meld open endpoint
    node verify.mjs       # checks every FHIRPath expression with fhirpath.js (R4)
"""
import copy
import json
from pathlib import Path

HERE = Path(__file__).parent
SOLN = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
MEDICARE = "http://ns.electronichealth.net.au/id/medicare-number"
INDIGENOUS_EXT = "http://hl7.org.au/fhir/StructureDefinition/indigenous-status"
INDIGENOUS_CS = "https://healthterminologies.gov.au/fhir/CodeSystem/australian-indigenous-status-1"
INDIGENOUS_VS = "https://healthterminologies.gov.au/fhir/ValueSet/australian-indigenous-status-1"
INTERPRETER_EXT = "http://hl7.org/fhir/StructureDefinition/patient-interpreterRequired"
LANGUAGE_VS = "https://healthterminologies.gov.au/fhir/ValueSet/common-languages-australia-2"
STATE_VS = "https://healthterminologies.gov.au/fhir/ValueSet/australian-states-territories-2"
TEV = f"{SDC}/sdc-questionnaire-templateExtractValue"


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


def template_extract(template_id):
    return ext(f"{SDC}/sdc-questionnaire-templateExtract",
               extension=[ext("template", valueReference={"reference": f"#{template_id}"})])


def tev(expr):
    return {"extension": [ext(TEV, valueString=expr)]}


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def answer(link_id):
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


# --- Pre-population expressions (all verified in verify.mjs) ----------------------------------

# Home address if there is one, else the first address
ADDR = "(%patient.address.where(use='home') | %patient.address).first()"
# Mobile first, then any phone
PHONE = ("(%patient.telecom.where(system='phone' and use='mobile') | "
         "%patient.telecom.where(system='phone')).first().value")
NOK = ("(%patient.contact.where(relationship.coding.code='N') | %patient.contact).first()")
EXPR = {
    "name": "%patient.name.first().given.first() + ' ' + %patient.name.first().family",
    "dob": "%patient.birthDate",
    "sex": "%patient.gender",
    "medicare": f"%patient.identifier.where(system='{MEDICARE}').value.first()",
    "indigenous": f"%patient.extension.where(url='{INDIGENOUS_EXT}').value",
    "interpreter": f"%patient.extension.where(url='{INTERPRETER_EXT}').value",
    "language": "(%patient.communication.where(preferred = true) | %patient.communication).first().language.coding.first()",
    "addr-line": f"{ADDR}.line.join(', ')",
    "addr-suburb": f"{ADDR}.city",
    "addr-state": f"{ADDR}.state",
    "addr-postcode": f"{ADDR}.postalCode",
    "phone": PHONE,
    "nok-name": f"{NOK}.name.given.first() + ' ' + {NOK}.name.family",
    "nok-relationship": f"{NOK}.relationship.text.first()",
    "nok-phone": f"{NOK}.telecom.where(system='phone').value.first()",
    "height": "%obsHeight.entry.resource.value.value",
    "weight": "%obsWeight.entry.resource.value.value",
    # e.g. "Latest on record: 165 cm (03/09/2026), 72.4 kg (03/09/2026)"
    "hw-last": ("iif(%obsHeight.entry.exists() or %obsWeight.entry.exists(), "
                "'Latest on record: ' + "
                "iif(%obsHeight.entry.exists(), %obsHeight.entry.resource.value.value.toString() + ' cm (' + "
                "%obsHeight.entry.resource.effective.toString().substring(0, 10) + ')', 'no height') + ', ' + "
                "iif(%obsWeight.entry.exists(), %obsWeight.entry.resource.value.value.toString() + ' kg (' + "
                "%obsWeight.entry.resource.effective.toString().substring(0, 10) + ')', 'no weight'), "
                "'No height or weight on record')"),
    "hw-date": "today()",
}
CALC = {
    "age": ("today().toString().substring(0,4).toInteger() - %dob.toString().substring(0,4).toInteger()"
            " - iif(today().toString().substring(5,5) < %dob.toString().substring(5,5), 1, 0)"),
    "bmi": "(%weightKg / ((%heightCm / 100).power(2))).round(1)",
}

# Root-form variables this module relies on (copied into the standalone form). Same as pam-root.json.
ROOT_VARIABLES = [
    variable("dob", answer("pam-dob")),
    variable("heightCm", answer("pam-height")),
    variable("weightKg", answer("pam-weight")),
]


def vital_template(tid, code, display, value_link, ucum):
    """Observation template; context = the pam-height / pam-weight answer item."""
    return {
        "resourceType": "Observation", "id": tid, "status": "final",
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                  "code": "vital-signs", "display": "Vital Signs"}]}],
        "code": {"coding": [{"system": LOINC, "code": code, "display": display}], "text": display},
        "subject": {"_reference": tev(TEMPLATE_EXPR["subject"])},
        "_effectiveDateTime": tev(TEMPLATE_EXPR["effective"]),
        "valueQuantity": {"_value": tev(TEMPLATE_EXPR["value"]), "unit": ucum, "system": UCUM, "code": ucum},
    }


TEMPLATE_EXPR = {  # templateExtractValue expressions, for verify.mjs
    "subject": "%resource.subject.reference",
    "effective": f"{answer('pam-hw-date')}.toString()",
    "value": "answer.value",
}


def module():
    items = [
        item("pam-patient-details-module", "Module", "string", HIDDEN,
             initial=[{"valueString": f"pam-patient-details|{VERSION}"}]),
        item("pam-name", "Name", "string", initial(EXPR["name"])),
        item("pam-dob", "Date of birth", "date", initial(EXPR["dob"])),
        item("pam-age", "Age", "integer", unit("a", "years"), calculated(CALC["age"]), readOnly=True),
        item("pam-sex", "Sex", "choice", initial(EXPR["sex"]), answerOption=[
            {"valueCoding": {"system": "http://hl7.org/fhir/administrative-gender", "code": c, "display": d}}
            for c, d in [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Unknown")]]),
        item("pam-medicare", "Medicare number", "string", initial(EXPR["medicare"])),
        item("pam-indigenous", "Indigenous status", "choice", initial(EXPR["indigenous"]),
             answerValueSet=INDIGENOUS_VS),
        item("pam-interpreter", "Interpreter required", "boolean", initial(EXPR["interpreter"])),
        item("pam-language", "Preferred language", "choice", initial(EXPR["language"]),
             ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
                 valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control",
                                                   "code": "autocomplete"}]}),
             answerValueSet=LANGUAGE_VS),
        item("pam-phone", "Phone", "string", initial(EXPR["phone"])),
        item("pam-address", "Address", "group", item=[
            item("pam-addr-line", "Street address", "string", initial(EXPR["addr-line"])),
            item("pam-addr-suburb", "Suburb", "string", initial(EXPR["addr-suburb"])),
            item("pam-addr-state", "State", "choice", initial(EXPR["addr-state"]), answerValueSet=STATE_VS),
            item("pam-addr-postcode", "Postcode", "string", initial(EXPR["addr-postcode"]),
                 ext("http://hl7.org/fhir/StructureDefinition/regex", valueString="^[0-9]{4}$"), maxLength=4),
        ]),
        item("pam-nok", "Next of kin", "group", item=[
            item("pam-nok-name", "Name", "string", initial(EXPR["nok-name"])),
            item("pam-nok-relationship", "Relationship", "string", initial(EXPR["nok-relationship"])),
            item("pam-nok-phone", "Phone", "string", initial(EXPR["nok-phone"])),
        ]),
        item("pam-hw-last", "Height and weight on record", "string", initial(EXPR["hw-last"]), readOnly=True),
        item("pam-height", "Height", "decimal", unit("cm"), initial(EXPR["height"]),
             template_extract("PAMHeightTemplate")),
        item("pam-weight", "Weight", "decimal", unit("kg"), initial(EXPR["weight"]),
             template_extract("PAMWeightTemplate")),
        item("pam-hw-date", "Height and weight measured on", "date", initial(EXPR["hw-date"])),
        item("pam-bmi", "BMI", "decimal", unit("kg/m2", "kg/m²"), calculated(CALC["bmi"]), readOnly=True),
        item("pam-hw-help", "If you measure height or weight in clinic, change the value and the date: "
             "the changed value is written back as a new Observation.", "display"),
    ]
    group = item("pam-patient", "Patient details", "group",
                 query("obsHeight", "Observation?code=http://loinc.org|8302-2&patient={{%patient.id}}&_sort=-date&_count=1"),
                 query("obsWeight", "Observation?code=http://loinc.org|29463-7&patient={{%patient.id}}&_sort=-date&_count=1"),
                 item=items)
    return {
        "resourceType": "Questionnaire", "id": "soln-pam-patient-details",
        "extension": [
            ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child"),
            ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
                ext("name", valueCoding={"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}),
                ext("type", valueCode="Patient")]),
        ],
        "url": f"{SOLN}/pam-patient-details", "version": VERSION,
        "name": "PAMPatientDetailsSolution", "title": "PAM module — Patient details (solution)",
        "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": "Scenario A1 reference solution: extends the starter pam-patient-details module. "
                       "Needs the root form's shared variables dob, heightCm and weightKg.",
        "contained": [
            vital_template("PAMHeightTemplate", "8302-2", "Body height", "pam-height", "cm"),
            vital_template("PAMWeightTemplate", "29463-7", "Body weight", "pam-weight", "kg"),
        ],
        "item": [group],
    }


def standalone(mod):
    q = copy.deepcopy(mod)
    q["id"] = "soln-A1-standalone"
    q["url"] = f"{SOLN}/A1-standalone"
    q["name"] = "PAMPatientDetailsStandalone"
    q["title"] = "A1 Patient details — standalone test form"
    q["description"] = "The A1 solution module plus the root-form variables it needs, so it runs on its own."
    q["extension"] = [e for e in q["extension"] if not e["url"].endswith("assemble-expectation")] + ROOT_VARIABLES
    return q


# --- Test data --------------------------------------------------------------------------------

def testdata():
    pid = "soln-A1-patient-1"
    patient = {
        "resourceType": "Patient", "id": pid,
        "extension": [
            ext(INDIGENOUS_EXT, valueCoding={"system": INDIGENOUS_CS, "code": "4",
                                             "display": "Neither Aboriginal nor Torres Strait Islander origin"}),
            ext(INTERPRETER_EXT, valueBoolean=True),
        ],
        "identifier": [{"type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "MC"}]},
                        "system": MEDICARE, "value": "0000099901"}],
        "name": [{"use": "official", "given": ["Anna"], "family": "Testdetails"}],
        "telecom": [{"system": "phone", "value": "07 3000 1111", "use": "home"},
                    {"system": "phone", "value": "0400 000 111", "use": "mobile"}],
        "gender": "female", "birthDate": "1956-07-21",
        "address": [{"use": "home", "line": ["12 Example Street", "Unit 3"], "city": "Chermside",
                     "state": "QLD", "postalCode": "4032", "country": "AU"}],
        "communication": [{"language": {"coding": [{"system": "urn:ietf:bcp:47", "code": "el", "display": "Greek"}]},
                           "preferred": True}],
        "contact": [{"relationship": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0131", "code": "N",
                                                   "display": "Next-of-Kin"}]}, {"text": "Daughter"}],
                     "name": {"given": ["Sofia"], "family": "Testdetails"},
                     "telecom": [{"system": "phone", "value": "0400 000 222", "use": "mobile"}]}],
    }

    def obs(oid, code, display, value, ucum, when):
        return {"resourceType": "Observation", "id": f"{pid}-{oid}", "status": "final",
                "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                          "code": "vital-signs", "display": "Vital Signs"}]}],
                "code": {"coding": [{"system": LOINC, "code": code, "display": display}]},
                "subject": {"reference": f"Patient/{pid}"}, "effectiveDateTime": when,
                "valueQuantity": {"value": value, "unit": ucum, "system": UCUM, "code": ucum}}

    resources = [patient,
                 obs("height-1", "8302-2", "Body height", 163, "cm", "2026-03-02"),
                 obs("weight-1", "29463-7", "Body weight", 71.0, "kg", "2026-03-02"),
                 obs("height-2", "8302-2", "Body height", 162, "cm", "2026-09-15"),
                 obs("weight-2", "29463-7", "Body weight", 68.4, "kg", "2026-09-15")]
    return {"resourceType": "Bundle", "type": "transaction",
            "entry": [{"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}}
                      for r in resources]}


def write(name, obj):
    (HERE / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print("wrote", name)


if __name__ == "__main__":
    m = module()
    write("pam-patient-details.json", m)
    write("A1-standalone.json", standalone(m))
    write("testdata-bundle.json", testdata())

