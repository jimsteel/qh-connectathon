#!/usr/bin/env python3
"""A7 Treatment + Ganzoni: full solution, extending questionnaires/modules/pam-treatment.json (0.1.0).

    python3 build.py      # writes soln-pam-treatment.json (module) and soln-A7-standalone.json

The module relies on the root form's shared variables (sexCode, heightCm, weightKg, hb, actualHb,
idealWeight, weight, targetHb, ironStores) and on one root-level extractAllocateId (ivIronOrderId);
see README.md. The standalone form carries those (with the corrected definitions proposed in the
README) plus the Patient details / Pathology input items, so it runs on its own.
"""
import json
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).parent
BASE = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
FHIR_EXT = "http://hl7.org/fhir/StructureDefinition"
LOINC = "http://loinc.org"
SCT = "http://snomed.info/sct"
UCUM = "http://unitsofmeasure.org"

# AMT (in SNOMED CT-AU): generic (MPUU-level, unbranded) IV iron products whose precise active
# ingredient is ferric carboxymaltose or ferric derisomaltose, in an injection dose form.
# Branded products (TPUU: they have a 774158006 |Has product name|) are excluded.
IV_IRON_ECL = ("(< 763158003 : 762949000 = (430077004 OR 1172494003), 411116001 = << 129011000036109)"
               " MINUS (* : 774158006 = *)")
IV_IRON_VS = "http://snomed.info/sct?fhir_vs=ecl/" + quote(IV_IRON_ECL, safe="")


# --- helpers ----------------------------------------------------------------------------------

def ext(url, **value):
    return {"url": url, **value}


def variable(name, expr, language="text/fhirpath"):
    return ext(f"{FHIR_EXT}/variable", valueExpression={"name": name, "language": language, "expression": expr})


def query(name, q):
    return variable(name, q, "application/x-fhir-query")


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression", valueExpression={"language": "text/fhirpath", "expression": expr})


def calculated(expr):
    return ext(f"{SDC}/sdc-questionnaire-calculatedExpression", valueExpression={"language": "text/fhirpath", "expression": expr})


def enable_when_expr(expr):
    return ext(f"{SDC}/sdc-questionnaire-enableWhenExpression", valueExpression={"language": "text/fhirpath", "expression": expr})


def unit(code, display=None):
    return ext(f"{FHIR_EXT}/questionnaire-unit", valueCoding={"system": UCUM, "code": code, "display": display or code})


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


def calc(link_id, text, type_, expr, *extensions, **kw):
    return item(link_id, text, type_, *extensions, calculated(expr), readOnly=True, **kw)


def display(link_id, plain, html=None, *extensions, **kw):
    it = {"linkId": link_id, "type": "display", "text": plain}
    if html:
        it["_text"] = {"extension": [ext(f"{FHIR_EXT}/rendering-xhtml",
                                         valueString=f'<div xmlns="http://www.w3.org/1999/xhtml">{html}</div>')]}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def coding(system, code, display_):
    return {"system": system, "code": code, "display": display_}


def tv(expr):
    """templateExtractValue on a primitive's _element or a complex element."""
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
USER_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "user"}},
    {"url": "type", "valueCode": "Practitioner"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")
ALLOCATE_ORDER_ID = ext(f"{SDC}/sdc-questionnaire-extractAllocateId", valueString="ivIronOrderId")


# --- shared (root) variables this module relies on -------------------------------------------
# Same names as questionnaires/pam-root.json. The last three are corrected definitions (README:
# "Proposed root changes"); the module works with the 0.1.0 root definitions too.
ROOT_VARIABLES = [
    variable("sexCode", answer("pam-sex") + ".code"),
    variable("heightCm", answer("pam-height")),
    variable("weightKg", answer("pam-weight")),
    variable("hb", answer("pam-hb")),
    variable("actualHb", "%hb"),
    # Devine (1974): 50 kg (male) / 45.5 kg (female) + 2.3 kg per inch over 5 ft (0.9 kg/cm)
    variable("idealWeight", "iif(%sexCode = 'male', 50, 45.5) + 0.9 * (%heightCm - 152.4)"),
    # Dosing weight: ideal body weight if the patient weighs more than that, otherwise actual
    # weight (NBA 2016); actual weight when there's no height to calculate IBW from.
    variable("weight", "iif(%idealWeight.exists() and %idealWeight < %weightKg, %idealWeight, %weightKg)"),
    # Ganzoni: target Hb 150 g/L and iron stores 500 mg at >= 35 kg body weight;
    # 130 g/L and 15 mg/kg below 35 kg. The 35 kg threshold is on actual body weight.
    variable("targetHb", "iif(%weightKg < 35, 130, 150)"),
    variable("ironStores", "iif(%weightKg < 35, 15 * %weight, 500)"),
]


# --- module items -----------------------------------------------------------------------------
PRODUCT = answer("pam-iron-product")
DOSE = answer("pam-iron-dose")
CAP = answer("pam-iron-max-infusion")
N = answer("pam-iron-infusions")
GANZONI = answer("pam-ganzoni")
SUGGESTED = answer("pam-ganzoni-rounded")
PLAN_IV = coding(SCT, "718520009", "Intravenous iron infusion")


def nth_infusion(k):
    """Dose of infusion k: the full per-infusion maximum, except the last, which takes the remainder."""
    rem = f"({DOSE} - {k - 1} * {CAP})"
    return f"iif({N} >= {k}, iif({rem} < {CAP}, {rem}, {CAP}), {{}})"


inputs = item("pam-tx-inputs", "Inputs (from Patient details and Pathology)", "group", item=[
    calc("pam-tx-sex", "Sex", "string", "%sexCode"),
    calc("pam-tx-height", "Height", "decimal", "%heightCm", unit("cm")),
    calc("pam-tx-weight", "Actual body weight", "decimal", "%weightKg", unit("kg")),
    calc("pam-tx-hb", "Latest Hb (actual Hb)", "decimal", "%actualHb", unit("g/L")),
    display("pam-tx-inputs-missing", "Weight, height, sex and latest Hb are needed for the iron dose: "
            "fill them in under Patient details and Pathology.", None,
            enable_when_expr("%weightKg.empty() or %heightCm.empty() or %sexCode.empty() or %actualHb.empty()")),
])

ganzoni_group = item("pam-tx-ganzoni", "Total iron dose (Ganzoni)", "group", item=[
    display("pam-ganzoni-intro", "Total iron dose (Ganzoni) = dosing weight × (target Hb − actual Hb) × 0.24 + iron stores",
            "<p><b>Total iron dose (Ganzoni)</b> = dosing weight (kg) × (target Hb − actual Hb) (g/L) × 0.24 + iron stores (mg)</p>"
            "<p style=\"font-size:smaller\">Dosing weight: ideal body weight (Devine) if the patient weighs more than that, otherwise "
            "actual weight. Target Hb 150 g/L and iron stores 500 mg (130 g/L and 15 mg/kg under 35 kg). "
            "National Blood Authority, <i>Iron product choice and dose calculation for adults</i> (2016).</p>"),
    calc("pam-ideal-weight", "Ideal body weight (Devine)", "decimal", "%idealWeight.round(1)", unit("kg")),
    calc("pam-dosing-weight", "Dosing weight", "decimal", "%weight.round(1)", unit("kg")),
    calc("pam-dosing-weight-basis", "Dosing weight is", "string",
         "iif(%weight.empty(), {}, iif(%idealWeight.exists() and %idealWeight < %weightKg, "
         "'ideal body weight (actual weight is above ideal)', "
         "iif(%idealWeight.empty(), 'actual weight (no height for ideal body weight)', 'actual weight (at or below ideal)')))"),
    calc("pam-target-hb", "Target Hb", "decimal", "%targetHb", unit("g/L")),
    calc("pam-iron-stores", "Iron stores", "decimal", "%ironStores.round(0)", unit("mg")),
    calc("pam-ganzoni", "Total iron deficit (Ganzoni)", "decimal",
         "iif(%weight.exists() and %actualHb.exists(), "
         "(%weight * iif(%actualHb < %targetHb, %targetHb - %actualHb, 0) * 0.24 + %ironStores).round(0), {})",
         unit("mg")),
    calc("pam-ganzoni-rounded", "Suggested total dose (to the nearest 100 mg)", "decimal",
         f"(({GANZONI}) / 100).round(0) * 100", unit("mg")),
])

plan = item("pam-tx-plan", "Treatment plan", "choice", control("check-box"), repeats=True, answerOption=[
    {"valueCoding": PLAN_IV},
    {"valueCoding": coding(SCT, "438911000124105", "Iron supplement therapy")},  # oral iron
    {"valueCoding": coding(SCT, "1156741008", "Therapy using erythropoietin receptor agonist")},  # ESA
    {"valueCoding": coding(SCT, "116863004", "Transfusion of red blood cells")},
])

iv_enable = {"enableWhen": [{"question": "pam-tx-plan", "operator": "=", "answerCoding": PLAN_IV}]}

order = item("pam-iv-iron", "IV iron order", "group", item=[
    item("pam-iron-product", "Product (AMT)", "choice", control("drop-down"),
         template_extract("PAMIVIronTemplate", "'urn:uuid:' + %ivIronOrderId"),
         answerValueSet=IV_IRON_VS),
    item("pam-iron-dose-override", "Prescribe a different total dose from the suggested one", "boolean",
         initial=[{"valueBoolean": False}]),
    item("pam-iron-dose-manual", "Total dose to prescribe", "decimal", unit("mg"),
         enableWhen=[{"question": "pam-iron-dose-override", "operator": "=", "answerBoolean": True}]),
    calc("pam-iron-dose", "Total dose prescribed", "decimal",
         f"iif({answer('pam-iron-dose-override')} = true, {answer('pam-iron-dose-manual')}, {SUGGESTED})", unit("mg")),
    display("pam-iron-dose-warning", "The prescribed dose is above the calculated total iron deficit (rounded to "
            "the nearest 100 mg): the cumulative dose should not exceed the deficit (NBA 2016).", None,
            enable_when_expr(f"{DOSE} > {SUGGESTED}")),
    calc("pam-iron-max-infusion", "Maximum dose per infusion", "decimal",
         f"iif({PRODUCT}.display.contains('carboxymaltose'), iif(20 * %weight < 1000, (20 * %weight).floor(), 1000), "
         f"iif({PRODUCT}.display.contains('derisomaltose'), iif(20 * %weight < 1500, (20 * %weight).floor(), 1500), {{}}))",
         unit("mg")),
    calc("pam-iron-infusions", "Number of infusions", "integer", f"({DOSE} / {CAP}).ceiling()"),
    calc("pam-iron-dose-1", "Infusion 1", "decimal", nth_infusion(1), unit("mg")),
    calc("pam-iron-dose-2", "Infusion 2 (at least 7 days after infusion 1)", "decimal", nth_infusion(2), unit("mg"),
         enable_when_expr(f"{N} >= 2")),
    calc("pam-iron-dose-3", "Infusion 3 (at least 7 days after infusion 2)", "decimal", nth_infusion(3), unit("mg"),
         enable_when_expr(f"{N} >= 3")),
    display("pam-iron-infusions-warning", "More than three infusions: check the dose and plan the extra infusions by hand.",
            None, enable_when_expr(f"{N} > 3")),
    display("pam-iron-cap-note", "Per-infusion maximum (Australian product information): ferric carboxymaltose 20 mg/kg "
            "up to 1000 mg, and no more than 1000 mg a week; ferric derisomaltose 20 mg/kg, single doses above 1500 mg not "
            "recommended, split doses at least a week apart. 20 mg/kg uses the dosing weight."),
    # AU Core MedicationRequest.requester is 1..1: the launch user (%user) if there is one, else the name typed in
    item("pam-iron-prescriber", "Prescriber", "string",
         initial("%user.name.first().given.first() + ' ' + %user.name.first().family")),
    item("pam-iron-prescriber-ref", "Prescriber reference", "string", hidden(),
         initial("%user.resourceType + '/' + %user.id")),
], **iv_enable)

booking = item("pam-infusion", "Book the infusion (day unit)", "group", item=[
    item("pam-infusion-date", "Requested date of the first infusion", "date",
         template_extract("PAMInfusionTemplate")),
    item("pam-infusion-priority", "Priority", "choice", control("radio-button"),
         initial=[{"valueCoding": coding("http://hl7.org/fhir/request-priority", "routine", "Routine")}],
         answerOption=[{"valueCoding": coding("http://hl7.org/fhir/request-priority", c, d)}
                       for c, d in [("routine", "Routine"), ("urgent", "Urgent")]]),
    item("pam-infusion-notes", "Notes for the day unit", "text"),
], **iv_enable)

TREATMENT = item("pam-treatment", "Treatment", "group", item=[
    item("pam-treatment-module", "Module", "string", hidden(), initial=[{"valueString": f"soln-pam-treatment|{VERSION}"}]),
    inputs, ganzoni_group, plan, order, booking,
])


# --- templates --------------------------------------------------------------------------------
PRESCRIBER_REF = answer("pam-iron-prescriber-ref")
REQUESTER = {"_reference": tv(f"iif({PRESCRIBER_REF}.exists(), {PRESCRIBER_REF}, %resource.author.reference)"),
             "_display": tv(answer("pam-iron-prescriber"))}
REASON = f"%resource.repeat(item).where(linkId='pam-diagnosis').answer.value"
NOTE = (f"'Total iron dose ' + {DOSE}.toString() + ' mg (Ganzoni total iron deficit ' + {GANZONI}.toString()"
        f" + ' mg: dosing weight ' + {answer('pam-dosing-weight')}.toString() + ' kg, Hb ' + %resource.repeat(item)"
        f".where(linkId='pam-tx-hb').answer.value.toString() + ' g/L, target ' + {answer('pam-target-hb')}.toString()"
        f" + ' g/L, iron stores ' + {answer('pam-iron-stores')}.toString() + ' mg), in ' + {N}.toString()"
        f" + ' infusion(s) of at most ' + {CAP}.toString() + ' mg, at least 7 days apart.'")


def dosage(k):
    d = {
        "sequence": k,
        "_text": tv(f"'Infusion {k} of ' + {N}.toString() + ': ' + {answer(f'pam-iron-dose-{k}')}.toString() + ' mg IV'"
                    + ("" if k == 1 else " + ', at least 7 days after the previous infusion'")),
        "route": {"coding": [coding(SCT, "47625008", "Intravenous route")]},
        "doseAndRate": [{"doseQuantity": {
            "_value": tv(answer(f"pam-iron-dose-{k}")), "unit": "mg", "system": UCUM, "code": "mg"}}],
    }
    if k > 1:
        d = {"extension": [tctx(f"%resource.repeat(item).where(linkId='pam-iron-dose-{k}').answer")], **d}
    return d


med_template = {
    "resourceType": "MedicationRequest", "id": "PAMIVIronTemplate", "status": "active", "intent": "order",
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/medicationrequest-category",
                                     "outpatient", "Outpatient")]}],
    "medicationCodeableConcept": {"coding": [tv("answer.value")], "_text": tv("answer.value.display")},
    "subject": {"_reference": tv("%resource.subject.reference")},
    "_authoredOn": tv("now().toString()"),
    "requester": REQUESTER,
    "reasonCode": [{"coding": [tv(REASON)]}],
    "note": [{"_text": tv(NOTE)}],
    "dosageInstruction": [dosage(1), dosage(2), dosage(3)],
}

infusion_template = {
    "resourceType": "ServiceRequest", "id": "PAMInfusionTemplate", "status": "active", "intent": "order",
    "code": {"coding": [coding(SCT, "718520009", "Intravenous iron infusion")]},
    "subject": {"_reference": tv("%resource.subject.reference")},
    "_occurrenceDateTime": tv("answer.value.toString()"),
    "_authoredOn": tv("now().toString()"),
    "requester": REQUESTER,
    "_priority": tv(f"{answer('pam-infusion-priority')}.code"),
    "basedOn": [{"_reference": tv(f"iif({PRODUCT}.exists(), 'urn:uuid:' + %ivIronOrderId, {{}})")}],
    "quantityQuantity": {"_value": tv(N), "unit": "infusions", "system": UCUM, "code": "{infusions}"},
    "reasonCode": [{"coding": [tv(REASON)]}],
    "note": [{"_text": tv(f"iif({PRODUCT}.exists(), {PRODUCT}.display + ': ' + {NOTE}, {{}})")},
             {"_text": tv(answer("pam-infusion-notes"))}],
}


def questionnaire(id_, url, name, title, items, extensions, contained, description):
    return {
        "resourceType": "Questionnaire", "id": id_, "extension": extensions, "url": url, "version": VERSION,
        "name": name, "title": title, "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": description, "item": items, "contained": contained,
    }


module = questionnaire(
    "soln-pam-treatment", f"{BASE}/pam-treatment", "PAMTreatment", "PAM module — Treatment and iron dose (solution)",
    [TREATMENT], [CHILD, PATIENT_CONTEXT, USER_CONTEXT, ALLOCATE_ORDER_ID], [med_template, infusion_template],
    "Scenario A7 full solution: extends pam-treatment 0.1.0. Ganzoni total iron dose with dosing-weight rules, "
    "per-product infusion split, IV iron MedicationRequest (AMT value set) and day-unit infusion ServiceRequest. "
    "Needs the root's shared variables and extractAllocateId ivIronOrderId (see README).")

# --- standalone test form ---------------------------------------------------------------------
LATEST = "Observation?code={sys}|{code}&patient={{{{%patient.id}}}}&_sort=-date&_count=1"
standalone_inputs = item("pam-tx-standalone-inputs", "Patient details and pathology (copied from modules A1 and A5)", "group",
    query("obsHeight", LATEST.format(sys=LOINC, code="8302-2")),
    query("obsWeight", LATEST.format(sys=LOINC, code="29463-7")),
    query("latestHb", LATEST.format(sys=LOINC, code="718-7")),
    item=[
        item("pam-name", "Name", "string", initial("%patient.name.first().given.first() + ' ' + %patient.name.first().family")),
        item("pam-sex", "Sex", "choice", initial("%patient.gender"), answerOption=[
            {"valueCoding": coding("http://hl7.org/fhir/administrative-gender", c, d)}
            for c, d in [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Unknown")]]),
        item("pam-height", "Height", "decimal", unit("cm"), initial("%obsHeight.entry.resource.value.value")),
        item("pam-weight", "Weight", "decimal", unit("kg"), initial("%obsWeight.entry.resource.value.value")),
        item("pam-hb", "Haemoglobin (Hb)", "decimal", unit("g/L"), initial("%latestHb.entry.resource.value.value")),
        item("pam-hb-date", "Date of latest Hb", "date",
             initial("%latestHb.entry.resource.effective.toString().substring(0, 10)")),
    ])
standalone = questionnaire(
    "soln-A7-standalone", f"{BASE}/A7-standalone", "PAMTreatmentStandalone",
    "A7 Treatment + Ganzoni — standalone test form",
    [standalone_inputs, json.loads(json.dumps(TREATMENT))],
    [PATIENT_CONTEXT, USER_CONTEXT, ALLOCATE_ORDER_ID] + ROOT_VARIABLES, [med_template, infusion_template],
    "Standalone test form for scenario A7: the soln-pam-treatment module plus the input items and root variables it needs.")
standalone["item"][1]["item"][0]["initial"] = [{"valueString": f"soln-A7-standalone|{VERSION}"}]

for q, f in [(module, "soln-pam-treatment.json"), (standalone, "soln-A7-standalone.json")]:
    (HERE / f).write_text(json.dumps(q, indent=2, ensure_ascii=False) + "\n")
print("Wrote soln-pam-treatment.json and soln-A7-standalone.json")
