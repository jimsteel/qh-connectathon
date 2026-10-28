#!/usr/bin/env python3
"""A9 Follow-up + Status: build the full pam-follow-up module and its standalone test forms.

    python3 build.py

writes
  pam-follow-up.json          the module (id soln-pam-follow-up, assemble-child, v0.2.0)
  A9-standalone.json          the same items as a form that runs on its own (id soln-A9-standalone)
  A9-standalone-put.json      variant: updates the EpisodeOfCare with a full PUT (standard SDC
                              templateExtract `resourceId` + `ifMatch`) instead of a FHIRPath PATCH

The module extends questionnaires/modules/pam-follow-up.json (0.1.0, scaffolding only): same
top-level group and hidden module item, the scaffolding box replaced by working items.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
SOLN = "https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire"
VERSION = "0.2.0"
DATE = "2026-10-28"
PUBLISHER = "FHIR in Queensland Health Connectathon — Track 1 (synthetic demo, not for clinical use)"
SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition"
LOCAL = "https://aehrc.github.io/qh-connectathon/track1/CodeSystem"
EOC_STATUS = "http://hl7.org/fhir/episode-of-care-status"
# Smart Forms' (sdc-template-extract >= 1.0.10) temporary sub-extension for PATCH requests.
PATCH_URL_EXT = "https://smartforms.csiro.au/ig/StructureDefinition/TemplateExtractExtensionPatchRequestUrl"


# --- helpers (same shapes as questionnaires/build.py) ----------------------------------------
def ext(url, **value):
    return {"url": url, **value}


def query(name, q):
    return ext("http://hl7.org/fhir/StructureDefinition/variable",
               valueExpression={"name": name, "language": "application/x-fhir-query", "expression": q})


def initial(expr):
    return ext(f"{SDC}/sdc-questionnaire-initialExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


def calculated(expr):
    return ext(f"{SDC}/sdc-questionnaire-calculatedExpression",
               valueExpression={"language": "text/fhirpath", "expression": expr})


HIDDEN = ext("http://hl7.org/fhir/StructureDefinition/questionnaire-hidden", valueBoolean=True)


def answer(link_id):
    return f"%resource.repeat(item).where(linkId='{link_id}').answer.value"


def item(link_id, text, type_, *extensions, **kw):
    it = {"linkId": link_id, "text": text, "type": type_}
    if extensions:
        it["extension"] = list(extensions)
    it.update(kw)
    return it


def tpl_value(expr):
    return {"extension": [ext(f"{SDC}/sdc-questionnaire-templateExtractValue", valueString=expr)]}


def template_extract(template_id, **slices):
    sub = [{"url": "template", "valueReference": {"reference": f"#{template_id}"}}]
    for k, v in slices.items():
        url = PATCH_URL_EXT if k == "patchRequestUrl" else k
        sub.append({"url": url, "valueString": v})
    return ext(f"{SDC}/sdc-questionnaire-templateExtract", extension=sub)


PATIENT_CONTEXT = ext(f"{SDC}/sdc-questionnaire-launchContext", extension=[
    {"url": "name", "valueCoding": {"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}},
    {"url": "type", "valueCode": "Patient"},
])
CHILD = ext(f"{SDC}/sdc-questionnaire-assemble-expectation", valueCode="assemble-child")


# --- expressions --------------------------------------------------------------------------------
# x-fhir-query variables (names unique across modules, so they survive $assemble)
Q_EPISODE = ("EpisodeOfCare?patient={{%patient.id}}"
             f"&type={LOCAL}/episode-type|pam&_sort=-date&_count=1")
Q_REFERRAL = ("ServiceRequest?patient={{%patient.id}}"
              "&code=http://snomed.info/sct|3457005&_sort=-authored&_count=1")
Q_TASKS = ("Task?patient={{%patient.id}}"
           f"&code={LOCAL}/task-type|follow-up&_sort=authored-on&_count=50")

EPISODE = "%fuEpisode.entry.resource"
OPEN_TASKS = "%fuTasks.entry.resource.where(status = 'requested' or status = 'ready' or status = 'in-progress')"

INIT = {
    "episode-id": f"{EPISODE}.id",
    "episode-version": f"{EPISODE}.meta.versionId",
    "episode-start": f"{EPISODE}.period.start",
    "episode-end": f"{EPISODE}.period.end",
    "episode-org": f"{EPISODE}.managingOrganization.reference",
    "episode-referral": f"{EPISODE}.referralRequest.reference.first()",
    "care-manager": f"{EPISODE}.careManager.reference",
    # referral date: the referral ServiceRequest, else the episode start
    "referral-date": (f"iif(%fuReferral.entry.exists(), %fuReferral.entry.resource.authoredOn, "
                      f"{EPISODE}.period.start).toString().substring(0, 10)"),
    "current-status": f"{EPISODE}.status",
    "previous-notes": ("%fuTasks.entry.resource.note.select(iif(time.exists(), time.toString().substring(0, 10) + ': ', '')"
                       " + text).join('\\n')"),
    "open-task-id": f"{OPEN_TASKS}.last().id",
    "open-task-due": f"{OPEN_TASKS}.last().restriction.period.end.toString().substring(0, 10)",
    "review-date": "today()",
    "status": f"{EPISODE}.status",
    "weeks": "4",
}


def day_number(date_expr):
    """FHIRPath: days since a fixed epoch for a 'YYYY-MM-DD' date (civil-from-days, March-based year).

    fhirpath.js (4.x in Smart Forms, 5.x here) can add a quantity to a date but can't subtract
    two dates, so 'days between' is computed from the date parts."""
    s = f"({date_expr}).toString()"
    y = f"{s}.substring(0, 4).toInteger()"
    m = f"{s}.substring(5, 2).toInteger()"
    d = f"{s}.substring(8, 2).toInteger()"
    mm = f"(({m} + 9) mod 12)"
    yy = f"({y} - ({mm} div 10))"
    return f"(365 * {yy} + ({yy} div 4) - ({yy} div 100) + ({yy} div 400) + (({mm} * 306 + 5) div 10) + {d})"


DAYS = f"{day_number(answer('pam-fu-review-date'))} - {day_number(answer('pam-fu-referral-date'))}"
DUE = (f"({answer('pam-fu-review-date')}.toDate() + "
       f"(({answer('pam-fu-weeks')} * 7).toString() + ' days').toQuantity()).toString()")

STATUS_OPTIONS = [
    {"valueCoding": {"system": EOC_STATUS, "code": "active", "display": "Being managed"}},
    {"valueCoding": {"system": EOC_STATUS, "code": "finished", "display": "Cleared"}},
]
CURRENT_STATUS_OPTIONS = STATUS_OPTIONS + [
    {"valueCoding": {"system": EOC_STATUS, "code": "planned", "display": "Planned (not yet seen)"}},
    {"valueCoding": {"system": EOC_STATUS, "code": "waitlist", "display": "Waitlist"}},
    {"valueCoding": {"system": EOC_STATUS, "code": "onhold", "display": "On hold"}},
    {"valueCoding": {"system": EOC_STATUS, "code": "cancelled", "display": "Cancelled"}},
]
TASK_TYPES = ["Follow up post-treatment bloods", "Review", "Phone call", "Book IV iron infusion"]


# --- templates ----------------------------------------------------------------------------------
def task_template():
    """New follow-up Task. Context: the pam-fu-next group (enabled only while being managed)."""
    return {
        "resourceType": "Task", "id": "PAMFollowUpTaskTemplate",
        "status": "requested", "intent": "order",
        "code": {
            "coding": [{"system": f"{LOCAL}/task-type", "code": "follow-up", "display": "Follow-up"}],
            "_text": tpl_value("item.where(linkId='pam-fu-task-type').answer.value"),
        },
        "_description": tpl_value("item.where(linkId='pam-fu-task-type').answer.value"),
        "focus": {"_reference": tpl_value(f"'EpisodeOfCare/' + {answer('pam-fu-episode-id')}")},
        "for": {"_reference": tpl_value("%resource.subject.reference")},
        "owner": {"_reference": tpl_value(answer('pam-fu-care-manager'))},
        "_authoredOn": tpl_value("now().toString()"),
        "restriction": {"period": {"_end": tpl_value("item.where(linkId='pam-fu-due').answer.value.toString()")}},
        "note": [{
            "_time": tpl_value("iif(item.where(linkId='pam-fu-note').answer.exists(), now().toString(), {})"),
            "_text": tpl_value("item.where(linkId='pam-fu-note').answer.value"),
        }],
    }


def complete_task_template():
    """FHIRPath Patch: mark the previous open follow-up Task completed. Context: pam-fu-open-task-id."""
    return {
        "resourceType": "Parameters", "id": "PAMCompletePreviousTaskPatch",
        "parameter": [{"name": "operation", "part": [
            {"name": "type", "valueCode": "replace"},
            {"name": "path", "valueString": "Task.status"},
            {"name": "value", "valueCode": "completed"},
        ]}],
    }


# Only write the status when it changes (empty value -> Smart Forms drops the operation, and a
# Parameters with no operations left is dropped from the Bundle).
CHANGED_STATUS = f"iif(answer.value.code != {answer('pam-fu-current-status')}.code, answer.value.code, {{}})"
# PUT: keep an existing end date; set it to the review date when the episode is cleared now.
END_IF_CLEARED = (f"iif({answer('pam-fu-episode-end')}.exists(), {answer('pam-fu-episode-end')}.toString(), "
                  f"iif(answer.value.code = 'finished', {answer('pam-fu-review-date')}.toString(), {{}}))")


def episode_patch_template():
    """FHIRPath Patch on the existing EpisodeOfCare. Context: the pam-fu-status item."""
    return {
        "resourceType": "Parameters", "id": "PAMEpisodeStatusPatch",
        "parameter": [
            {"name": "operation", "part": [
                {"name": "type", "valueCode": "replace"},
                {"name": "path", "valueString": "EpisodeOfCare.status"},
                {"name": "value", "_valueCode": tpl_value(CHANGED_STATUS)},
            ]},
            {"name": "operation", "part": [
                {"name": "type", "valueCode": "add"},
                {"name": "path", "valueString": "EpisodeOfCare.period"},
                {"name": "name", "valueString": "end"},
                {"name": "value", "_valueDateTime": tpl_value(
                    f"iif(answer.value.code = 'finished' and {answer('pam-fu-current-status')}.code != 'finished', "
                    f"{answer('pam-fu-review-date')}.toString(), {{}})")},
            ]},
        ],
    }


def episode_put_template():
    """Full EpisodeOfCare for a PUT (standard SDC). Every element must be carried, or it is lost."""
    return {
        "resourceType": "EpisodeOfCare", "id": "PAMEpisodeOfCareTemplate",
        "_status": tpl_value("answer.value.code"),
        "type": [{
            "coding": [{"system": f"{LOCAL}/episode-type", "code": "pam", "display": "Preoperative anaemia management"}],
            "text": "Preoperative anaemia management",
        }],
        "patient": {"_reference": tpl_value("%resource.subject.reference")},
        "managingOrganization": {"_reference": tpl_value(answer('pam-fu-episode-org'))},
        "period": {
            "_start": tpl_value(f"{answer('pam-fu-episode-start')}.toString()"),
            "_end": tpl_value(END_IF_CLEARED),
        },
        "referralRequest": [{"_reference": tpl_value(answer('pam-fu-episode-referral'))}],
        "careManager": {"_reference": tpl_value(answer('pam-fu-care-manager'))},
    }


# --- items ----------------------------------------------------------------------------------------
def hidden(link_id, text, type_="string"):
    return item(link_id, text, type_, HIDDEN, initial(INIT[link_id.removeprefix("pam-fu-")]))


def build_items(put_variant=False):
    status_extract = (
        template_extract("PAMEpisodeOfCareTemplate",
                         resourceId=answer('pam-fu-episode-id'),
                         ifMatch=f"'W/\"' + {answer('pam-fu-episode-version')} + '\"'")
        if put_variant else
        template_extract("PAMEpisodeStatusPatch",
                         patchRequestUrl=f"'EpisodeOfCare/' + {answer('pam-fu-episode-id')}")
    )
    hidden_items = [
        hidden("pam-fu-episode-id", "EpisodeOfCare id"),
        hidden("pam-fu-care-manager", "Care manager (reference)"),
    ]
    if put_variant:
        hidden_items += [
            hidden("pam-fu-episode-version", "EpisodeOfCare versionId"),
            hidden("pam-fu-episode-start", "EpisodeOfCare period start", "date"),
            hidden("pam-fu-episode-end", "EpisodeOfCare period end", "date"),
            hidden("pam-fu-episode-org", "Managing organisation (reference)"),
            hidden("pam-fu-episode-referral", "Referral (reference)"),
        ]
    complete_task = item(
        "pam-fu-open-task-id", "Open follow-up Task id", "string", HIDDEN,
        initial(INIT["open-task-id"]),
        template_extract("PAMCompletePreviousTaskPatch",
                         patchRequestUrl=f"'Task/' + {answer('pam-fu-open-task-id')}"),
    )
    return [
        item("pam-follow-up-module", "Module", "string", HIDDEN,
             initial=[{"valueString": f"pam-follow-up|{VERSION}"}]),
        *hidden_items,
        complete_task,
        item("pam-fu-history", "So far", "group", item=[
            item("pam-fu-referral-date", "Referred to the blood management team on", "date",
                 initial(INIT["referral-date"]), readOnly=True),
            item("pam-fu-current-status", "Status before this review", "choice",
                 initial(INIT["current-status"]), readOnly=True, answerOption=CURRENT_STATUS_OPTIONS),
            item("pam-fu-open-task-due", "Open follow-up was due on", "date",
                 initial(INIT["open-task-due"]), readOnly=True),
            item("pam-fu-previous-notes", "Previous follow-up notes", "text",
                 initial(INIT["previous-notes"]), readOnly=True),
        ]),
        item("pam-fu-review", "This review", "group", item=[
            item("pam-fu-review-date", "Review date", "date", initial(INIT["review-date"]), required=True),
            item("pam-fu-days", "Days with the blood management team", "integer",
                 ext("http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
                     valueCoding={"system": "http://unitsofmeasure.org", "code": "d", "display": "days"}),
                 calculated(DAYS), readOnly=True),
            item("pam-fu-status", "Status after this review", "choice",
                 initial(INIT["status"]), status_extract,
                 ext("http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl",
                     valueCodeableConcept={"coding": [{"system": "http://hl7.org/fhir/questionnaire-item-control",
                                                       "code": "radio-button"}]}),
                 required=True, answerOption=STATUS_OPTIONS),
        ]),
        item("pam-fu-next", "Next follow-up", "group",
             template_extract("PAMFollowUpTaskTemplate"),
             enableWhen=[{"question": "pam-fu-status", "operator": "=",
                          "answerCoding": {"system": EOC_STATUS, "code": "active"}}],
             item=[
                 item("pam-fu-task-type", "Follow-up", "choice", required=True,
                      initial=[{"valueString": TASK_TYPES[0]}],
                      answerOption=[{"valueString": t} for t in TASK_TYPES]),
                 item("pam-fu-weeks", "Follow up in (weeks)", "integer", initial(INIT["weeks"]), required=True),
                 item("pam-fu-due", "Follow-up due", "date", calculated(DUE), readOnly=True),
                 item("pam-fu-note", "Note for the follow-up", "text"),
             ]),
    ]


def questionnaire(id_, url, name, title, put_variant=False, child=True):
    contained = [complete_task_template(), task_template(),
                 episode_put_template() if put_variant else episode_patch_template()]
    return {
        "resourceType": "Questionnaire", "id": id_,
        "extension": ([CHILD] if child else []) + [PATIENT_CONTEXT],
        "url": url, "version": VERSION, "name": name, "title": title,
        "status": "draft", "experimental": True, "date": DATE, "publisher": PUBLISHER,
        "description": ("Scenario A9: pre-populates the referral date, current status, previous notes and the open "
                        "follow-up; calculates days with the blood management team and the follow-up due date; "
                        "extracts a follow-up Task, completes the previous one and updates the EpisodeOfCare status "
                        + ("with a PUT (resourceId + ifMatch)." if put_variant else "with a FHIRPath Patch.")),
        "contained": contained,
        "item": [{
            "linkId": "pam-follow-up", "text": "Follow-up and status", "type": "group",
            "extension": [query("fuEpisode", Q_EPISODE), query("fuReferral", Q_REFERRAL), query("fuTasks", Q_TASKS)],
            "item": build_items(put_variant),
        }],
    }


OUT = {
    "pam-follow-up.json": questionnaire("soln-pam-follow-up", f"{SOLN}/pam-follow-up", "PAMFollowUp",
                                        "PAM module — Follow-up and status"),
    "A9-standalone.json": questionnaire("soln-A9-standalone", f"{SOLN}/A9-standalone", "PAMFollowUpStandalone",
                                        "A9 Follow-up and status (standalone test form)", child=False),
    "A9-standalone-put.json": questionnaire("soln-A9-standalone-put", f"{SOLN}/A9-standalone-put",
                                            "PAMFollowUpStandalonePut",
                                            "A9 Follow-up and status (standalone, EpisodeOfCare by PUT)",
                                            put_variant=True, child=False),
}

if __name__ == "__main__":
    for name, q in OUT.items():
        (HERE / name).write_text(json.dumps(q, indent=2, ensure_ascii=False) + "\n")
        print("wrote", name)
