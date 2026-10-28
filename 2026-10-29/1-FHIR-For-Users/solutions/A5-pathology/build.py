#!/usr/bin/env python3
"""A5 Pathology results (full solution): builds the module and the standalone test form.

    python3 build.py      # writes soln-pam-pathology.json and soln-A5-standalone.json

Extends questionnaires/modules/pam-pathology.json (0.1.0): same linkIds and variable names for
everything that was there (pam-hb, pam-ferritin, pam-tsat, pam-crp, pam-hb-date, pam-ext...,
latestHb, latestFerritin, latestTsat, latestCrp), plus MCV, B12, folate and eGFR, initial vs
post-treatment results, the full result history, and more complete hand-entered results.
"""
import json
from pathlib import Path

from sdc import (LOINC, UCUM, answer, calculated, coding, ext, fhirpath, initial, item, item_control,
                 module, module_item, population_context, query, readonly, standalone, template_extract,
                 tpl_value, unit, xhtml_display)

HERE = Path(__file__).parent

# key, LOINC codes searched (first = the one written back), short name, UCUM code, unit display,
# LOINC display of the written-back code
TESTS = [
    ("hb", ["718-7"], "Haemoglobin (Hb)", "g/L", "g/L", "Hemoglobin [Mass/volume] in Blood"),
    ("ferritin", ["2276-4"], "Ferritin", "ug/L", "µg/L", "Ferritin [Mass/volume] in Serum or Plasma"),
    ("tsat", ["2502-3"], "Transferrin saturation (TSAT)", "%", "%", "Iron saturation [Mass Fraction] in Serum or Plasma"),
    ("crp", ["1988-5"], "C-reactive protein (CRP)", "mg/L", "mg/L", "C reactive protein [Mass/volume] in Serum or Plasma"),
    ("mcv", ["787-2"], "Mean cell volume (MCV)", "fL", "fL", "MCV [Entitic mean volume] in Red Blood Cells by Automated count"),
    ("b12", ["14685-2"], "Vitamin B12", "pmol/L", "pmol/L", "Cobalamin (Vitamin B12) [Moles/volume] in Serum or Plasma"),
    ("folate", ["14732-2"], "Folate (serum)", "nmol/L", "nmol/L", "Folate [Moles/volume] in Serum or Plasma"),
    ("egfr", ["62238-1", "98979-8"], "eGFR", "mL/min/{1.73_m2}", "mL/min/1.73 m²",
     "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI)/1.73 sq M"),
]
VAR = {k: f"latest{k[0].upper()}{k[1:]}" for k, *_ in TESTS}  # latestHb, latestFerritin, ... latestEgfr
ALL_CODES = [c for _, codes, *_ in TESTS for c in codes]


def code_param(codes):
    return ",".join(f"{LOINC}|{c}" for c in codes)


def latest_obs(var, codes):
    return query(var, f"Observation?code={code_param(codes)}&patient={{{{%patient.id}}}}&_sort=-date&_count=1")


def code_in(codes):
    """FHIRPath test on an Observation: has one of these LOINC codes."""
    cond = f"code = '{codes[0]}'" if len(codes) == 1 else "(" + " or ".join(f"code = '{c}'" for c in codes) + ")"
    return f"code.coding.where(system = '{LOINC}' and {cond}).exists()"


def switch(on, mapping, default="{}"):
    """Nested iif: the value for the first key equal to `on`."""
    expr = default
    for key, value in reversed(mapping):
        expr = f"iif({on} = '{key}', '{value}', {expr})"
    return expr


# --- Initial vs post-treatment ------------------------------------------------------------------
# Anchor: the most recent IV iron MedicationRequest (authoredOn). With one:
#   initial = latest result on or before that date, post-treatment = latest result after it.
# Without one (not treated, e.g. anaemia of chronic disease), as on the PAM dashboard:
#   initial = earliest result, post-treatment = latest result if there is more than one.
IRON = ("where(status != 'entered-in-error' and status != 'cancelled'"
        " and dosageInstruction.route.coding.where(system = 'http://snomed.info/sct' and code = '47625008').exists()"
        " and (medication.text | medication.coding.display)"
        ".where(lower().matches('.*(iron|ferr|ferumoxytol|ferinject|monofer|venofer).*')).exists())")
TREAT_DATE = f"%pathIvIron.entry.resource.{IRON}.authoredOn.first().toString().substring(0, 10)"
DAY = "effective.toString().substring(0, 10)"


def history(codes):
    return f"%pathHistory.entry.resource.where({code_in(codes)})"  # newest first (_sort=-date)


def initial_obs(codes):
    h = history(codes)
    return f"iif({TREAT_DATE}.exists(), {h}.where({DAY} <= {TREAT_DATE}).first(), {h}.last())"


def post_obs(codes):
    h = history(codes)
    return (f"iif({TREAT_DATE}.exists(), {h}.where({DAY} > {TREAT_DATE}).first(), "
            f"iif({h}.count() > 1, {h}.first(), {{}}))")


# --- Items --------------------------------------------------------------------------------------

latest_items = []
for k, codes, name, ucum, udisp, _ in TESTS:
    latest_items.append(item(f"pam-{k}", name, "decimal", unit(ucum, udisp),
                             initial(f"%{VAR[k]}.entry.resource.value.value")))
    latest_items.append(readonly(item(f"pam-{k}-date", f"{name.split(' (')[0]}: collected", "date",
                                      initial(f"%{VAR[k]}.entry.resource.{DAY}"))))

compare_rows = []
for k, codes, name, ucum, udisp, _ in TESTS:
    compare_rows.append(item(f"pam-{k}-compare", name, "group", item=[
        readonly(item(f"pam-{k}-initial", "Initial", "decimal", unit(ucum, udisp),
                      initial(f"({initial_obs(codes)}).value.value"))),
        readonly(item(f"pam-{k}-initial-date", "Initial: collected", "date",
                      initial(f"({initial_obs(codes)}).{DAY}"))),
        readonly(item(f"pam-{k}-post", "Post-treatment", "decimal", unit(ucum, udisp),
                      initial(f"({post_obs(codes)}).value.value"))),
        readonly(item(f"pam-{k}-post-date", "Post-treatment: collected", "date",
                      initial(f"({post_obs(codes)}).{DAY}"))),
        readonly(item(f"pam-{k}-change", "Change", "decimal", unit(ucum, udisp),
                      calculated(f"({answer(f'pam-{k}-post')} - {answer(f'pam-{k}-initial')}).round(1)"))),
    ]))

SHORT_BY_CODE = [(c, name) for _, codes, name, *_ in TESTS for c in codes]
hist_group = item(
    "pam-path-history", "All results (newest first)", "group",
    population_context("pathResult", "%pathHistory.entry.resource"), item_control("gtable"),
    repeats=True, readOnly=True, item=[
        readonly(item("pam-hist-date", "Collected", "date", initial(f"%pathResult.{DAY}"))),
        readonly(item("pam-hist-test", "Test", "string", initial(switch(
            f"%pathResult.code.coding.where(system = '{LOINC}').code.first()", SHORT_BY_CODE,
            "%pathResult.code.text")))),
        readonly(item("pam-hist-value", "Result", "decimal", initial("%pathResult.value.value"))),
        readonly(item("pam-hist-unit", "Unit", "string", initial("%pathResult.value.unit"))),
        readonly(item("pam-hist-phase", "Before / after IV iron", "string", initial(
            f"iif({TREAT_DATE}.exists(), iif(%pathResult.{DAY} <= {TREAT_DATE}, 'Before', 'After'), {{}})"))),
        readonly(item("pam-hist-lab", "Laboratory", "string", initial("%pathResult.performer.display.first()"))),
    ])

# Hand-entered results from an external lab -> one Observation per repeat
EXT_TEST = "item.where(linkId='pam-ext-test').answer.value.code"
ext_codes = [(codes[0], name, ucum, udisp, ldisp) for _, codes, name, ucum, udisp, ldisp in TESTS]
obs_template = {
    "resourceType": "Observation", "id": "PAMExternalResultTemplate", "status": "final",
    "category": [{"coding": [coding("http://terminology.hl7.org/CodeSystem/observation-category", "laboratory", "Laboratory")]}],
    "code": {
        "coding": [{"system": LOINC, "_code": tpl_value(EXT_TEST),
                    "_display": tpl_value(switch(EXT_TEST, [(c, l) for c, _, _, _, l in ext_codes]))}],
        "_text": tpl_value(switch(EXT_TEST, [(c, n) for c, n, _, _, _ in ext_codes])),
    },
    "subject": {"_reference": tpl_value("%resource.subject.reference")},
    "_effectiveDateTime": tpl_value("item.where(linkId='pam-ext-date').answer.value.toString()"),
    "performer": [{"_display": tpl_value("item.where(linkId='pam-ext-lab').answer.value")}],
    "valueQuantity": {
        "_value": tpl_value("item.where(linkId='pam-ext-value').answer.value"),
        "system": UCUM,
        "_code": tpl_value(switch(EXT_TEST, [(c, u) for c, _, u, _, _ in ext_codes])),
        "_unit": tpl_value(switch(EXT_TEST, [(c, d) for c, _, _, d, _ in ext_codes])),
    },
    "note": [{"text": "Entered by hand from an external laboratory report (PAM form)."}],
}
ext_group = item(
    "pam-ext", "Results from an external lab", "group", template_extract("PAMExternalResultTemplate"),
    repeats=True, item=[
        item("pam-ext-test", "Test", "choice", answerOption=[
            {"valueCoding": coding(LOINC, c, f"{n}, {d}")} for c, n, _, d, _ in ext_codes]),
        item("pam-ext-value", "Result (in the unit shown with the test)", "decimal"),
        item("pam-ext-date", "Collected", "date"),
        item("pam-ext-lab", "Laboratory", "string"),
    ])

queries = [latest_obs(VAR[k], codes) for k, codes, *_ in TESTS] + [
    query("pathHistory", f"Observation?code={code_param(ALL_CODES)}&patient={{{{%patient.id}}}}&_sort=-date&_count=200"),
    query("pathIvIron", "MedicationRequest?patient={{%patient.id}}&_sort=-authoredon&_count=50"),
]

top = {
    "linkId": "pam-pathology", "text": "Pathology", "type": "group",
    "extension": queries,
    "item": [
        module_item("pathology"),
        item("pam-path-latest", "Latest results", "group", item=latest_items),
        item("pam-path-compare", "Initial vs post-treatment", "group", item=[
            xhtml_display(
                "pam-path-compare-intro",
                "Initial = latest result on or before the most recent IV iron order; post-treatment = latest "
                "result after it. With no IV iron order: initial = earliest result, post-treatment = latest.",
                "<p>Initial = latest result on or before the most recent IV iron order; post-treatment = latest "
                "result after it. With no IV iron order: initial = earliest result, post-treatment = latest.</p>"),
            readonly(item("pam-path-treatment-date", "Most recent IV iron order", "date",
                          initial(TREAT_DATE))),
        ] + compare_rows),
        hist_group,
        ext_group,
    ],
}

mod = module("pathology", "Pathology results", top, contained=[obs_template],
             description="Full solution for scenario A5: latest Hb, ferritin, TSAT, CRP, MCV, B12, folate and eGFR; "
                         "initial vs post-treatment results; result history; hand-entered external results "
                         "written back as Observations. Extends pam-pathology 0.1.0. Synthetic demo, not for clinical use.")

# Standalone: the module's item and template; this module needs no root variables.
alone = standalone("A5", "A5 Pathology results (standalone test form)", [],
                   [json.loads(json.dumps(top))], contained=[obs_template],
                   description="Runs the A5 pathology module on its own in the Smart Forms playground. "
                               "Synthetic demo, not for clinical use.")

for q in (mod, alone):
    (HERE / f"{q['id']}.json").write_text(json.dumps(q, indent=2, ensure_ascii=False) + "\n")
print("Wrote", mod["id"], alone["id"])
