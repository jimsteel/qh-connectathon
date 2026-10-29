Status: **partly verified** (FHIRPath with fhirpath.js, and the playground on 28 Oct 2026: pre-population, every enableWhen tree, ECL autocompletes, extraction of all 6 resources and write-back all work. Duplicate prevention (`ifNoneExist`) is dropped by Smart Forms; see Known gaps)

# A4 Past medical / surgical history: full solution

This extends the starter module `questionnaires/modules/pam-history.json`. It keeps the same top-level group `pam-history` and the
hidden `pam-history-module` item, and replaces the 🚧 scaffolding.

| File | What |
|---|---|
| `build.py` | Generates the two Questionnaires and `test-data.json`. `python3 build.py` |
| `soln-pam-history.json` | The module. Id `soln-pam-history`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-history`, version `0.2.0`, `assemble-child` |
| `soln-A4-standalone.json` | Standalone test form. Id `soln-A4-standalone`, canonical `…/solutions/Questionnaire/A4-standalone`. It adds the root variable `sexCode` and a hidden `pam-sex` item pre-populated from `Patient.gender` |
| `test-data.json` | Transaction Bundle (PUT) with test patient `soln-A4-patient-1` (*Blair Solnfour*, female):<br>• 3 problem-list Conditions, plus 1 encounter-diagnosis Condition that must *not* show<br>• 2 Procedures<br>• 3 MedicationStatements (1 completed, which must not show)<br>• 1 AllergyIntolerance |
| `load.sh` / `cleanup.sh` | PUT the test data and both Questionnaires to Meld / delete the test patient and everything that refers to it |
| `verify.mjs`, `verify-output.txt` | FHIRPath and terminology checks (85, all PASS) |
| `playground.mjs`, `screenshots/` | Headless Playwright run of the playground |
| `extracted-bundle.json`, `written-back-resources.json` | Output of the last playground run |

## What it does

**1. On record (pre-populated, read-only tables).** Four x-fhir-queries sit on the group:

* `Condition?patient=…&category=problem-list-item`. Past history is the problem list; the PAM diagnosis is an
  `encounter-diagnosis` and belongs to A6.
* `Procedure?patient=…&_sort=-date`
* `MedicationStatement?patient=…&status=active`
* `AllergyIntolerance?patient=…`

Each table is a repeating `gtable` group with `sdc-questionnaire-itemPopulationContext`, giving one row per resource. The
rows show:

* Conditions: condition, clinical status, onset
* Procedures: procedure, date
* Medications: medication, dose text
* Allergies: substance, reaction, criticality

**2. Bleeding and anaemia screening (enableWhen trees).**

* **GI tree:**
  * GI symptoms or blood loss? → symptoms (checkboxes, SNOMED) and "Investigated with endoscopy?"
  * "Yes, done" → repeating **Endoscopy** group (gastroscopy / colonoscopy / capsule, date, result). "Abnormal" → findings.
  * "Planned" → planned date.
  * The deepest chain is findings ← result ← investigated ← GI symptoms.
* **Heavy menstrual bleeding** is shown only when `%sexCode = 'female'` (`sdc-questionnaire-enableWhenExpression` on
  the shared root variable). Yes → reviewed by gynaecology? → management plan.
* **Anticoagulant / antiplatelet:**
  * yes → medicine (autocomplete; the AMT ECL is below)
  * plan (stop / bridging / continue / undecided) → last-dose date (enableBehavior any)
* **Previous transfusion:**
  * yes → most recent (date) → reaction? → reaction type (ECL `<< 82545002`)
  * a consent question (yes / limited / no) is shown once the transfusion question is answered
* **Previous iron therapy:** route → IV: product (AMT), reaction? → details; oral: tolerated?
* **Comorbidities associated with anaemia.** Each is yes/no → type, and the coded answer is written back as a Condition:
  * CKD → stage (SNOMED CKD stage 1–5; stage 4/5 → on dialysis?)
  * IBD → type
  * cancer → type (ECL `<< 363346000`) → current chemo/radiotherapy?
  * bleeding/clotting disorder (ECL `<< 64779008`)
  * liver disease (ECL `<< 235856003`)

**3. Add to the patient's record.** Repeating "New condition" (ECL `<< 404684003`, status, onset) and "New past
procedure" (ECL below, date) groups.

**Value sets.** All are SNOMED CT-AU implicit value sets (`http://snomed.info/sct/32506021000036107?fhir_vs=ecl/…`), expanded by Ontoserver:

| Item(s) | ECL |
|---|---|
| Conditions, reactions | `<< 404684003 \|Clinical finding\|` |
| Procedures | `<< 387713003 \|Surgical procedure\| OR << 423827005 \|Endoscopy\| OR << 116859006 \|Transfusion of blood product\|` |
| Medications (AMT) | `^ 929360061000036106 \|MP refset\| OR ^ 929360071000036103 \|MPUU refset\|` |
| Allergy substance | `<< 105590001 \|Substance\| OR ^ 929360061000036106` |
| **Anticoagulants / antiplatelets** | `^ 929360061000036106 : 127489000 \|Has active ingredient\| = (<< 372862008 \|Anticoagulant\| OR << 771452004 \|Platelet aggregation inhibitor\|)` (42 AMT medicinal products: apixaban, warfarin, aspirin, clopidogrel, …) |
| Transfusion reaction / cancer / coagulation disorder / liver disease | `<< 82545002` / `<< 363346000` / `<< 64779008` / `<< 235856003` |

Short lists (GI symptoms, endoscopies, CKD stages, IBD types, IV iron) use `answerOption` with real SNOMED CT-AU
codes. `verify.mjs` checks each code's display against Ontoserver. The answerValueSet URLs leave out the `|term|` parts (see Known gaps).

**Write-back (template-based extraction).** Each template is contained in the module:

| Template | Creates | From |
|---|---|---|
| `PAMHistoryCondition{Ckd,Ibd,Cancer,Coag,Liver}Template` | Condition (active, confirmed, `problem-list-item`, recordedDate now) | Each comorbidity's type/stage answer |
| `PAMHistoryNewConditionTemplate` | Condition (status, onset) | Each "New condition" row |
| `PAMHistoryNewProcedureTemplate` | Procedure (completed, performed date) | Each "New past procedure" row |
| `PAMEndoscopyTemplate` | Procedure (completed, category *Diagnostic procedure*, note = result + findings) | Each Endoscopy row |
| `PAMTransfusionTemplate` | Procedure *Transfusion of red blood cells* (performed date, `complication` = reaction type) | The transfusion details |

Condition and Procedure templates have an `ifNoneExist` (conditional create:
`patient=<id>&code=<system>|<code>`, plus `&date=` for endoscopies), so re-extraction does not duplicate the record.

Meld honours it: tested with a transaction, which returned `200 OK` pointing at the existing Condition. **Smart Forms
drops it**, though; see below.

No new shared root variables. The module uses the existing `sexCode`.

## How to try it

1. Recreate the test data (deleted from Meld after testing): `./load.sh`
2. Open https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**.
3. Settings: source server = the Meld open endpoint (validate, then save); patient **Blair Solnfour** (`soln-A4-patient-1`).
4. Pick **soln-A4-standalone** → **BUILD FORM** → **POPULATE → Pre-populate**. The "On record" tables should show:
   * 3 conditions (CKD stage 3, type 2 diabetes, osteoarthritis of knee; not the iron deficiency anaemia)
   * colonoscopy and appendicectomy
   * apixaban and metformin (not ferrous sulfate)
   * penicillin / rash / high risk

   Heavy menstrual bleeding is visible because the patient is female.
5. Answer the trees, then **EXTRACT → Template-based $extract** and **REVIEW WRITE BACK ITEMS → WRITE BACK**.
6. Afterwards: `./cleanup.sh`.

Automated: `./load.sh && node verify.mjs && node playground.mjs && ./cleanup.sh`.

## What was verified and how

* `verify.mjs` (85 checks, all PASS, `verify-output.txt`):
  * **Queries:** all four run against Meld for the test patient. The category and status filters exclude the encounter diagnosis and the completed medication.
  * **Pre-population:** every itemPopulationContext and every row's initialExpressions are evaluated.
  * **Shared variables:** `pam-sex` initial, `sexCode` and the HMB enableWhenExpression for female, male and missing sex.
  * **Extraction:** every `templateExtractValue` and `ifNoneExist` is evaluated against a sample response with two endoscopies, a transfusion with a reaction, CKD stage 3, a new condition and a new procedure.
  * **Coverage:** a check confirms that every expression was evaluated.
  * **Structure:**
    * every enableWhen points at an existing linkId with a matching answer type and option
    * no templateExtract item sits under a question
    * the standalone form's item tree is identical
  * **Terminology:**
    * all 12 answerValueSets expand on Ontoserver (SNOMED CT-AU 20260930), with expected members and non-members
    * every SNOMED answerOption's display matches Ontoserver
* Playground (`playground.mjs`, screenshots `01`–`11`):
  * Pre-population as above (`02`, `03`).
  * The trees open as answered (`04`–`07`).
  * The ECL autocompletes return results from Ontoserver: apixaban, urticarial transfusion reaction, carcinoma of colon, heart failure, total hip replacement.
  * Extraction gave **6 entries**: Conditions CKD stage 3, carcinoma of colon, heart failure; Procedures total hip replacement, gastroscopy (note "Abnormal: Gastric ulcer"), transfusion (complication 302972002). See `extracted-bundle.json`.
  * Write-back created all 6 on Meld, and they read back correctly (`written-back-resources.json`).
  * Pre-populating again showed heart failure in "On record" (closing the loop).
  * Everything written was then deleted.

## Known gaps, problems, decisions

* **Smart Forms drops `ifNoneExist`.** In `@aehrc/sdc-template-extract` (`buildBundle.ts`,
  `getOptionalBundleEntryRequestProperty`), a result is kept only when `typeof result[0].id === 'string'`, which a string
  never satisfies. So re-extracting creates duplicates. The playground run duplicated CKD stage 3, which was already on the record.
  The Questionnaire is spec-correct and Meld honours conditional create. **Worth an upstream bug report.**
  Workaround in the UI: untick existing items in the write-back dialog.
* **Two Smart Forms behaviours shaped the structure** (both found in testing):
  1. Template extraction finds items only via `item.item`, not `answer.item`. So follow-up questions are siblings of
     their question inside a wrapper group (`<linkId>-group`) rather than nested children; the enableWhen logic is
     unchanged.
  2. A contained template referenced from several items is extracted for none of them. Hence one Condition template per comorbidity.
* **ECL terms are stripped from answerValueSet URLs.** Smart Forms puts the URL into `$expand?url=` unencoded, and
  Ontoserver then reads `|term|` as a version ("Invalid version format for SNOMED"). The ECL with terms is in `build.py`
  and above.
* **The "On record" tables are read-only.** Corrections to existing records are not written back; only new or comorbidity
  answers are.
* **Comorbidity questions are not pre-populated from the record.** Doing so would need subsumption (e.g. any CKD stage),
  and FHIRPath in Smart Forms can't do that offline.
* **Not extracted:** GI symptoms, heavy menstrual bleeding, anticoagulant plan, iron history and transfusion consent are
  answers only. A transfusion consent of "Limited consent" or "No" overlaps with A6's Flag.
* **Decisions for track leads:**
  * Past history = `problem-list-item` Conditions.
  * New Conditions are recorded as `confirmed`.
  * The endoscopy result goes in `Procedure.note`, not `outcome`.
  * The transfusion code is fixed to red cells.
* The module was not run inside the assembled root form (the root already has `sexCode`).

## AU Core 2.0.0 (29 Oct 2026)

Conditions → AU Core Condition, Procedures → AU Core Procedure: **0 errors**. Changed: the endoscopy Procedure's `category` was SNOMED `103693007` *Diagnostic procedure*, now inactive; it is now `386053000` *Evaluation procedure* (its SNOMED historical association). `extracted-bundle.json` / `written-back-resources.json` are the earlier playground run and still show the old code.

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
