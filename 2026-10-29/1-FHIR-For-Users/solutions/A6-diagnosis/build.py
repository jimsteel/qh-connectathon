#!/usr/bin/env python3
"""A6 Diagnosis + decision support (full solution): builds the module, the standalone test form and
the root-variable snippet.

    python3 build.py      # writes soln-pam-diagnosis.json, soln-A6-standalone.json, root-variables.json

Extends questionnaires/modules/pam-diagnosis.json (0.1.0): keeps pam-anaemia, pam-iron-deficiency,
pam-inflammation, pam-diagnosis and the PAMDiagnosisTemplate, and adds the pathway classification,
a suggested SNOMED CT-AU diagnosis, Flag (limited consent / refusal of blood products) and Goal
(requested target Hb) write-back. Helpers come from ../A5-pathology/sdc.py.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "A5-pathology"))
from sdc import (LOCAL, LOINC, SCT, UCUM, answer, calculated, coding, enable_when_expr, ext, fhirpath,  # noqa: E402
                 initial, item, item_control, module, module_item, query, readonly, standalone,
                 template_extract, tpl_value, unit, xhtml_display, HIDDEN)

# --- Shared (root) variables ----------------------------------------------------------------------
# Existing on pam-root 0.1.0 (unchanged): sexCode, hb, ferritin, tsat, crp, hbThreshold.
# New (must be added to the root for the assembled form): mcv, egfr, anaemia, ironDeficiency,
# inflammation, pathway, suggestedDxCode.
EXISTING_ROOT = [
    fhirpath("sexCode", answer("pam-sex") + ".code"),
    fhirpath("hb", answer("pam-hb")), fhirpath("ferritin", answer("pam-ferritin")),
    fhirpath("tsat", answer("pam-tsat")), fhirpath("crp", answer("pam-crp")),
]
ROOT_HB_THRESHOLD = fhirpath("hbThreshold", "iif(%sexCode = 'male', 130, 120)")  # as on pam-root 0.1.0
# Proposed: no threshold (so no classification) when sex is other / unknown / not recorded.
STRICT_HB_THRESHOLD = fhirpath("hbThreshold", "iif(%sexCode = 'male', 130, iif(%sexCode = 'female', 120, {}))")

PATHWAYS = [  # code, text, suggested SNOMED CT-AU diagnosis
    ("ida", "Iron deficiency anaemia: iron replacement (see Treatment)", ("87522002", "Iron deficiency anaemia")),
    ("acd", "Anaemia with inflammation (CRP > 10 mg/L) and possible functional iron deficiency "
            "(ferritin 100–300 µg/L, TSAT < 20%): anaemia of chronic disease; consider IV iron and medical review",
     ("234347009", "Anaemia of chronic disease")),
    ("id", "Iron deficiency without anaemia: consider iron replacement", ("35240004", "Iron deficiency")),
    ("anaemia", "Anaemia without iron deficiency: look for other causes (B12, folate, renal function, "
                "haematology review)", ("271737000", "Anaemia")),
    ("none", "No anaemia or iron deficiency: no blood management intervention needed", None),
]
NEW_ROOT = [
    fhirpath("mcv", answer("pam-mcv")),
    fhirpath("egfr", answer("pam-egfr")),
    fhirpath("anaemia", "%hb <= %hbThreshold"),
    fhirpath("ironDeficiency", "%ferritin < 100 or (%tsat < 20 and %ferritin >= 100 and %ferritin <= 300)"),
    fhirpath("inflammation", "%crp > 10"),
    # Needs Hb, ferritin and (when ferritin >= 100) TSAT; CRP only decides IDA vs ACD when ferritin is 100-300.
    fhirpath("pathway",
             "iif(%anaemia.empty() or %ironDeficiency.empty(), {}, "
             "iif(%anaemia, "
             "iif(%ferritin < 100, 'ida', iif(%ironDeficiency, iif(%inflammation, 'acd', 'ida'), 'anaemia')), "
             "iif(%ironDeficiency, 'id', 'none')))"),
    fhirpath("suggestedDxCode", "iif(%pathway = 'ida', '87522002', iif(%pathway = 'acd', '234347009', "
                                "iif(%pathway = 'id', '35240004', iif(%pathway = 'anaemia', '271737000', {}))))"),
]


def switch(on, mapping, default="{}"):
    expr = default
    for key, value in reversed(mapping):
        expr = f"iif({on} = '{key}', '{value}', {expr})"
    return expr


PATHWAY_TEXT = switch("%pathway", [(c, t) for c, t, _ in PATHWAYS])
# Extra hints for anaemia without iron deficiency (& treats empty as '', so missing MCV / eGFR are fine)
PATHWAY_EXPR = (f"iif(%pathway.exists(), {PATHWAY_TEXT} & iif(%pathway = 'anaemia', "
                "iif(%mcv > 100, '. Macrocytic (MCV > 100 fL)', iif(%mcv < 80, '. Microcytic (MCV < 80 fL)', '')) & "
                "iif(%egfr < 60, '. eGFR < 60: consider anaemia of chronic kidney disease', ''), ''), {})")
SUGGESTED_EXPR = ("iif(%suggestedDxCode.exists(), "
                  + switch("%suggestedDxCode", [(dx[0], f"{dx[1]} (SNOMED CT {dx[0]})") for _, _, dx in PATHWAYS if dx])
                  + ", iif(%pathway = 'none', 'None: no anaemia or iron deficiency', {}))")

# --- Diagnosis → Condition --------------------------------------------------------------------------
DIAGNOSES = [("87522002", "Iron deficiency anaemia"), ("35240004", "Iron deficiency"),
             ("234347009", "Anaemia of chronic disease"), ("707323002", "Anaemia in chronic kidney disease"),
             ("271737000", "Anaemia")]
DX_ECL = "<< 271737000 OR << 35240004"  # anaemias and iron deficiency
DX_VS = f"http://snomed.info/sct/32506021000036107?fhir_vs=ecl/{DX_ECL}"
condition_template = {
    "resourceType": "Condition", "id": "PAMDiagnosisTemplate",
    "clinicalStatus": {"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active")]},
    "verificationStatus": {"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed")]},
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/condition-category", "encounter-diagnosis", "Encounter Diagnosis")]}],
    "code": {"coding": [tpl_value("answer.value")]},
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_recordedDate": tpl_value("now().toString()"),
    "note": [{"_text": tpl_value(f"iif({answer('pam-pathway')}.exists(), "
                                 f"'Pathway (PAM decision support): ' & {answer('pam-pathway')}, {{}})")}],
}

# --- Blood products → Flag --------------------------------------------------------------------------
CONSENT_CS = f"{LOCAL}/blood-product-consent"
REASON_CS = f"{LOCAL}/blood-product-refusal-reason"
CONSENT = [("full", "Consents to all blood products"),
           ("limited", "Limited consent: accepts some blood products only"),
           ("refused", "Refuses all blood products")]
REASONS = [("religious", "Religious belief (e.g. Jehovah's Witness)"), ("personal", "Personal preference"),
           ("other", "Other")]
PRODUCTS = [("126242007", "Red blood cells, blood product"), ("256395009", "Platelet product"),
            ("346447007", "Fresh frozen plasma"), ("256401009", "Cryoprecipitate"),
            ("789265003", "Albumin human only product"), ("714569001", "Normal immunoglobulin")]
C_CODE = answer("pam-blood-consent") + ".code"
REASON = answer("pam-blood-reason")
DECLINED = answer("pam-blood-declined")
DETAILS = answer("pam-blood-details")
RELIGIOUS = f"{REASON}.code = 'religious'"
FLAG_TEXT = (f"iif({C_CODE} = 'refused', 'Refuses all blood products', 'Limited consent to blood products' & "
             f"iif({DECLINED}.exists(), ': declines ' & {DECLINED}.display.join(', '), '')) & "
             f"iif({REASON}.exists(), '. Reason: ' & {REASON}.display, '') & "
             f"iif({DETAILS}.exists(), '. ' & {DETAILS}, '')")
flag_template = {
    "resourceType": "Flag", "id": "PAMBloodProductFlagTemplate", "status": "active",
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/flag-category", "safety", "Safety")]}],
    "code": {
        "coding": [{"system": SCT,
                    "_code": tpl_value(f"iif({RELIGIOUS}, '708129006', '699054003')"),
                    "_display": tpl_value(f"iif({RELIGIOUS}, 'Transfusion of blood product refused for religious reason', "
                                          "'Administration of blood product declined')")}],
        "_text": tpl_value(FLAG_TEXT),
    },
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "period": {"_start": tpl_value("today().toString()")},
}

# --- Requested target Hb → Goal ---------------------------------------------------------------------
REQUESTER_CS = f"{LOCAL}/target-hb-requester"
REQUESTERS = [("surgeon", "Surgeon"), ("anaesthetist", "Anaesthetist"), ("haematologist", "Haematologist"),
              ("patient", "Patient")]
goal_template = {
    "resourceType": "Goal", "id": "PAMTargetHbGoalTemplate",
    "lifecycleStatus": "active",
    "description": {"_text": tpl_value("'Haemoglobin at least ' & answer.value.toString() & ' g/L before surgery'")},
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_startDate": tpl_value("today().toString()"),
    "target": [{
        "measure": {"coding": [coding(LOINC, "718-7", "Hemoglobin [Mass/volume] in Blood")]},
        "detailQuantity": {"comparator": ">=", "_value": tpl_value("answer.value"),
                           "unit": "g/L", "system": UCUM, "code": "g/L"},
        "_dueDate": tpl_value(f"{answer('pam-target-hb-due')}.toString()"),
    }],
    "note": [{"_text": tpl_value(f"iif({answer('pam-target-hb-by')}.exists(), "
                                 f"'Requested by: ' & {answer('pam-target-hb-by')}.display, {{}})")}],
}

ELECTIVE_CS = f"{LOCAL}/elective-category"
SURGERY_QUERY = query("dxWaitlist", "ServiceRequest?patient={{%patient.id}}&status=active&_count=50")
SURGERY_DATE = (f"%dxWaitlist.entry.resource.where(category.coding.where(system = '{ELECTIVE_CS}').exists())"
                ".occurrence.first().toString().substring(0, 10)")

TARGET = answer("pam-target-hb")
top = {
    "linkId": "pam-diagnosis-section", "text": "Diagnosis", "type": "group",
    "extension": [SURGERY_QUERY],
    "item": [
        module_item("diagnosis"),
        xhtml_display("pam-findings-intro", "Findings, calculated from the pathology results and sex",
                      "<p><b>Findings</b>, calculated from the pathology results and sex "
                      "(decision rules from the track's FHIR mapping; to confirm with Metro North)</p>"),
        readonly(item("pam-anaemia", "Anaemia (Hb ≤ 130 g/L male, ≤ 120 g/L female)", "boolean",
                      calculated("%anaemia"))),
        readonly(item("pam-anaemia-severity", "Anaemia severity (WHO)", "string", calculated(
            "iif(%anaemia, iif(%hb < 80, 'Severe (Hb < 80 g/L)', iif(%hb < 110, 'Moderate (Hb 80–109 g/L)', "
            "'Mild (Hb 110 g/L to the threshold)')), {})"))),
        readonly(item("pam-iron-deficiency",
                      "Iron deficiency (ferritin < 100 µg/L, or TSAT < 20% with ferritin 100–300 µg/L)", "boolean",
                      calculated("%ironDeficiency"))),
        readonly(item("pam-inflammation", "Inflammation (CRP > 10 mg/L)", "boolean", calculated("%inflammation"))),
        readonly(item("pam-pathway", "Pathway", "text", calculated(PATHWAY_EXPR))),
        readonly(item("pam-diagnosis-suggested", "Suggested diagnosis", "string", calculated(SUGGESTED_EXPR))),
        item("pam-diagnosis", "Diagnosis (confirm)", "choice", template_extract("PAMDiagnosisTemplate"),
             item_control("radio-button"),
             answerOption=[{"valueCoding": coding(SCT, c, d)} for c, d in DIAGNOSES]),
        xhtml_display(
            "pam-diagnosis-differs", "The diagnosis differs from the suggested one: check the findings.",
            '<p style="color:#B9531A"><b>The diagnosis differs from the suggested one</b>: check the findings.</p>',
            enable_when_expr(f"%suggestedDxCode.exists() and {answer('pam-diagnosis')}.exists() and "
                             f"{answer('pam-diagnosis')}.code != %suggestedDxCode")),
        item("pam-diagnosis-other", "Other diagnosis (search SNOMED CT-AU)", "choice",
             template_extract("PAMOtherDiagnosisTemplate"), item_control("autocomplete"), answerValueSet=DX_VS),
        item("pam-blood-products", "Blood products", "group", item=[
            item("pam-blood-consent", "Consent to blood products", "choice", item_control("radio-button"),
                 answerOption=[{"valueCoding": coding(CONSENT_CS, c, d)} for c, d in CONSENT]),
            item("pam-blood-declined", "Products declined", "choice", item_control("check-box"), repeats=True,
                 enableWhen=[{"question": "pam-blood-consent", "operator": "=",
                              "answerCoding": coding(CONSENT_CS, "limited", CONSENT[1][1])}],
                 answerOption=[{"valueCoding": coding(SCT, c, d)} for c, d in PRODUCTS]),
            item("pam-blood-reason", "Reason", "choice", item_control("radio-button"), enableBehavior="any",
                 enableWhen=[{"question": "pam-blood-consent", "operator": "=",
                              "answerCoding": coding(CONSENT_CS, c, d)} for c, d in CONSENT[1:]],
                 answerOption=[{"valueCoding": coding(REASON_CS, c, d)} for c, d in REASONS]),
            item("pam-blood-details", "Details (e.g. advance health directive, products accepted)", "text",
                 enableBehavior="any",
                 enableWhen=[{"question": "pam-blood-consent", "operator": "=",
                              "answerCoding": coding(CONSENT_CS, c, d)} for c, d in CONSENT[1:]]),
            # Has an answer only for limited consent / refusal, so the Flag is extracted only then.
            readonly(item("pam-blood-flag", "Blood product alert", "string", HIDDEN,
                          calculated(f"{answer('pam-blood-consent')}.where(code = 'limited' or code = 'refused').display"),
                          template_extract("PAMBloodProductFlagTemplate"))),
        ]),
        item("pam-target-hb-group", "Requested target haemoglobin", "group", item=[
            item("pam-target-hb", "Target Hb before surgery", "decimal", unit("g/L"),
                 template_extract("PAMTargetHbGoalTemplate")),
            readonly(item("pam-target-hb-gap", "Increase needed from the latest Hb", "decimal", unit("g/L"),
                          calculated(f"iif({TARGET}.exists() and %hb.exists(), iif({TARGET} > %hb, {TARGET} - %hb, 0), {{}})"))),
            item("pam-target-hb-by", "Requested by", "choice", item_control("radio-button"),
                 answerOption=[{"valueCoding": coding(REQUESTER_CS, c, d)} for c, d in REQUESTERS]),
            item("pam-target-hb-due", "By (booked surgery date)", "date", initial(SURGERY_DATE)),
        ]),
    ],
}

# Smart Forms extracts each contained template once (for one item), so the "other" diagnosis has its own copy.
other_condition_template = dict(condition_template, id="PAMOtherDiagnosisTemplate")
templates = [condition_template, other_condition_template, flag_template, goal_template]
mod = module("diagnosis", "Diagnosis and decision support", top, contained=templates,
             description="Full solution for scenario A6: anaemia, iron deficiency and inflammation and the pathway "
                         "classification as calculated expressions (sex-specific Hb thresholds); a suggested SNOMED CT-AU "
                         "diagnosis written back as a Condition; limited consent / refusal of blood products as a Flag; "
                         "a requested target Hb as a Goal. Needs the root variables in root-variables.json. "
                         "Extends pam-diagnosis 0.1.0. Synthetic demo, not for clinical use.")

# --- Standalone: root variables + the inputs the module needs (sex and pathology), editable ---------
TESTS = [("hb", "718-7", "Haemoglobin (Hb)", "g/L", "g/L"), ("ferritin", "2276-4", "Ferritin", "ug/L", "µg/L"),
         ("tsat", "2502-3", "Transferrin saturation (TSAT)", "%", "%"),
         ("crp", "1988-5", "C-reactive protein (CRP)", "mg/L", "mg/L"),
         ("mcv", "787-2", "Mean cell volume (MCV)", "fL", "fL"),
         ("egfr", f"62238-1,{LOINC}|98979-8", "eGFR", "mL/min/{1.73_m2}", "mL/min/1.73 m²")]
VAR = {k: f"latest{k[0].upper()}{k[1:]}" for k, *_ in TESTS}  # same names as the pathology module
inputs = {
    "linkId": "pam-dx-inputs", "text": "Inputs (in the full form: Patient details and Pathology)", "type": "group",
    "extension": [query(VAR[k], f"Observation?code={LOINC}|{code}&patient={{{{%patient.id}}}}&_sort=-date&_count=1")
                  for k, code, *_ in TESTS],
    "item": [
        xhtml_display("pam-dx-inputs-intro", "Pre-populated from the patient record; change them to try the rules.",
                      "<p>Pre-populated from the patient record; change them to try the rules.</p>"),
        item("pam-sex", "Sex", "choice", initial("%patient.gender"), answerOption=[
            {"valueCoding": coding("http://hl7.org/fhir/administrative-gender", c, d)}
            for c, d in [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Unknown")]]),
    ] + [item(f"pam-{k}", name, "decimal", unit(u, d), initial(f"%{VAR[k]}.entry.resource.value.value"))
         for k, _, name, u, d in TESTS],
}
root_vars = EXISTING_ROOT + [STRICT_HB_THRESHOLD] + NEW_ROOT
alone = standalone("A6", "A6 Diagnosis and decision support (standalone test form)", root_vars,
                   [inputs, json.loads(json.dumps(top))], contained=templates,
                   description="Runs the A6 diagnosis module on its own in the Smart Forms playground, with the root "
                               "variables it needs and editable inputs. Synthetic demo, not for clinical use.")

for q in (mod, alone):
    (HERE / f"{q['id']}.json").write_text(json.dumps(q, indent=2, ensure_ascii=False) + "\n")
(HERE / "root-variables.json").write_text(json.dumps({
    "comment": "Variables the A6 module needs on the PAM root form (pam-root.json). 'existing' are on pam-root 0.1.0; "
               "'new' must be added; 'hbThresholdProposed' is an optional stricter replacement for hbThreshold.",
    "existing": EXISTING_ROOT + [ROOT_HB_THRESHOLD],
    "new": NEW_ROOT,
    "hbThresholdProposed": STRICT_HB_THRESHOLD,
}, indent=2, ensure_ascii=False) + "\n")
print("Wrote", mod["id"], alone["id"], "root-variables.json")
