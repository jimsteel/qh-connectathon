#!/usr/bin/env python3
"""Scenario A2 (GP details): full module + standalone test form.

Replaces the scaffolding in the starter module questionnaires/modules/pam-gp-details.json (same
top-level group pam-gp and hidden item pam-gp-details-module) with:

* pre-population of three candidate GPs, each resolved through PractitionerRole -> Practitioner
  and Organization with _include / _include:iterate:
    - the GP on record:       Patient.generalPractitioner
    - the referring doctor:   requester of the latest referral (ServiceRequest, SNOMED 3457005)
    - GP from latest admission: Encounter (class IMP) participant typed SNOMED 62247001
      "General practitioner"
* a source choice (keep / referring / admission / manual) with enableWhen on each group;
* write-back of Patient.generalPractitioner as a FHIRPath Patch (Parameters template -> PATCH),
  plus, for manual entry, a Practitioner and PractitionerRole (PUT with a deterministic id).

    python3 build.py && python3 testdata.py && ./load.sh && node verify.mjs && node playground.mjs
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
SCT = "http://snomed.info/sct"
PROVIDER_NO = "http://ns.electronichealth.net.au/id/medicare-provider-number"
SOURCE_CS = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem/gp-source"
TEV = f"{SDC}/sdc-questionnaire-templateExtractValue"
TEC = f"{SDC}/sdc-questionnaire-templateExtractContext"
PATCH_URL = "https://smartforms.csiro.au/ig/StructureDefinition/TemplateExtractExtensionPatchRequestUrl"
# Sandbox rule: every resource we create on Meld has an id starting soln-A2-. In a real deployment
# use your own prefix (or let the server assign ids: see README, "Why PUT and not POST").
ID_PREFIX = "soln-A2-gp-"


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


def tev(expr):
    return {"extension": [ext(TEV, valueString=expr)]}


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)
RADIO = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
            valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control",
                                              "code": "radio-button"}]})


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def answer(link_id):
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


# --- Pre-population ------------------------------------------------------------------------------

INCLUDES = "&_include:iterate=PractitionerRole:practitioner&_include:iterate=PractitionerRole:organization"
QUERIES = {
    "gpCurrent": "Patient?_id={{%patient.id}}&_include=Patient:general-practitioner" + INCLUDES,
    "gpReferral": ("ServiceRequest?patient={{%patient.id}}&code=http://snomed.info/sct|3457005&_sort=-authored"
                   "&_count=1&_include=ServiceRequest:requester" + INCLUDES),
    "gpAdmission": ("Encounter?patient={{%patient.id}}&class=http://terminology.hl7.org/CodeSystem/v3-ActCode|IMP"
                    "&_sort=-date&_count=1&_include=Encounter:participant" + INCLUDES),
}
# The reference to the GP in each search result (Practitioner, PractitionerRole or Organization)
REFS = {
    "gpCurrent": "%gpCurrent.entry.resource.where(resourceType='Patient').generalPractitioner.first()",
    "gpReferral": "%gpReferral.entry.resource.where(resourceType='ServiceRequest').requester",
    "gpAdmission": ("%gpAdmission.entry.resource.where(resourceType='Encounter').participant"
                    f".where(type.coding.where(system='{SCT}' and code='62247001').exists()).individual.first()"),
}


def resolve(bundle, ref_expr):
    """The resource in the search Bundle that a reference string points to (fullUrl ends with it)."""
    return f"%{bundle}.entry.where(fullUrl.endsWith('/' + {ref_expr})).resource"


def source_variables(b, prefix):
    """FHIRPath variables for one source: Ref (Reference), Role, Prac, Org."""
    ref = f"%{prefix}Ref.reference"
    return [
        variable(f"{prefix}Ref", REFS[b]),
        variable(f"{prefix}Target", resolve(b, ref)),
        variable(f"{prefix}Prac", resolve(b, f"iif(%{prefix}Target.resourceType = 'PractitionerRole', "
                                             f"%{prefix}Target.practitioner.reference, {ref})")
                 + ".where(resourceType='Practitioner')"),
        variable(f"{prefix}Org", resolve(b, f"iif(%{prefix}Target.resourceType = 'PractitionerRole', "
                                            f"%{prefix}Target.organization.reference, {ref})")
                 + ".where(resourceType='Organization')"),
    ]


def doctor_items(prefix, key):
    """Read-only name / practice / phone / provider number + hidden reference for one source."""
    name = (f"iif(%{prefix}Prac.exists(), %{prefix}Prac.name.first().select("
            "iif(prefix.exists(), prefix.first() + ' ', '') + given.first() + ' ' + family), "
            f"%{prefix}Ref.display)")
    practice = (f"iif(%{prefix}Org.exists(), %{prefix}Org.name, "
                f"%{prefix}Target.where(resourceType='PractitionerRole').organization.display)")
    phone = (f"(%{prefix}Target.where(resourceType='PractitionerRole').telecom.where(system='phone') | "
             f"%{prefix}Org.telecom.where(system='phone') | %{prefix}Prac.telecom.where(system='phone')).value.first()")
    provider = f"%{prefix}Prac.identifier.where(system='{PROVIDER_NO}').value.first()"
    return [
        item(f"pam-gp-{key}-name", "Name", "string", initial(name), readOnly=True),
        item(f"pam-gp-{key}-practice", "Practice", "string", initial(practice), readOnly=True),
        item(f"pam-gp-{key}-phone", "Phone", "string", initial(phone), readOnly=True),
        item(f"pam-gp-{key}-provider", "Provider number", "string", initial(provider), readOnly=True),
        item(f"pam-gp-{key}-ref", "Reference", "string", HIDDEN, initial(f"%{prefix}Ref.reference"), readOnly=True),
    ]


SOURCES = [("current", "Keep the GP on record"), ("referring", "Referring doctor"),
           ("admission", "GP from the latest admission"), ("manual", "Enter the GP manually")]


def coding(code):
    return {"system": SOURCE_CS, "code": code, "display": dict(SOURCES)[code]}


def when(code):
    return {"enableWhen": [{"question": "pam-gp-source", "operator": "=", "answerCoding": coding(code)}]}


def ans(link, base):
    """An answer anywhere below `base`: '%resource' (calculations) or '' (relative to the QR item
    that carries templateExtract, in templates)."""
    return f"{base + '.' if base else ''}repeat(item).where(linkId='{link}').answer.value"


def gp_id(base):
    """Deterministic id for a manually entered GP: same name + provider number -> same resources, so
    a repeated write-back updates them (PUT) instead of duplicating."""
    f, g, pr = (ans(f"pam-gp-manual-{x}", base) for x in ("family", "given", "provider"))
    return (f"'{ID_PREFIX}' + ({f}.lower() + iif({g}.exists(), '-' + {g}.lower(), '') + "
            f"iif({pr}.exists(), '-' + {pr}.lower(), '')).replaceMatches('[^a-z0-9-]', '').substring(0, 50)")


def new_ref(base):
    """The reference to write to Patient.generalPractitioner, from the chosen source."""
    src = f"{ans('pam-gp-source', base)}.code"
    return (f"iif({src} = 'current', {ans('pam-gp-current-ref', base)}, "
            f"iif({src} = 'referring', {ans('pam-gp-referring-ref', base)}, "
            f"iif({src} = 'admission', {ans('pam-gp-admission-ref', base)}, "
            f"iif({src} = 'manual' and {ans('pam-gp-manual-family', base)}.exists(), "
            f"'PractitionerRole/' + {gp_id(base)} + '-role', {{}}))))")


def new_display(base):
    src = f"{ans('pam-gp-source', base)}.code"
    f, g = ans("pam-gp-manual-family", base), ans("pam-gp-manual-given", base)
    return (f"iif({src} = 'current', {ans('pam-gp-current-name', base)}, "
            f"iif({src} = 'referring', {ans('pam-gp-referring-name', base)}, "
            f"iif({src} = 'admission', {ans('pam-gp-admission-name', base)}, "
            f"iif({src} = 'manual' and {f}.exists(), "
            f"'Dr ' + iif({g}.exists(), {g} + ' ', '') + {f}, {{}}))))")


CALC = {"new-display": new_display("%resource")}

# --- Templates -------------------------------------------------------------------------------------

# Template expressions are relative to the QR item that carries templateExtract (the pam-gp group
# for the PATCH, the pam-gp-manual group for the new Practitioner / PractitionerRole), not
# %resource-based: Smart Forms' "modified only" extraction re-runs the templates over the freshly
# pre-populated response, but %resource still points at the current response there, so a
# %resource-based value can never differ and the change would be filtered out (found by testing).
# For the same reason the PATCH value is computed in the template from pre-populated answers, not
# read from a calculated item: the pre-populated comparison response has no calculated answers, so
# an unchanged form would still produce a PATCH.
HAS_GP = "repeat(item).where(linkId='pam-gp-current-ref').answer.value.exists()"
NEW_ID = gp_id("")
TEMPLATE_EXPR = {
    "patch-url": "%resource.subject.reference",
    "patch-type": f"iif({HAS_GP}, 'replace', 'add')",
    "patch-path": f"iif({HAS_GP}, 'Patient.generalPractitioner', 'Patient')",
    "patch-ref": new_ref(""),
    "patch-display": new_display(""),
    "prac-id": NEW_ID,
    "role-id": f"{NEW_ID} + '-role'",
    "name-ctx": "item.where(linkId='pam-gp-manual-name')",
    "given": "item.where(linkId='pam-gp-manual-given').answer.value",
    "family": "item.where(linkId='pam-gp-manual-family').answer.value.first()",
    "provider-ctx": "item.where(linkId='pam-gp-manual-provider').answer",
    "phone-ctx": "item.where(linkId='pam-gp-manual-phone').answer",
    "ctx-value": "value",
    "role-prac": f"'Practitioner/' + {NEW_ID}",
    "role-prac-display": ("'Dr ' + iif(repeat(item).where(linkId='pam-gp-manual-given').answer.exists(), "
                          "repeat(item).where(linkId='pam-gp-manual-given').answer.value + ' ', '') + "
                          "repeat(item).where(linkId='pam-gp-manual-family').answer.value"),
    "practice": "item.where(linkId='pam-gp-manual-practice').answer.value",
}
T = TEMPLATE_EXPR

PATCH_TEMPLATE = {
    "resourceType": "Parameters", "id": "PAMGpPatchTemplate",
    "parameter": [{"name": "operation", "part": [
        {"name": "type", "_valueCode": tev(T["patch-type"])},
        {"name": "path", "_valueString": tev(T["patch-path"])},
        {"name": "name", "valueString": "generalPractitioner"},
        {"name": "value", "valueReference": {"_reference": tev(T["patch-ref"]), "_display": tev(T["patch-display"])}},
    ]}],
}
PRACTITIONER_TEMPLATE = {
    "resourceType": "Practitioner", "id": "PAMGpPractitionerTemplate",
    "identifier": [{"extension": [ext(TEC, valueString=T["provider-ctx"])],
                    "system": PROVIDER_NO, "_value": tev(T["ctx-value"])}],
    "name": [{"extension": [ext(TEC, valueString=T["name-ctx"])], "use": "official", "prefix": ["Dr"], "_family": tev(T["family"]), "given": [None],
              "_given": [tev(T["given"])]}],
}
ROLE_TEMPLATE = {
    "resourceType": "PractitionerRole", "id": "PAMGpRoleTemplate", "active": True,
    "practitioner": {"_reference": tev(T["role-prac"]), "_display": tev(T["role-prac-display"])},
    "organization": {"_display": tev(T["practice"])},
    "code": [{"coding": [{"system": SCT, "code": "62247001", "display": "General practitioner"}]}],
    "telecom": [{"extension": [ext(TEC, valueString=T["phone-ctx"])],
                 "system": "phone", "use": "work", "_value": tev(T["ctx-value"])}],
}


def template_extract(template_id, **slices):
    sub = [ext("template", valueReference={"reference": f"#{template_id}"})]
    for k, v in slices.items():
        sub.append(ext(PATCH_URL if k == "patchRequestUrl" else k, valueString=v))
    return ext(f"{SDC}/sdc-questionnaire-templateExtract", extension=sub)


def module():
    variables = [query(n, q) for n, q in QUERIES.items()]
    variables += source_variables("gpCurrent", "gpCurrent")
    variables += source_variables("gpReferral", "gpReferring")
    variables += source_variables("gpAdmission", "gpAdmission")
    items = [
        item("pam-gp-details-module", "Module", "string", HIDDEN,
             initial=[{"valueString": f"pam-gp-details|{VERSION}"}]),
        item("pam-gp-current", "GP on record", "group", item=doctor_items("gpCurrent", "current") + [
            item("pam-gp-current-none", "No GP on record for this patient.", "display",
                 enableWhen=[{"question": "pam-gp-current-ref", "operator": "exists", "answerBoolean": False}])]),
        item("pam-gp-source", "Which GP should be recorded?", "choice", RADIO,
             initial(f"iif(%gpCurrentRef.exists(), 'current', {{}})"),
             answerOption=[{"valueCoding": coding(c)} for c, _ in SOURCES]),
        item("pam-gp-referring", "Referring doctor (latest referral)", "group", **when("referring"),
             item=doctor_items("gpReferring", "referring") + [
                 item("pam-gp-referring-date", "Referral date", "date", readOnly=True, extension=[initial(
                     "%gpReferral.entry.resource.where(resourceType='ServiceRequest').authoredOn.toString().substring(0, 10)")])]),
        item("pam-gp-admission", "GP recorded on the latest admission", "group", **when("admission"),
             item=doctor_items("gpAdmission", "admission") + [
                 item("pam-gp-admission-date", "Admitted", "date", readOnly=True, extension=[initial(
                     "%gpAdmission.entry.resource.where(resourceType='Encounter').period.start.toString().substring(0, 10)")])]),
        item("pam-gp-manual", "Enter the GP", "group", **when("manual"),
             extension=[template_extract("PAMGpPractitionerTemplate", resourceId=T["prac-id"]),
                        template_extract("PAMGpRoleTemplate", resourceId=T["role-id"])],
             item=[
                 item("pam-gp-manual-name", "Name", "group", item=[
                     item("pam-gp-manual-given", "Given name", "string"),
                     item("pam-gp-manual-family", "Family name", "string", required=True)]),
                 item("pam-gp-manual-provider", "Medicare provider number", "string"),
                 item("pam-gp-manual-practice", "Practice", "string"),
                 item("pam-gp-manual-phone", "Practice phone", "string"),
             ]),
        item("pam-gp-new-display", "GP to be recorded", "string", calculated(CALC["new-display"]), readOnly=True),
    ]
    group = item("pam-gp", "GP details", "group", *variables,
                 template_extract("PAMGpPatchTemplate", patchRequestUrl=T["patch-url"]), item=items)
    return {
        "resourceType": "Questionnaire", "id": "soln-pam-gp-details",
        "extension": [
            ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child"),
            ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
                ext("name", valueCoding={"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}),
                ext("type", valueCode="Patient")]),
        ],
        "url": f"{SOLN}/pam-gp-details", "version": VERSION,
        "name": "PAMGpDetailsSolution", "title": "PAM module — GP details (solution)",
        "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": "Scenario A2 reference solution: GP from the record, the referral or the latest admission, "
                       "or entered by hand; writes Patient.generalPractitioner back with a FHIRPath Patch. "
                       "Uses no root-form variables.",
        "contained": [PATCH_TEMPLATE, PRACTITIONER_TEMPLATE, ROLE_TEMPLATE],
        "item": [group],
    }


def standalone(mod):
    q = copy.deepcopy(mod)
    q["id"] = "soln-A2-standalone"
    q["url"] = f"{SOLN}/A2-standalone"
    q["name"] = "PAMGpDetailsStandalone"
    q["title"] = "A2 GP details — standalone test form"
    q["description"] = "The A2 solution module on its own (it needs no root-form variables)."
    q["extension"] = [e for e in q["extension"] if not e["url"].endswith("assemble-expectation")]
    return q


def write(name, obj):
    (HERE / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print("wrote", name)


if __name__ == "__main__":
    m = module()
    write("pam-gp-details.json", m)
    write("A2-standalone.json", standalone(m))
