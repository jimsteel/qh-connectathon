# PAM → FHIR mapping — DRAFT

The current PAM system has no FHIR model. If each team picks its own resources, the
questionnaires won't feed the apps, so the track needs **one shared mapping**. This is a
proposal for the track leads to agree; scenario C2 invites participants to critique it.

Base profiles: AU Core where one exists, otherwise AU Base / core FHIR R4.

## Resources

| PAM concept | FHIR resource | Notes / open questions |
|---|---|---|
| Patient details | Patient | Indigenous status, interpreter needed, Medicare number per AU Base |
| GP | Practitioner / PractitionerRole via `Patient.generalPractitioner` | |
| Surgical waitlist entry | ServiceRequest (the surgery) | Elective category: `priority` or an extension? |
| Referral to blood management | ServiceRequest (`basedOn` / `supportingInfo` → waitlist entry) | Referral source as `requester` or a coded extension? |
| "Being managed" / "cleared" | EpisodeOfCare (`status`, `period`) | Days with the team = `period` length |
| Follow-up | Task (`for`, `executionPeriod`, `focus` → EpisodeOfCare) | |
| Pathology results | Observation (LOINC) | See codes below |
| Height, weight | Observation (vital signs) | |
| Diagnosis (anaemia type, iron deficiency, inflammation) | Condition (SNOMED CT-AU) | Value set to be defined on Ontoserver |
| Past medical / surgical history | Condition, Procedure | |
| IV iron treatment | MedicationRequest (AMT) | Infusion booking: ServiceRequest or Appointment |
| Limited consent / refusal of blood products | Flag | Or Consent? |
| Requested target Hb | Goal | |
| Patient education | Communication or Procedure | |
| Form answers | QuestionnaireResponse | Kept alongside the extracted resources |

## Codes

| Test | LOINC |
|---|---|
| Haemoglobin | 718-7 |
| Ferritin | 2276-4 |
| Transferrin saturation (TSAT) | 14801-5 (RCPA SPIA; was 2502-3 before AU Core) |
| CRP | 1988-5 |
| MCV, B12, folate, eGFR | *to confirm* |

Diagnoses and procedures: SNOMED CT-AU. Medications: AMT. All available on
[Ontoserver](https://r4.ontoserver.csiro.au/fhir).

## Decision rules used in calculations (to confirm with Metro North)

* **Anaemia:** Hb below the sex-specific threshold (≤130 g/L male, ≤120 g/L female).
* **Iron deficiency:** ferritin < 100 µg/L, or TSAT < 20% with ferritin 100–300 µg/L.
* **Inflammation:** CRP > 10 mg/L.
* **Total iron dose (Ganzoni):** weight × (target Hb − actual Hb) × 0.24 + iron stores,
  with the target Hb and iron stores depending on body weight.

## Shared conventions for questionnaire modules

* Launch context names: `patient`, `user`, `encounter`.
* Module variables for shared values (e.g. latest Hb, sex, weight) use the same names in every
  module so they survive `$assemble`. *List to be agreed.*
* Extraction is template-based (`templateExtract`); Smart Forms does not support
  definition-based extraction.
