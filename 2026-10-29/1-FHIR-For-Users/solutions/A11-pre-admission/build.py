#!/usr/bin/env python3
"""A11 Patient-facing pre-admission form, plus a nurse-side module that reads its response.

    python3 build.py

writes
  A11-pre-admission.json   the patient's form (id soln-A11-pre-admission)
  A11-nurse-import.json    nurse-side module (id soln-A11-nurse-import, assemble-child) that finds the
                           patient's latest completed A11 QuestionnaireResponse with an x-fhir-query
                           and fills its items from it with FHIRPath
  A11-nurse-standalone.json the same nurse module as a form that runs on its own (id soln-A11-nurse-standalone)
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
SOLN = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
PA_URL = f"{SOLN}/A11-pre-admission"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"
SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
SCT = "http://snomed.info/sct"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
YN = "http://terminology.hl7.org/CodeSystem/v2-0136"
DAR = "http://terminology.hl7.org/CodeSystem/data-absent-reason"
MEDICARE = "http://ns.electronichealth.net.au/id/medicare-number"
INTERPRETER = "http://hl7.org.au/fhir/StructureDefinition/interpreter-required"


def ext(url, **value):
    return {"url": url, **value}


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def query(name, q):
    return ext("http://hl7.org/fhir/StructureDefinition/variable",
               valueExpression={"name": name, "language": "application/x-fhir-query", "expression": q})


def control(code):
    return ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
               valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control", "code": code}]})


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)
RADIO = control("radio-button")
CHECKBOX = control("check-box")
PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def display(link_id, text):
    return {"linkId": link_id, "text": text, "type": "display"}


def opt(system, code, display_):
    return {"valueCoding": {"system": system, "code": code, "display": display_}}


YES, NO, NOT_SURE = opt(YN, "Y", "Yes"), opt(YN, "N", "No"), opt(DAR, "asked-unknown", "Not sure")
YNU = [YES, NO, NOT_SURE]
YNO = [YES, NO]


def yn(link_id, text, unsure=True, **kw):
    return item(link_id, text, "choice", RADIO, answerOption=YNU if unsure else YNO, **kw)


def when_yes(link_id):
    return [{"question": link_id, "operator": "=", "answerCoding": {"system": YN, "code": "Y"}}]


def when_code(link_id, system, *codes):
    return [{"question": link_id, "operator": "=", "answerCoding": {"system": system, "code": c}} for c in codes]


# --- answer sets -----------------------------------------------------------------------------------
TP = f"{LOCAL}/transfusion-preference"
TRANSFUSION = [
    opt(TP, "accept", "Yes, I would accept a blood transfusion"),
    opt(TP, "some", "Only some blood products"),
    opt(TP, "refuse", "No, I would not accept any blood products"),
    opt(TP, "unsure", "I'm not sure — I'd like to talk about it"),
]
PRODUCTS = [  # SNOMED CT-AU procedures (active, checked on Ontoserver 28 Oct 2026)
    opt(SCT, "116863004", "Red blood cells"),
    opt(SCT, "180208003", "Platelets"),
    opt(SCT, "13569004", "Plasma"),
    opt(SCT, "116795008", "Cryoprecipitate"),
    opt(SCT, "116788004", "Albumin"),
    opt(SCT, "233568002", "Cell salvage (your own blood, collected during the operation and given back)"),
]
DIET = [
    opt(SCT, "36823005", "I eat meat"),
    opt(SCT, "1379271000168105", "I eat fish but not meat (pescatarian)"),
    opt(SCT, "765021002", "Vegetarian (no meat or fish)"),
    opt(SCT, "1255165006", "Vegan (no food from animals)"),
]
RM = f"{LOCAL}/red-meat-frequency"
RED_MEAT = [opt(RM, "most-days", "Most days"), opt(RM, "weekly", "1 to 3 times a week"),
            opt(RM, "rarely", "Less than once a week"), opt(RM, "never", "Never")]
CB = f"{LOCAL}/form-completed-by"
COMPLETED_BY = [opt(CB, "patient", "Me (the patient)"), opt(CB, "family", "A family member or carer"),
                opt(CB, "interpreter", "Me, with help from an interpreter")]
REASON = f"{LOCAL}/transfusion-reason"
REASONS = [opt(REASON, "religious", "Religious beliefs (for example, Jehovah's Witness)"),
           opt(REASON, "personal", "Personal or cultural reasons"),
           opt(REASON, "past-reaction", "I had a bad reaction before"),
           opt(REASON, "prefer-not", "I'd prefer not to say")]
GENDER = [opt("http://hl7.org/fhir/administrative-gender", c, d)
          for c, d in [("female", "Female"), ("male", "Male"), ("other", "Other"), ("unknown", "Prefer not to say")]]


# --- the patient form ---------------------------------------------------------------------------
def pre_admission():
    about = item("pam-pa-about", "About you", "group", item=[
        display("pam-pa-about-intro", "We have filled in some details from your hospital record. "
                                      "Please check them and fix anything that is wrong."),
        item("pam-pa-name", "Your name", "string",
             initial("%patient.name.where(use = 'official').union(%patient.name).first().select(given.first() + ' ' + family)")),
        item("pam-pa-dob", "Your date of birth", "date", initial("%patient.birthDate")),
        item("pam-pa-sex", "Your sex", "choice", initial("%patient.gender"), answerOption=GENDER),
        item("pam-pa-medicare", "Your Medicare number", "string",
             initial(f"%patient.identifier.where(system = '{MEDICARE}').value.first()")),
        item("pam-pa-phone", "Best phone number to reach you", "string",
             initial("%patient.telecom.where(system = 'phone').where(use = 'mobile').union("
                     "%patient.telecom.where(system = 'phone')).value.first()")),
        item("pam-pa-address", "Your home address", "string",
             initial("%patient.address.where(use = 'home').union(%patient.address).first()"
                     ".select(iif(line.exists(), line.join(', ') + ', ', '') & city & ' ' & state & ' ' & postalCode)")),
        item("pam-pa-language", "The language you prefer to speak", "string",
             initial("%patient.communication.where(preferred = true).union(%patient.communication).first()"
                     ".language.select(text | coding.display).first()")),
        item("pam-pa-interpreter", "Do you need an interpreter?", "boolean",
             initial(f"%patient.extension.where(url = '{INTERPRETER}').value")),
    ])
    health = item("pam-pa-health", "Your health", "group", item=[
        yn("pam-pa-told-anaemia", "Has a doctor ever told you that you have low iron or anaemia (a low blood count)?"),
        yn("pam-pa-iron-tablets", "Have you taken iron tablets or iron liquid in the last year?"),
        yn("pam-pa-iron-infusion", "Have you ever had an iron drip (iron infusion)?"),
        item("pam-pa-iron-infusion-when", "Roughly when was your last iron drip?", "string",
             enableWhen=when_yes("pam-pa-iron-infusion")),
        yn("pam-pa-iron-infusion-reaction", "Did you have a reaction to the iron drip?",
           enableWhen=when_yes("pam-pa-iron-infusion")),
        yn("pam-pa-tired", "In the last month, have you felt more tired or short of breath than usual?"),
        yn("pam-pa-bruising", "Do you bruise easily, or bleed for a long time after a small cut?"),
        yn("pam-pa-gut-bleeding", "Have you noticed blood in your poo, black poo, or vomited blood?"),
        item("pam-pa-heavy-periods", "Do you have heavy periods?", "choice", RADIO,
             answerOption=[YES, NO, opt(f"{LOCAL}/pre-admission", "no-periods", "I don't have periods any more")],
             enableWhen=when_code("pam-pa-sex", "http://hl7.org/fhir/administrative-gender", "female")),
        yn("pam-pa-blood-thinners", "Do you take any medicine that thins your blood? "
                                    "(for example warfarin, apixaban (Eliquis), rivaroxaban (Xarelto), clopidogrel or aspirin)"),
        item("pam-pa-blood-thinners-names", "Which ones?", "string", enableWhen=when_yes("pam-pa-blood-thinners")),
        yn("pam-pa-kidney", "Has a doctor told you that you have kidney problems?"),
    ])
    diet = item("pam-pa-diet", "Food and diet", "group", item=[
        display("pam-pa-diet-intro", "Iron comes from the food you eat. These questions help us understand your iron levels."),
        item("pam-pa-diet-type", "Which best describes how you eat?", "choice", RADIO, answerOption=DIET),
        item("pam-pa-red-meat", "How often do you eat red meat (beef, lamb, pork or kangaroo)?", "choice", RADIO,
             answerOption=RED_MEAT, enableWhen=when_code("pam-pa-diet-type", SCT, "36823005")),
        yn("pam-pa-tea-coffee", "Do you usually drink tea or coffee with your meals?", unsure=False),
        yn("pam-pa-appetite", "Have you lost your appetite or lost weight without trying in the last 3 months?"),
        item("pam-pa-diet-other", "Is there any food you can't or don't eat (for example allergies, religious or cultural reasons)?",
             "text"),
    ])
    not_accept = when_code("pam-pa-transfusion-accept", TP, "some", "refuse")
    transfusion = item("pam-pa-transfusion", "Blood transfusion", "group", item=[
        display("pam-pa-transfusion-intro",
                "Sometimes people need a blood transfusion during or after an operation. The team will try to avoid "
                "it, for example by treating low iron before your surgery. We want to know your wishes in advance."),
        yn("pam-pa-transfused-before", "Have you ever had a blood transfusion?"),
        yn("pam-pa-transfusion-reaction", "Did you have a reaction to the transfusion?",
           enableWhen=when_yes("pam-pa-transfused-before")),
        item("pam-pa-transfusion-accept", "If you needed a blood transfusion during or after your operation, would you accept it?",
             "choice", RADIO, required=True, answerOption=TRANSFUSION),
        item("pam-pa-products", "Which of these would you accept? Tick all that apply.", "choice", CHECKBOX,
             repeats=True, answerOption=PRODUCTS, enableWhen=not_accept, enableBehavior="any"),
        item("pam-pa-transfusion-reason", "Can you tell us why? You don't have to.", "choice", RADIO,
             answerOption=REASONS, enableWhen=not_accept, enableBehavior="any"),
        yn("pam-pa-directive", "Do you have an Advance Health Directive or another signed document about blood products?",
           enableWhen=not_accept, enableBehavior="any"),
        yn("pam-pa-talk", "Would you like to talk to the blood management nurse before your operation?", unsure=False),
        item("pam-pa-transfusion-other", "Is there anything else you'd like us to know?", "text"),
    ])
    done = item("pam-pa-done", "Finishing up", "group", item=[
        item("pam-pa-completed-by", "Who filled in this form?", "choice", RADIO, answerOption=COMPLETED_BY),
    ])
    return {
        "resourceType": "Questionnaire", "id": "soln-A11-pre-admission",
        "extension": [PATIENT_CONTEXT],
        "url": PA_URL, "version": VERSION, "name": "PAMPreAdmissionPatient",
        "title": "Before your operation: your blood and iron health",
        "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": ("Scenario A11: a patient-facing pre-admission form in plain language (history, diet, transfusion "
                        "wishes). Its QuestionnaireResponse is what the nurse's forms pre-populate from."),
        "item": [{
            "linkId": "pam-pre-admission", "text": "Before your operation", "type": "group",
            "item": [
                item("pam-pre-admission-module", "Module", "string", HIDDEN,
                     initial=[{"valueString": f"pam-pre-admission|{VERSION}"}]),
                display("pam-pa-intro", "This form takes about 5 minutes. Your answers go to the blood management "
                                        "nurse, who will look at them before your pre-admission appointment."),
                about, health, diet, transfusion, done,
            ],
        }],
    }


# --- the nurse-side module that reads the patient's response ---------------------------------------
# Latest completed A11 response for the patient. `questionnaire=` is matched on the canonical URL as
# stored in QuestionnaireResponse.questionnaire; Smart Forms stores "<url>|<version>", which Meld won't
# match by URL alone, so the query filters by subject and status and FHIRPath picks the A11 responses.
Q_PA = "QuestionnaireResponse?subject=Patient/{{%patient.id}}&status=completed&_sort=-authored&_count=50"
LATEST = f"%paResponse.entry.resource.where(questionnaire.startsWith('{PA_URL}')).first()"


def pa(link_id):
    """FHIRPath: the answer(s) to an A11 item in the latest A11 response."""
    return f"{LATEST}.repeat(item).where(linkId = '{link_id}').answer.value"


def nurse(id_, url, title, child):
    return {
        "resourceType": "Questionnaire", "id": id_,
        "extension": ([CHILD] if child else []) + [PATIENT_CONTEXT],
        "url": url, "version": VERSION, "name": "PAMPatientReported" + ("" if child else "Standalone"),
        "title": title, "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": ("Scenario A11, nurse side: pre-populates from the patient's latest completed A11 pre-admission "
                        "QuestionnaireResponse (x-fhir-query + FHIRPath)."),
        "item": [{
            "linkId": "pam-patient-reported", "text": "Patient-reported (pre-admission form)", "type": "group",
            "extension": [query("paResponse", Q_PA)],
            "item": [
                item("pam-patient-reported-module", "Module", "string", HIDDEN,
                     initial=[{"valueString": f"pam-patient-reported|{VERSION}"}]),
                item("pam-pr-source", "Patient's form", "string", readOnly=True, extension=[initial(
                    f"{LATEST}.select('Completed ' + authored.toString().substring(0, 10) + ' (QuestionnaireResponse/' + id + ')')")]),
                item("pam-pr-none", "The patient hasn't completed a pre-admission form yet.", "display",
                     enableWhen=[{"question": "pam-pr-source", "operator": "exists", "answerBoolean": False}]),
                item("pam-pr-transfusion-accept", "Would accept a blood transfusion", "choice",
                     initial(pa("pam-pa-transfusion-accept")), answerOption=TRANSFUSION),
                item("pam-pr-products", "Blood products the patient would accept", "choice", CHECKBOX,
                     initial(pa("pam-pa-products")), repeats=True, answerOption=PRODUCTS,
                     enableWhen=when_code("pam-pr-transfusion-accept", TP, "some", "refuse"), enableBehavior="any"),
                item("pam-pr-directive", "Advance Health Directive about blood products", "choice", RADIO,
                     initial(pa("pam-pa-directive")), answerOption=YNU,
                     enableWhen=when_code("pam-pr-transfusion-accept", TP, "some", "refuse"), enableBehavior="any"),
                item("pam-pr-transfusion-reaction", "Previous transfusion reaction", "choice", RADIO,
                     initial(pa("pam-pa-transfusion-reaction")), answerOption=YNU),
                item("pam-pr-iron-infusion", "Previous iron infusion", "choice", RADIO,
                     initial(pa("pam-pa-iron-infusion")), answerOption=YNU),
                item("pam-pr-blood-thinners", "Blood thinners (patient-reported)", "string",
                     initial(f"iif({pa('pam-pa-blood-thinners')}.code = 'Y', 'Yes: ' + {pa('pam-pa-blood-thinners-names')}.first(), "
                             f"{pa('pam-pa-blood-thinners')}.display)")),
                item("pam-pr-diet", "Diet", "choice", initial(pa("pam-pa-diet-type")), answerOption=DIET),
                item("pam-pr-talk", "Wants to talk to the blood management nurse", "choice", RADIO,
                     initial(pa("pam-pa-talk")), answerOption=YNO),
            ],
        }],
    }


OUT = {
    "A11-pre-admission.json": pre_admission(),
    "A11-nurse-import.json": nurse("soln-A11-nurse-import", f"{SOLN}/pam-patient-reported",
                                   "PAM module — Patient-reported (from the pre-admission form)", True),
    "A11-nurse-standalone.json": nurse("soln-A11-nurse-standalone", f"{SOLN}/A11-nurse-standalone",
                                       "A11 nurse view: patient-reported answers (standalone test form)", False),
}

if __name__ == "__main__":
    for name, q in OUT.items():
        (HERE / name).write_text(json.dumps(q, indent=2, ensure_ascii=False) + "\n")
        print("wrote", name)
