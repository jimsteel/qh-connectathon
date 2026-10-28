#!/usr/bin/env python3
"""Scenario A4 — Past medical / surgical history: full solution.

Extends the starter module questionnaires/modules/pam-history.json (same top-level group
`pam-history`, same hidden `pam-history-module` item; the 🚧 scaffolding is replaced).

    python3 build.py      # writes soln-pam-history.json, soln-A4-standalone.json, test-data.json

What it does
  * "On record": pre-populates the patient's problem-list Conditions, Procedures, active
    MedicationStatements and AllergyIntolerances as read-only repeating tables
    (itemPopulationContext per row).
  * "Bleeding and anaemia screening": deep enableWhen trees (GI symptoms -> investigated ->
    endoscopy -> result -> findings; anticoagulants -> plan -> stop date; transfusion -> reaction
    -> type; heavy menstrual bleeding (female only, enableWhenExpression on the shared %sexCode);
    previous iron; comorbidities -> type/stage -> follow-ups).
  * Every coded question bound to SNOMED CT-AU: answerValueSet = implicit ECL value sets
    expanded by Ontoserver (incl. an AMT refinement: anticoagulant/antiplatelet medicinal
    products), or answerOption with real SNOMED CT-AU codes for short lists.
  * Writes back Conditions (comorbidity answers and new conditions; category problem-list-item)
    and Procedures (endoscopies, transfusion, new procedures), each with ifNoneExist so a
    re-extraction does not duplicate what is already on the record.
"""
import json
import re
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).parent
BASE = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
SCT = "http://snomed.info/sct"
SCT_AU = "http://snomed.info/sct/32506021000036107"  # SNOMED CT-AU edition
CLIN = "http://terminology.hl7.org/CodeSystem/condition-clinical"
VER = "http://terminology.hl7.org/CodeSystem/condition-ver-status"
CCAT = "http://terminology.hl7.org/CodeSystem/condition-category"
CRIT = "http://hl7.org/fhir/allergy-intolerance-criticality"
MSTAT = "http://hl7.org/fhir/CodeSystem/medication-statement-status"


# --- Helpers --------------------------------------------------------------------------------

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


def pop_context(name, expr):
    return ext(f"{SDC}/sdc-questionnaire-itemPopulationContext",
               valueExpression={"name": name, "language": "text/fhirpath", "expression": expr})


def enable_expr(expr):
    return ext(f"{SDC}/sdc-questionnaire-enableWhenExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


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


def str_options(*values):
    return [{"valueString": v} for v in values]


def ecl_vs(ecl):
    """Implicit SNOMED CT-AU value set defined by ECL (expanded by Ontoserver)."""
    # Terms (|...|) are stripped: Smart Forms puts this URL in $expand?url= without encoding it,
    # Ontoserver decodes it once and would read a '|' as the canonical|version separator.
    ecl = " ".join(re.sub(r"\|[^|]*\|", "", ecl).split())
    return f"{SCT_AU}?fhir_vs=ecl/{quote(ecl, safe='')}"


def when(question, op="=", **answer):
    if not answer:
        answer = {"answerBoolean": True}
    return {"question": question, "operator": op, **answer}


def tpl_value(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def template_extract(template_id, if_none_exist=None):
    sub = [{"url": "template", "valueReference": {"reference": f"#{template_id}"}}]
    if if_none_exist:
        sub.append({"url": "ifNoneExist", "valueString": if_none_exist})
    return ext(f"{SDC}/sdc-questionnaire-templateExtract", extension=sub)


def child(link_id):
    return f"item.where(linkId='{link_id}').answer.value"


PATIENT_ID = "%resource.subject.reference.replace('Patient/', '')"


def none_exist(code_expr, extra=""):
    """ifNoneExist query: conditional create, so a second extraction doesn't duplicate the record."""
    return f"'patient=' + {PATIENT_ID} + '&code=' + {code_expr}.system + '|' + {code_expr}.code{extra}"


# --- Value sets (ECL on SNOMED CT-AU) --------------------------------------------------------
VS_FINDING = ecl_vs("<< 404684003 |Clinical finding|")
VS_PROCEDURE = ecl_vs("<< 387713003 |Surgical procedure| OR << 423827005 |Endoscopy| OR << 116859006 |Transfusion of blood product|")
VS_MEDICINE = ecl_vs("^ 929360061000036106 |Medicinal product reference set| OR ^ 929360071000036103 |Medicinal product unit of use reference set|")
VS_SUBSTANCE = ecl_vs("<< 105590001 |Substance| OR ^ 929360061000036106 |Medicinal product reference set|")
VS_ANTITHROMBOTIC = ecl_vs("^ 929360061000036106 |Medicinal product reference set| : 127489000 |Has active ingredient| = "
                           "(<< 372862008 |Anticoagulant| OR << 771452004 |Platelet aggregation inhibitor|)")
VS_TRANSFUSION_REACTION = ecl_vs("<< 82545002 |Blood transfusion reaction|")
VS_CANCER = ecl_vs("<< 363346000 |Malignant neoplastic disease|")
VS_COAG = ecl_vs("<< 64779008 |Blood coagulation disorder|")
VS_LIVER = ecl_vs("<< 235856003 |Liver disease|")

# --- Pre-population queries ------------------------------------------------------------------
QUERIES = [
    query("historyConditions", "Condition?patient={{%patient.id}}&category=problem-list-item"),
    query("historyProcedures", "Procedure?patient={{%patient.id}}&_sort=-date"),
    query("historyMedications", "MedicationStatement?patient={{%patient.id}}&status=active"),
    query("historyAllergies", "AllergyIntolerance?patient={{%patient.id}}"),
]


def rows(var, rtype):
    return f"%{var}.entry.resource.where(resourceType='{rtype}')"


GTABLE = control("gtable")

on_record = item("pam-history-record", "On record", "group", item=[
    item("pam-history-condition", "Conditions (problem list)", "group",
         pop_context("ConditionRow", rows("historyConditions", "Condition")), GTABLE,
         repeats=True, readOnly=True, item=[
             item("pam-history-condition-code", "Condition", "choice", control("autocomplete"), initial("%ConditionRow.code.coding.first()"),
                  answerValueSet=VS_FINDING),
             item("pam-history-condition-status", "Status", "choice", initial("%ConditionRow.clinicalStatus.coding.first()"),
                  answerOption=options(CLIN, [("active", "Active"), ("inactive", "Inactive"), ("resolved", "Resolved")])),
             item("pam-history-condition-onset", "Onset", "date",
                  initial("%ConditionRow.onset.toString().substring(0, 10)")),
         ]),
    item("pam-history-procedure", "Procedures", "group",
         pop_context("ProcedureRow", rows("historyProcedures", "Procedure")), GTABLE,
         repeats=True, readOnly=True, item=[
             item("pam-history-procedure-code", "Procedure", "choice", control("autocomplete"), initial("%ProcedureRow.code.coding.first()"),
                  answerValueSet=VS_PROCEDURE),
             item("pam-history-procedure-date", "Date", "date",
                  initial("%ProcedureRow.performed.toString().substring(0, 10)")),
         ]),
    item("pam-history-medication", "Current medications", "group",
         pop_context("MedicationRow", rows("historyMedications", "MedicationStatement")), GTABLE,
         repeats=True, readOnly=True, item=[
             item("pam-history-medication-code", "Medication", "choice", control("autocomplete"),
                  initial("%MedicationRow.medication.coding.first()"), answerValueSet=VS_MEDICINE),
             item("pam-history-medication-dose", "Dose", "string", initial("%MedicationRow.dosage.text.first()")),
         ]),
    item("pam-history-allergy", "Allergies and adverse reactions", "group",
         pop_context("AllergyRow", rows("historyAllergies", "AllergyIntolerance")), GTABLE,
         repeats=True, readOnly=True, item=[
             item("pam-history-allergy-code", "Substance", "choice", control("autocomplete"), initial("%AllergyRow.code.coding.first()"),
                  answerValueSet=VS_SUBSTANCE),
             item("pam-history-allergy-reaction", "Reaction", "choice", control("autocomplete"),
                  initial("%AllergyRow.reaction.manifestation.coding.first()"), answerValueSet=VS_FINDING),
             item("pam-history-allergy-criticality", "Criticality", "choice", initial("%AllergyRow.criticality"),
                  answerOption=options(CRIT, [("low", "Low Risk"), ("high", "High Risk"), ("unable-to-assess", "Unable to Assess Risk")])),
         ]),
])

GI_SYMPTOMS = [("2901004", "Melaena"), ("405729008", "Haematochezia"), ("8765009", "Haematemesis"),
               ("88111009", "Altered bowel function"), ("162031009", "Indigestion"),
               ("21522001", "Abdominal pain"), ("262285001", "Weight loss")]
SCOPES = [("386831001", "Gastroscopy"), ("73761001", "Colonoscopy"), ("427595003", "Capsule endoscopy")]
CKD = [("431855005", "Chronic kidney disease stage 1"), ("431856006", "Chronic kidney disease stage 2"),
       ("433144002", "Chronic kidney disease stage 3"), ("431857002", "Chronic kidney disease stage 4"),
       ("433146000", "Chronic kidney disease stage 5"), ("709044004", "Chronic kidney disease")]
IBD = [("34000006", "Crohn's disease"), ("64766004", "Ulcerative colitis"), ("24526004", "Inflammatory bowel disease")]
IV_IRON = [("1312141000168105", "Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial"),
           ("1086251000168104", "Iron (as ferric derisomaltose) 100 mg/mL injection, vial")]

# Smart Forms maps each contained template to ONE item, so every comorbidity gets its own copy of the
# Condition template (PAMHistoryCondition<Slug>Template); a shared template extracts nothing.
COND_SLUGS = []


def cond_extract(slug):
    COND_SLUGS.append(slug)
    return template_extract(f"PAMHistoryCondition{slug.capitalize()}Template", none_exist("answer.value"))


def comorbidity(slug, text, type_item, *follow_ups):
    return item(f"pam-history-{slug}", text, "boolean", item=[
        dict(type_item, enableWhen=[when(f"pam-history-{slug}")]),
        *follow_ups,
    ])


screening = item("pam-history-screen", "Bleeding and anaemia screening", "group", item=[
    # GI tree: symptoms -> investigated? -> endoscopy (repeating) -> result -> findings
    item("pam-history-gi", "Gastrointestinal symptoms or blood loss?", "boolean", item=[
        item("pam-history-gi-symptoms", "Symptoms", "choice", control("check-box"), repeats=True,
             enableWhen=[when("pam-history-gi")], answerOption=options(SCT, GI_SYMPTOMS)),
        item("pam-history-gi-investigated", "Investigated with endoscopy?", "choice", control("radio-button"),
             enableWhen=[when("pam-history-gi")],
             answerOption=str_options("Yes, done", "Planned / referred", "Not investigated")),
        item("pam-history-scope", "Endoscopy", "group",
             template_extract("PAMEndoscopyTemplate",
                              none_exist(child("pam-history-scope-type"),
                                         " + '&date=' + " + child("pam-history-scope-date") + ".toString()")),
             repeats=True, enableWhen=[when("pam-history-gi-investigated", answerString="Yes, done")], item=[
                 item("pam-history-scope-type", "Procedure", "choice", required=True, answerOption=options(SCT, SCOPES)),
                 item("pam-history-scope-date", "Date", "date"),
                 item("pam-history-scope-result", "Result", "choice", control("radio-button"),
                      answerOption=str_options("Normal", "Abnormal")),
                 item("pam-history-scope-findings", "Findings", "text",
                      enableWhen=[when("pam-history-scope-result", answerString="Abnormal")]),
             ]),
        item("pam-history-gi-planned", "Planned date", "date",
             enableWhen=[when("pam-history-gi-investigated", answerString="Planned / referred")]),
    ]),
    # Heavy menstrual bleeding: female patients only (shared root variable %sexCode)
    item("pam-history-hmb", "Heavy menstrual bleeding?", "boolean", enable_expr("%sexCode = 'female'"), item=[
        item("pam-history-hmb-reviewed", "Reviewed by gynaecology?", "boolean",
             enableWhen=[when("pam-history-hmb")], item=[
                 item("pam-history-hmb-plan", "Management plan", "text",
                      enableWhen=[when("pam-history-hmb-reviewed")]),
             ]),
    ]),
    # Anticoagulants / antiplatelets: AMT refinement ECL
    item("pam-history-antithrombotic", "Taking an anticoagulant or antiplatelet medicine?", "boolean", item=[
        item("pam-history-antithrombotic-med", "Medicine", "choice", control("autocomplete"), repeats=True,
             enableWhen=[when("pam-history-antithrombotic")], answerValueSet=VS_ANTITHROMBOTIC),
        item("pam-history-antithrombotic-plan", "Plan before surgery", "choice", control("radio-button"),
             enableWhen=[when("pam-history-antithrombotic")],
             answerOption=str_options("Stop before surgery", "Stop with bridging", "Continue", "Not yet decided"), item=[
                 item("pam-history-antithrombotic-stop", "Last dose on", "date", enableBehavior="any",
                      enableWhen=[when("pam-history-antithrombotic-plan", answerString="Stop before surgery"),
                                  when("pam-history-antithrombotic-plan", answerString="Stop with bridging")]),
             ]),
    ]),
    # Transfusion: -> details (extracted as a Procedure) -> reaction? -> reaction type (Procedure.complication)
    item("pam-history-transfusion", "Previous blood transfusion?", "boolean", item=[
        item("pam-history-transfusion-details", "Most recent transfusion", "group",
             template_extract("PAMTransfusionTemplate"),
             enableWhen=[when("pam-history-transfusion")], item=[
                 item("pam-history-transfusion-date", "Date (approximate)", "date"),
                 item("pam-history-transfusion-reaction", "Any transfusion reaction?", "boolean"),
                 item("pam-history-transfusion-reaction-type", "Reaction", "choice", control("autocomplete"),
                      enableWhen=[when("pam-history-transfusion-reaction")], answerValueSet=VS_TRANSFUSION_REACTION),
             ]),
        item("pam-history-transfusion-consent", "Would the patient accept a transfusion if needed?", "choice",
             control("radio-button"), enableWhen=[when("pam-history-transfusion", "exists", answerBoolean=True)], answerOption=str_options("Yes", "Limited consent", "No")),
    ]),
    # Previous iron therapy
    item("pam-history-iron", "Previous iron therapy?", "boolean", item=[
        item("pam-history-iron-route", "Route", "choice", control("radio-button"),
             enableWhen=[when("pam-history-iron")], answerOption=str_options("Oral", "Intravenous"), item=[
                 item("pam-history-iron-product", "IV iron product", "choice",
                      enableWhen=[when("pam-history-iron-route", answerString="Intravenous")],
                      answerOption=options(SCT, IV_IRON)),
                 item("pam-history-iron-reaction", "Reaction to IV iron?", "boolean",
                      enableWhen=[when("pam-history-iron-route", answerString="Intravenous")], item=[
                          item("pam-history-iron-reaction-details", "Details", "text",
                               enableWhen=[when("pam-history-iron-reaction")]),
                      ]),
                 item("pam-history-iron-tolerated", "Oral iron tolerated?", "boolean",
                      enableWhen=[when("pam-history-iron-route", answerString="Oral")]),
             ]),
    ]),
    # Comorbidities associated with anaemia: the coded answer is written back as a Condition
    item("pam-history-comorbidities", "Conditions associated with anaemia", "group", item=[
        comorbidity("ckd", "Chronic kidney disease?",
                    item("pam-history-ckd-stage", "Stage", "choice", cond_extract("ckd"), answerOption=options(SCT, CKD)),
                    item("pam-history-ckd-dialysis", "On dialysis?", "boolean", enableBehavior="any",
                         enableWhen=[when("pam-history-ckd-stage", answerCoding=coding(SCT, "431857002", "Chronic kidney disease stage 4")),
                                     when("pam-history-ckd-stage", answerCoding=coding(SCT, "433146000", "Chronic kidney disease stage 5"))])),
        comorbidity("ibd", "Inflammatory bowel disease?",
                    item("pam-history-ibd-type", "Type", "choice", cond_extract("ibd"), control("radio-button"),
                         answerOption=options(SCT, IBD))),
        comorbidity("cancer", "Cancer?",
                    item("pam-history-cancer-type", "Type", "choice", cond_extract("cancer"), control("autocomplete"),
                         answerValueSet=VS_CANCER),
                    item("pam-history-cancer-active", "Current chemotherapy or radiotherapy?", "boolean",
                         enableWhen=[when("pam-history-cancer")])),
        comorbidity("coag", "Bleeding or clotting disorder?",
                    item("pam-history-coag-type", "Type", "choice", cond_extract("coag"), control("autocomplete"),
                         answerValueSet=VS_COAG)),
        comorbidity("liver", "Liver disease?",
                    item("pam-history-liver-type", "Type", "choice", cond_extract("liver"), control("autocomplete"),
                         answerValueSet=VS_LIVER)),
    ]),
])

add_new = item("pam-history-add", "Add to the patient's record", "group", item=[
    item("pam-history-new-condition", "New condition", "group",
         template_extract("PAMHistoryNewConditionTemplate", none_exist(child("pam-history-new-condition-code"))),
         repeats=True, item=[
             item("pam-history-new-condition-code", "Condition", "choice", control("autocomplete"),
                  answerValueSet=VS_FINDING),
             item("pam-history-new-condition-status", "Status", "choice", control("radio-button"),
                  answerOption=options(CLIN, [("active", "Active"), ("resolved", "Resolved")])),
             item("pam-history-new-condition-onset", "Onset", "date"),
         ]),
    item("pam-history-new-procedure", "New past procedure", "group",
         template_extract("PAMHistoryNewProcedureTemplate", none_exist(child("pam-history-new-procedure-code"))),
         repeats=True, item=[
             item("pam-history-new-procedure-code", "Procedure", "choice", control("autocomplete"),
                  answerValueSet=VS_PROCEDURE),
             item("pam-history-new-procedure-date", "Date", "date"),
         ]),
])

# --- Templates -------------------------------------------------------------------------------
SUBJECT = {"_reference": tpl_value("%resource.subject.reference")}
PROBLEM_LIST = [{"coding": [coding(CCAT, "problem-list-item", "Problem List Item")]}]
CONFIRMED = {"coding": [coding(VER, "confirmed", "Confirmed")]}

templates = [
    {"resourceType": "Condition", "id": f"PAMHistoryCondition{slug.capitalize()}Template",
     "clinicalStatus": {"coding": [coding(CLIN, "active", "Active")]},
     "verificationStatus": CONFIRMED, "category": PROBLEM_LIST,
     "code": {"coding": [tpl_value("answer.value")]},
     "subject": SUBJECT, "_recordedDate": tpl_value("now().toString()")}
    for slug in COND_SLUGS
] + [
    {"resourceType": "Condition", "id": "PAMHistoryNewConditionTemplate",
     "clinicalStatus": {"coding": [tpl_value(child("pam-history-new-condition-status"))]},
     "verificationStatus": CONFIRMED, "category": PROBLEM_LIST,
     "code": {"coding": [tpl_value(child("pam-history-new-condition-code"))]},
     "subject": SUBJECT,
     "_onsetDateTime": tpl_value(child("pam-history-new-condition-onset") + ".toString()"),
     "_recordedDate": tpl_value("now().toString()")},
    {"resourceType": "Procedure", "id": "PAMHistoryNewProcedureTemplate", "status": "completed",
     "code": {"coding": [tpl_value(child("pam-history-new-procedure-code"))]},
     "subject": SUBJECT,
     "_performedDateTime": tpl_value(child("pam-history-new-procedure-date") + ".toString()")},
    {"resourceType": "Procedure", "id": "PAMEndoscopyTemplate", "status": "completed",
     "category": {"coding": [coding(SCT, "103693007", "Diagnostic procedure")]},
     "code": {"coding": [tpl_value(child("pam-history-scope-type"))]},
     "subject": SUBJECT,
     "_performedDateTime": tpl_value(child("pam-history-scope-date") + ".toString()"),
     "note": [{"_text": tpl_value(child("pam-history-scope-result") + " + iif(" + child("pam-history-scope-findings")
                                  + ".exists(), ': ' + " + child("pam-history-scope-findings") + ", '')")}]},
    {"resourceType": "Procedure", "id": "PAMTransfusionTemplate", "status": "completed",
     "code": {"coding": [coding(SCT, "116863004", "Transfusion of red blood cells")]},
     "subject": SUBJECT,
     "_performedDateTime": tpl_value(child("pam-history-transfusion-date") + ".toString()"),
     "complication": [{"coding": [tpl_value(child("pam-history-transfusion-reaction-type"))]}]},
]

def flatten(it):
    """Children of a question go to a wrapper group (question + its follow-ups as siblings).

    Smart Forms' template extraction finds the item carrying templateExtract by walking
    QuestionnaireResponse item.item only, not answer.item (where children of a question live), so
    an extractable item nested under a question is never extracted. The enableWhen tree is the same;
    the question's own enable conditions move to the wrapper group."""
    if "item" in it:
        it["item"] = [flatten(c) for c in it["item"]]
    if it["type"] in ("group", "display") or "item" not in it:
        return it
    kids = it.pop("item")
    wrapper = {"linkId": f"{it['linkId']}-group", "type": "group"}
    for k in ("enableWhen", "enableBehavior"):
        if k in it:
            wrapper[k] = it.pop(k)
    keep = [e for e in it.get("extension", []) if not e["url"].endswith("enableWhenExpression")]
    moved = [e for e in it.get("extension", []) if e["url"].endswith("enableWhenExpression")]
    if moved:
        wrapper["extension"] = moved
        it["extension"] = keep
        if not keep:
            del it["extension"]
    wrapper["item"] = [it] + kids
    return wrapper


screening = flatten(screening)

top = {
    "linkId": "pam-history", "text": "History", "type": "group",
    "extension": QUERIES,
    "item": [
        item("pam-history-module", "Module", "string", HIDDEN, initial=[{"valueString": f"pam-history|{VERSION}"}]),
        on_record, screening, add_new,
    ],
}

PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")
common = {"status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER, "contained": templates}

module = {
    "resourceType": "Questionnaire", "id": "soln-pam-history",
    "extension": [CHILD, PATIENT_CONTEXT],
    "url": f"{BASE}/pam-history", "version": VERSION,
    "name": "PAMHistory", "title": "PAM module — Past medical and surgical history (full solution A4)",
    **common,
    "description": "Solution to Track 1 scenario A4. Uses the root's shared variable sexCode (no new shared variables).",
    "item": [top],
}

# Standalone: the root variable sexCode reads the pam-sex answer (Patient details module), so the
# standalone form carries a hidden pam-sex item pre-populated from the Patient.
SEX = item("pam-sex", "Sex", "choice", HIDDEN, initial("%patient.gender"), answerOption=options(
    "http://hl7.org/fhir/administrative-gender",
    [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Unknown")]))
standalone = {
    "resourceType": "Questionnaire", "id": "soln-A4-standalone",
    "extension": [PATIENT_CONTEXT,
                  variable("sexCode", "%resource.repeat(item).where(linkId='pam-sex').answer.value.code")],
    "url": f"{BASE}/A4-standalone", "version": VERSION,
    "name": "PAMHistoryStandalone", "title": "A4 Past medical and surgical history — standalone test form",
    **common,
    "description": "The A4 module plus the root variable sexCode and a hidden pam-sex item, so it runs on its own in the Smart Forms playground.",
    "item": [SEX, top],
}

# --- Test data (own test patient) ------------------------------------------------------------
P = "soln-A4-patient-1"
subj = {"reference": f"Patient/{P}"}


def cond(i, code, display, onset, status="active", category="problem-list-item"):
    return {"resourceType": "Condition", "id": f"{P}-condition-{i}",
            "clinicalStatus": {"coding": [coding(CLIN, status, status.capitalize())]},
            "verificationStatus": CONFIRMED,
            "category": [{"coding": [coding(CCAT, category, {"problem-list-item": "Problem List Item",
                                                            "encounter-diagnosis": "Encounter Diagnosis"}[category])]}],
            "code": {"coding": [coding(SCT, code, display)], "text": display}, "subject": subj, "onsetDateTime": onset}


test_resources = [
    {"resourceType": "Patient", "id": P, "name": [{"use": "official", "given": ["Blair"], "family": "Solnfour"}],
     "gender": "female", "birthDate": "1954-08-02",
     "address": [{"use": "home", "city": "Nundah", "state": "QLD", "postalCode": "4012", "country": "AU"}]},
    cond(1, "433144002", "Chronic kidney disease stage 3", "2021-05-10"),
    cond(2, "44054006", "Type 2 diabetes", "2015-03-01"),
    cond(3, "239873007", "Osteoarthritis of knee", "2019-11-20"),
    # The PAM diagnosis (A6's job) — must NOT appear in the history list
    cond(4, "87522002", "Iron deficiency anaemia", "2026-10-01", category="encounter-diagnosis"),
    {"resourceType": "Procedure", "id": f"{P}-procedure-1", "status": "completed",
     "code": {"coding": [coding(SCT, "80146002", "Appendicectomy")], "text": "Appendicectomy"},
     "subject": subj, "performedDateTime": "1989-07-10"},
    {"resourceType": "Procedure", "id": f"{P}-procedure-2", "status": "completed",
     "code": {"coding": [coding(SCT, "73761001", "Colonoscopy")], "text": "Colonoscopy"},
     "subject": subj, "performedDateTime": "2024-02-15"},
    {"resourceType": "MedicationStatement", "id": f"{P}-medication-1", "status": "active",
     "medicationCodeableConcept": {"coding": [coding(SCT, "134251000036103", "Apixaban 5 mg tablet")]},
     "subject": subj, "dosage": [{"text": "5 mg twice daily"}]},
    {"resourceType": "MedicationStatement", "id": f"{P}-medication-2", "status": "active",
     "medicationCodeableConcept": {"coding": [coding(SCT, "23358011000036102", "Metformin hydrochloride 500 mg tablet")]},
     "subject": subj, "dosage": [{"text": "500 mg twice daily"}]},
    {"resourceType": "MedicationStatement", "id": f"{P}-medication-3", "status": "completed",
     "medicationCodeableConcept": {"coding": [coding(SCT, "71724000", "Ferrous sulfate")]},
     "subject": subj, "dosage": [{"text": "Stopped: not tolerated"}]},
    {"resourceType": "AllergyIntolerance", "id": f"{P}-allergy-1",
     "clinicalStatus": {"coding": [coding("http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "active", "Active")]},
     "criticality": "high",
     "code": {"coding": [coding(SCT, "764146007", "Penicillin")], "text": "Penicillin"},
     "patient": subj, "reaction": [{"manifestation": [{"coding": [coding(SCT, "271807003", "Rash")]}]}]},
]
test_bundle = {"resourceType": "Bundle", "type": "transaction", "entry": [
    {"resource": r, "request": {"method": "PUT", "url": f"{r['resourceType']}/{r['id']}"}} for r in test_resources]}

for name, res in [("soln-pam-history.json", module), ("soln-A4-standalone.json", standalone),
                  ("test-data.json", test_bundle)]:
    (HERE / name).write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n")
print("Wrote soln-pam-history.json, soln-A4-standalone.json, test-data.json")
