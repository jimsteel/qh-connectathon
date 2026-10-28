# PAM → FHIR mapping — PROPOSED (C2 review of the draft)

The current PAM system has no FHIR model. If each team picks its own resources, the
questionnaires won't feed the apps, so the track needs **one shared mapping**. This revision of
[`FHIR-Mapping-DRAFT.md`](../../FHIR-Mapping-DRAFT.md) takes into account what the overnight solutions
(A5–A9, A11, B1–B9) actually needed. The reasons for each change are in [README.md](README.md)
(sections 2 and 3, with K-numbers). ⚑ marks the decisions still for the track leads.

Base profiles: AU Core 2.0.0 where one exists (Patient, Practitioner, PractitionerRole,
Organization, Observation, Condition, Procedure, MedicationRequest, AllergyIntolerance), otherwise
AU Base / core FHIR R4 (ServiceRequest, EpisodeOfCare, Task, Flag, Goal, Communication).

Local codes use `https://aehrc.github.io/qh-connectathon/track1/CodeSystem/<name>` (below: `LOCAL/<name>`).

## Resources

| PAM concept | FHIR resource | Notes |
|---|---|---|
| Patient details | Patient | Name, `birthDate`, `gender`, home `address` (postcode for the map). Indigenous status: extension `http://hl7.org.au/fhir/StructureDefinition/indigenous-status` (valueCoding, `australian-indigenous-status-1`). Interpreter: **core** extension `http://hl7.org/fhir/StructureDefinition/patient-interpreterRequired` (boolean), as AU Core 2.0.0 does; readers may also accept AU Base `…/interpreter-required`. Language: `communication.language` (`common-languages-australia-2`), `preferred`. Medicare: `identifier` type `MC`, system `http://ns.electronichealth.net.au/id/medicare-number`; prefer IHI where known |
| GP | **PractitionerRole** via `Patient.generalPractitioner` | Role `code` SNOMED 62247001 *General practitioner*; `practitioner` → Practitioner (Medicare provider number identifier), `organization` → the practice. Update with FHIRPath Patch (A2) |
| Admission (GP source) | Encounter (`class` v3-ActCode `IMP`) | Only for A2's "GP from the latest admission": `participant` → PractitionerRole |
| Surgical waitlist entry | ServiceRequest (the surgery) | `code` SNOMED CT-AU procedure (`<< 387713003`). `subject`. **Elective category in `category`**: `LOCAL/elective-category` 1 / 2 / 3, the elective surgery clinical urgency category. `priority` has a required binding (routine…stat) and can't hold it. Any coding in that system marks the ServiceRequest as a waitlist entry. `occurrenceDateTime` = booked surgery date; `authoredOn` = date placed on the list; `requester` = surgeon; `performer` = the surgical unit (Organization); `status` active |
| Surgical unit, directorate | Organization | Unit `partOf` → directorate Organization (`type` `dept`), and directorate `partOf` → the hospital. ⚑ real directorates from Metro North. Filter: `ServiceRequest?performer:Organization.partof=Organization/<directorate>`. The blood management service is its own Organization, **not** the units' parent |
| Referral to blood management | ServiceRequest | `code` SNOMED 3457005 *Patient referral*; `performer` = the blood management service; **`supportingInfo` → the waitlist entry** (not `basedOn`). **Referral source kind** in `category`: `LOCAL/referral-source` (surgeon, preadmission, anaesthetist, gp). **`requester` = the actual referrer** (Practitioner or PractitionerRole). `authoredOn` = referral date, which is the **timeframe date** for every app. `reasonCode` optional (SNOMED). `status` active while the episode is open, completed when cleared. One referral = one PAM case |
| "Being managed" / "cleared" | EpisodeOfCare | `type` `LOCAL/episode-type#pam`; `status` **`active` = being managed, `finished` = cleared** (other statuses are shown separately, not counted). `period.start` = referral date (same as the referral's `authoredOn`); `period.end` = date cleared. Days with the team = `period.end` (or today) − `period.start`. `referralRequest` → the referral; `careManager` → nurse; `managingOrganization` → service; **`diagnosis.condition` → the PAM Condition** |
| Follow-up | Task | `code` `LOCAL/task-type#follow-up`; `for` → Patient; `focus` → EpisodeOfCare; `owner` → care manager; **due date = `restriction.period.end`** (R4: "period.high is the due date"; `executionPeriod` is when work was actually done); `note` = dated notes (previous notes); `authoredOn`. Open = requested, received, accepted, ready, in-progress, on-hold. When the next one is written, the previous one becomes `completed` |
| Pathology results | Observation (AU Core Pathology Result) | `category` `laboratory`; `code` LOINC (below, from the RCPA SPIA set); `effectiveDateTime` = collection date (day precision at least); `valueQuantity` in UCUM; `performer` → the lab (Organization, or `display` for hand-entered external results); `status` final. Hand-entered results add a `note` |
| Height, weight | Observation (vital signs) | LOINC 8302-2 (cm), 29463-7 (kg); `category` `vital-signs`. BMI is calculated, not stored |
| Diagnosis (anaemia type, iron deficiency, inflammation) | Condition (SNOMED CT-AU) | `category` **`encounter-diagnosis`** (marks a PAM diagnosis); `code` from **PAM diagnosis value set** (below); `clinicalStatus` active, `verificationStatus` confirmed, `recordedDate`; pathway text in `note`. Referenced from `EpisodeOfCare.diagnosis`. The calculated findings (anaemia, iron deficiency, inflammation) aren't stored separately |
| Past medical / surgical history | Condition (`problem-list-item`), Procedure; read MedicationStatement, AllergyIntolerance | Value sets by ECL on SNOMED CT-AU (edition URI). Don't use inactive concepts (e.g. 103693007) |
| IV iron treatment | MedicationRequest (AMT in SNOMED CT-AU) | `medicationCodeableConcept` from the **PAM IV iron order** value set (system `http://snomed.info/sct`); `intent` order; `status` active, then completed when given; `authoredOn`; **`requester` (AU Core 1..1)**; `reasonReference` → Condition (or `reasonCode`); **one `dosageInstruction` per infusion** (`sequence`, `route` SNOMED 47625008, `doseAndRate.doseQuantity` mg). Total dose = sum of the doses. Ganzoni workings in `note` |
| Infusion booking | ServiceRequest | `code` SNOMED 718520009 *Intravenous iron infusion*; `basedOn` → the MedicationRequest; `occurrenceDateTime` = first infusion; `quantityQuantity` = number of infusions; `priority` routine/urgent. The day unit's Appointment is `basedOn` this |
| Infusion given | MedicationAdministration (optional) | `request` → MedicationRequest; `effectiveDateTime`; `dosage.dose`. If present, it is the outcome anchor |
| Rest of the treatment plan (recommended treatment) | MedicationRequest `intent` plan (oral iron, ESA); ServiceRequest `intent` plan (red cell transfusion, 116863004) | ⚑ PAM 14 = the plan per referral. Until A7 writes these, PAM 14 shows "IV iron ordered / none" |
| Limited consent / refusal of blood products | **Flag** | `category` `safety`; `code` SNOMED 699054003 *Administration of blood product declined* (or 708129006 *… refused for religious reason*); `code.text` lists the **declined** products from the PAM blood products value set, the reason and details; `period.start`. Consent may come later, if per-product consent needs to be a record |
| Requested target Hb | Goal | `lifecycleStatus` active; `target.measure` LOINC 718-7; `detailQuantity` `>=` g/L; `dueDate` = booked surgery date; `addresses` → Condition. **Not** the Ganzoni target Hb, which is a formula constant (150 g/L) |
| Patient education | **Procedure** (the countable record) + Communication (optional detail) | Procedure: `code` SNOMED 311401005 *Patient education*, `category` 409073007 *Education*, `status` completed, `performedDateTime`, `performer`, one `usedCode` per material (`LOCAL/education-material`). Communication: `partOf` → the Procedure, `category` HL7 `instruction`, `medium` (v3 ParticipationMode) per delivery method, `payload` per material, `about` → waitlist entry. **Count Procedures only** |
| Patient-reported pre-admission answers | QuestionnaireResponse | `questionnaire` = `url\|version`, so search `QuestionnaireResponse?subject=…&status=completed` and filter on `questionnaire.startsWith(url)` in FHIRPath |
| Form answers | QuestionnaireResponse | Kept alongside the extracted resources |

## Codes

| Test | LOINC | UCUM |
|---|---|---|
| Haemoglobin | 718-7 | g/L |
| Ferritin | 2276-4 | ug/L |
| Transferrin saturation | **14801-5** Iron saturation [Molar fraction] (RCPA SPIA). Read 2502-3 as well, because the current data and forms use it | % |
| CRP | 1988-5 (read 30522-7 hs-CRP too) | mg/L |
| MCV | 787-2 | fL |
| Vitamin B12 | 14685-2 (molar) | pmol/L |
| Folate | 14732-2 (serum, molar) | nmol/L |
| eGFR | 62238-1 CKD-EPI (read 98979-8 CKD-EPI 2021 too) | mL/min/{1.73_m2} |
| Body height / weight | 8302-2 / 29463-7 | cm / kg |

All of these pathology codes are in the RCPA SPIA reporting value set, which AU Core Pathology
Result binds `code` to (extensible).

Diagnoses and procedures: SNOMED CT-AU. Medications: AMT, which is part of SNOMED CT-AU, so the
system is `http://snomed.info/sct`. Always name the edition in value-set URLs:
`http://snomed.info/sct/32506021000036107?fhir_vs=ecl/…`. All of them are available on
[Ontoserver](https://r4.ontoserver.csiro.au/fhir).

### Value sets (ECL on SNOMED CT-AU)

| Value set | ECL / content |
|---|---|
| PAM diagnosis | `<< 271737000 \|Anaemia\| OR 35240004 \|Iron deficiency\| OR << 234340006 \|Iron deficiency without anaemia\|`. Pathway codes: IDA 87522002, ACD 234347009, ID **234340006**, anaemia (other) 271737000; 707323002 *Anaemia in CKD* as a nurse option. Note: 35240004 has no descendants; IDA is not under it |
| PAM IV iron order (A7 picker) | `(< 763158003 : 762949000 = (430077004 OR 1172494003), 411116001 = << 129011000036109) MINUS (* : 774158006 = *)`: 7 unbranded ferric carboxymaltose and ferric derisomaltose injections |
| PAM IV iron (detection, apps and A5) | `(< 763158003 : 762949000 = (430077004 OR 1172494003 OR 129497004 OR 708805001)) AND (< 763158003 : 411116001 = << 129011000036109)`: 33 concepts incl. branded, iron sucrose and iron polymaltose. Fallback: `dosageInstruction.route` 47625008 |
| PAM blood products | 126242007 red cells, 256395009 platelets, 346447007 FFP, 256401009 cryoprecipitate, 789265003 albumin, 714569001 normal immunoglobulin, 233568002 intraoperative blood salvage |
| Treatment plan | 718520009 IV iron infusion, 438911000124105 iron supplement therapy, 1156741008 ESA therapy, 116863004 red cell transfusion |

### Local code systems (placeholders until replaced)

| System (`LOCAL/…`) | Codes | Used on |
|---|---|---|
| `elective-category` | 1, 2, 3 | waitlist `ServiceRequest.category` |
| `referral-source` | surgeon, preadmission, anaesthetist, gp | referral `ServiceRequest.category` |
| `episode-type` | pam | `EpisodeOfCare.type` |
| `task-type` | follow-up | `Task.code` |
| `education-material` | (A8's list) | `Procedure.usedCode` |
| `blood-product-consent` | accept, limited, refuse, unsure | A6 and A11 answers (one system for both) |
| `blood-product-refusal-reason` | religious, personal, past-reaction, other, prefer-not | A6 and A11 answers |

## Decision rules used in calculations (to confirm with Metro North)

* **Anaemia:** Hb **<** 130 g/L (male), **<** 120 g/L (female) (WHO). No classification when sex is
  not male or female. ⚑ the peri-operative consensus suggests 130 g/L for both sexes.
* **Iron deficiency:** ferritin < 100 µg/L, or TSAT < 20% with ferritin 100–300 µg/L.
* **Inflammation:** CRP > 10 mg/L.
* **Pathway** (needs Hb, sex, ferritin, and TSAT when ferritin ≥ 100):

  | Pathway | Rule | Condition code |
  |---|---|---|
  | Iron deficiency anaemia | anaemia and (ferritin < 100, or ferritin 100–300 with TSAT < 20 and CRP ≤ 10 or missing) | 87522002 |
  | Anaemia of chronic disease | anaemia, ferritin 100–300, TSAT < 20, CRP > 10 | 234347009 |
  | Iron deficiency without anaemia | iron deficiency, no anaemia | 234340006 |
  | Anaemia, other cause | anaemia, no iron deficiency (MCV and eGFR hints in the text) | 271737000 |
  | None (clear) | neither | — |

* **Total iron dose (Ganzoni):** dosing weight × (target Hb − actual Hb) × 0.24 + iron stores.
  Dosing weight = the lower of actual weight and ideal body weight (Devine: 50 kg M / 45.5 kg F
  + 0.9 kg per cm over 152.4 cm), or actual weight with no height. Target 150 g/L and stores 500 mg
  (130 g/L and 15 mg/kg when **actual** weight < 35 kg). Stores alone when Hb ≥ target. Round to
  100 mg. Split into infusions of at most min(1000 mg, 20 mg/kg) for ferric carboxymaltose and
  min(1500 mg, 20 mg/kg) for ferric derisomaltose, at least 7 days apart.
* **Initial vs post-treatment** (A5, B1, B6, B9, dashboard): anchor = the **earliest** IV iron in
  the current PAM episode (MedicationAdministration `effective` if present, else MedicationRequest
  `authoredOn`). Initial = the latest result on or before the anchor; post-treatment = the latest
  result after it (on or before surgery if booked). No IV iron: earliest vs latest result in the
  episode, only if there are two or more. ⚑
* **Counting** (B2–B9): one PAM case = one referral (3457005, performer = the service). Timeframe =
  referral `authoredOn`. Exclude `entered-in-error` everywhere, plus `cancelled` and `draft` for
  requests and `cancelled` for results. A case with no waitlist entry shows category and unit
  "Unknown" rather than being dropped.

## Shared conventions for questionnaire modules

* Launch context names: `patient`, `user`, `encounter`.
* Shared variables on the root (unique names, so they survive `$assemble`): `sexCode`, `dob`,
  `heightCm`, `weightKg`, `hb`, `ferritin`, `tsat`, `crp`, `mcv`, `egfr`, `hbThreshold`
  (`iif(%sexCode='male',130,iif(%sexCode='female',120,{}))`), `anaemia`, `ironDeficiency`,
  `inflammation`, `pathway`, `suggestedDxCode`, `actualHb`, `idealWeight`, `weight` (dosing weight),
  `targetHb`, `ironStores`. Module x-fhir-query variables have module-specific names (`latestHb`,
  `pathHistory`, `dxWaitlist`, `eduSurgery`, `fuEpisode`, …).
* Root-level `sdc-questionnaire-extractAllocateId`: `ivIronOrderId` (A7), `eduProcedureId` (A8).
  `$assemble` drops module-level extensions.
* Extraction is template-based (`templateExtract`); Smart Forms does not support definition-based
  extraction. **One contained template per extracted resource**, because Smart Forms extracts each
  template once.
* Updates to existing resources (EpisodeOfCare status, Task completion, `Patient.generalPractitioner`)
  use FHIRPath Patch templates with Smart Forms' **non-standard** patch-URL sub-extension, or a full
  PUT with `resourceId` when the form owns the whole resource.
* `requester` / `performer` come from `%resource.author`, with an "ordered by" / "given by" item
  (pre-populated from `%user`) as the fallback, because AU Core requires `MedicationRequest.requester`.
* Give extracted resources an `identifier` (the QuestionnaireResponse id plus linkId) so that a second
  write-back can be detected. Smart Forms 1.0.16 drops `ifNoneExist`, so it is not enforced yet.
