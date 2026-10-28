"""SDC helpers shared by the A5 (pathology) and A6 (diagnosis) solution builds.

Same shapes as questionnaires/build.py (which can't be imported: it writes files on import).
A6-diagnosis/build.py imports this file from ../A5-pathology.
"""

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
LOINC = "http://loinc.org"
SCT = "http://snomed.info/sct"
UCUM = "http://unitsofmeasure.org"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
BASE = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"


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


def enable_when_expr(expr):
    return ext(f"{SDC}/sdc-questionnaire-enableWhenExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def population_context(name, expr):
    return ext(f"{SDC}/sdc-questionnaire-itemPopulationContext",
               valueExpression={"name": name, "language": "text/fhirpath", "expression": expr})


def unit(code, display=None):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
               valueCoding={"system": UCUM, "code": code, "display": display or code})


def item_control(code):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
               valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control", "code": code}]})


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)


def answer(link_id):
    """FHIRPath for an answer anywhere in the (assembled) response."""
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def readonly(it):
    it["readOnly"] = True
    return it


def xhtml_display(link_id, plain, html, *extensions):
    d = {
        "linkId": link_id, "type": "display", "text": plain,
        "_text": {"extension": [ext("http://hl7.org/fhir/StructureDefinition/rendering-xhtml",
                                    valueString=f'<div xmlns="http://www.w3.org/1999/xhtml">{html}</div>')]},
    }
    if extensions:
        d["extension"] = list(extensions)
    return d


def coding(system, code, display):
    return {"system": system, "code": code, "display": display}


def tpl_value(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def tpl_context(expr):
    return ext(f"{SDC}/sdc-questionnaire-templateExtractContext", valueString=expr)


def template_extract(template_id):
    return ext(f"{SDC}/sdc-questionnaire-templateExtract",
               extension=[{"url": "template", "valueReference": {"reference": f"#{template_id}"}}])


PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")


def module_item(slug):
    """Hidden item with an initial value, so the section exists in the response from the start."""
    return {
        "linkId": f"pam-{slug}-module", "text": "Module", "type": "string", "extension": [HIDDEN],
        "initial": [{"valueString": f"pam-{slug}|{VERSION}"}],
    }


def module(slug, title, top_item, contained=None, description=None):
    q = {
        "resourceType": "Questionnaire",
        "id": f"soln-pam-{slug}",
        "extension": [CHILD, PATIENT_CONTEXT],
        "url": f"{BASE}/pam-{slug}",
        "version": VERSION,
        "name": "PAM" + "".join(w.capitalize() for w in slug.split("-")),
        "title": f"PAM module — {title} (full solution)",
        "status": "draft",
        "experimental": True,
        "date": DATE,
        "publisher": PUBLISHER,
    }
    if description:
        q["description"] = description
    q["item"] = [top_item]
    if contained:
        q["contained"] = contained
    return q


def standalone(scenario, title, variables, items, contained=None, description=None):
    q = {
        "resourceType": "Questionnaire",
        "id": f"soln-{scenario}-standalone",
        "extension": [PATIENT_CONTEXT] + variables,
        "url": f"{BASE}/{scenario}-standalone",
        "version": VERSION,
        "name": f"PAM{scenario}Standalone",
        "title": title,
        "status": "draft",
        "experimental": True,
        "date": DATE,
        "publisher": PUBLISHER,
    }
    if description:
        q["description"] = description
    q["item"] = items
    if contained:
        q["contained"] = contained
    return q
