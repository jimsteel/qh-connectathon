# A10 Modular assembly: full solution

**Status: verified.** The assembled form was built by script from the current solution modules,
checked with fhirpath.js (`verify.mjs`: all pass) and run end to end in the patched Smart Forms
playground. That run covered pre-population from all 10 modules, cross-module calculations, a what-if,
extraction of 4 resources across 3 modules and write-back to Meld (`playground.mjs`: all pass). Last run 29 Oct 2026.
Not verified: a SMART launch of the real Smart Forms app (see *Gaps*).

The full PAM form is assembled from the A1–A9 solution modules plus the A11 nurse-side module, using
`subQuestionnaire` + `$assemble`. The assembler is `@aehrc/sdc-assemble`, the library behind the
Smart Forms `$assemble` service, as in `questionnaires/assemble.mjs`.

## What's here

| File | |
|---|---|
| `soln-pam-root.json` | The solution root: id `soln-pam-root`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-root`, version `0.2.0`, `assemble-root`. Holds the patient launchContext, 22 shared variables, 2 `extractAllocateId`s, and one `subQuestionnaire` item per module (`<canonical>\|0.2.0`) under the `pam-tabs` tab container. |
| `soln-pam-assembled.json` | The assembled form: id `soln-pam-assembled`, **same canonical as the root, version `0.2.0-assembled`**. Smart Forms uses this convention to find a pre-assembled form, and the MBS 715 form on the CSIRO forms server uses it too. It has 10 tabs, 342 linkIds, 27 contained templates and 61 variables. |
| `build.mjs` | Builds both forms. It reads the modules **from their solution folders** at build time, checks them against each other, assembles them, and writes `build-output.txt` (the clash report and the root-variable table). `node build.mjs --selftest` injects one clash of each kind and checks that each one is reported. |
| `verify.mjs` | fhirpath.js (R4) checks of the assembled form. See *Verified*. Output: `verify-output.txt`. |
| `fixtures-xfhirquery.json` | Meld's responses to the form's 27 x-fhir-queries for the test patient, so `verify.mjs` runs offline (`--live` refreshes them). |
| `testdata.py` → `testdata-bundle.json` | Test patient `soln-A10-patient-1`, **Ada Assembletest**, with 52 more resources. Built from the other scenarios' test bundles with ids remapped (`soln-A<n>-x` → `soln-A10-a<n>-x`); the script header says which bundle supplies what. |
| `meld.py` | `forms` (PUT root + assembled), `modules` (compare the module files with Meld, read-only), `data`, `clean` |
| `playground.mjs`, `playground-lib.mjs` | Headless playground run (below). Output in `playground-output.txt`; the response, extract bundle and written-back resources are in `playground-results/`, and screenshots are in `screenshots/` |

## The modules

| Tab | Module (canonical `…/solutions/Questionnaire/…` \| 0.2.0) | From |
|---|---|---|
| Patient details | `pam-patient-details` (`soln-pam-patient-details`) | A1 |
| GP details | `pam-gp-details` | A2 |
| Proposed surgery | `pam-proposed-surgery` | A3 |
| History | `pam-history` | A4 |
| Patient-reported (pre-admission form) | `pam-patient-reported` (`soln-A11-nurse-import`) | A11 |
| Pathology | `pam-pathology` | A5 |
| Diagnosis | `pam-diagnosis` | A6 |
| Treatment | `pam-treatment` | A7 |
| Patient education | `pam-education` | A8 |
| Follow-up and status | `pam-follow-up` | A9 |

**A11:** the patient's own form (`soln-A11-pre-admission`) is **not** part of the assembled form. It is a
separate form with a different user (the patient, at home), and its output is a
QuestionnaireResponse. The A11 nurse-side module is included. It is an `assemble-child` that pre-populates
the patient's answers (transfusion wishes, diet, blood thinners) into the nurse's form. I placed its tab
after *History*.

## What the build checks and does (`build-output.txt`)

* **Module identity:** canonical, version 0.2.0 and `assemble-child` for each module. All OK.
* **linkIds across modules: one clash, `pam-target-hb`.** A6 uses it for the requested target Hb, which feeds
  the Goal. A7 uses it for Ganzoni's target Hb. Left alone, the assembler silently renames the second
  one to `linkIdPrefix-pam-target-hb`. A7's MedicationRequest note template reads
  `%resource.repeat(item).where(linkId='pam-target-hb')`, which would then also pick up A6's answer.
  **The build renames A7's item to `pam-ganzoni-target-hb`, together with all 3 references inside A7.**
  This happens only in the assembled copy; the A7 folder is unchanged (`RENAMES` in `build.mjs`).
* **Hidden module items:** A7 and A8 give `pam-<module>-module` the value `soln-pam-<module>|0.2.0`, and the
  other modules use `pam-<module>|0.2.0`. The build normalises A7 and A8 to `pam-…` in the assembled copy.
* **Variable and population-context names:** 46 module-level names, none duplicated, and none that
  shadows a root variable.
* **Contained templates:** 27, and no id clash. The assembler keeps the *first* contained resource with
  a given id and silently drops the rest. So the build merges identical copies, and renames a clashing
  template to `<id>-<module>` (including its `#id` references in that module). `--selftest` exercises this.
* **Extensions the assembler drops:** it keeps only variables, launchContexts and a few other module-level
  extensions. The `extractAllocateId`s of A7 (`ivIronOrderId`) and A8 (`eduProcedureId`) are therefore
  lifted onto the root. The playground run confirms the effect: A7's ServiceRequest `basedOn` resolves to
  the MedicationRequest.
* **Every `%var` a module uses** is defined in the module, on the root, or is built in.
* The root variables are cross-checked against the standalone forms of A1, A3, A4, A6 and A7. All expressions are identical.

## Root variables

The union of the 0.1.0 root variables and what the module READMEs ask for, **with the proposed
corrections** from A6 (`hbThreshold`) and A7 (`weight`, `targetHb`, `ironStores`). The build computes
which module needs each one by scanning the module expressions:

| Variable | Needed by (directly) | Needed by (through another root variable) | Source |
|---|---|---|---|
| `sexCode` | A4, A7 | A6 | 0.1.0 root |
| `dob` | A1 | — | 0.1.0 root |
| `heightCm` | A1, A7 | — | 0.1.0 root |
| `weightKg` | A1, A7 | — | 0.1.0 root |
| `hb` | A6 | A7 | 0.1.0 root |
| `ferritin` | — | A6 | 0.1.0 root |
| `tsat` | — | A6 | 0.1.0 root |
| `crp` | — | A6 | 0.1.0 root |
| `mcv` | A6 | — | new (A6) |
| `egfr` | A6 | — | new (A6) |
| `surgeryDate` | A3 | — | new (A3) |
| `hbThreshold` | — | A6 | **changed** (A6: `iif(%sexCode = 'male', 130, iif(%sexCode = 'female', 120, {}))`; 0.1.0 used 120 for any non-male sex) |
| `anaemia` | A6 | — | new (A6) |
| `ironDeficiency` | A6 | — | new (A6) |
| `inflammation` | A6 | — | new (A6) |
| `pathway` | A6 | — | new (A6) |
| `suggestedDxCode` | A6 | — | new (A6) |
| `actualHb` | A7 | — | 0.1.0 root |
| `idealWeight` | A7 | — | 0.1.0 root |
| `weight` | A7 | — | **changed** (A7: actual weight when there is no height) |
| `targetHb` | A7 | — | **changed** (A7: 35 kg rule on actual body weight) |
| `ironStores` | A7 | — | **changed** (A7: 35 kg rule on actual body weight) |
| `ivIronOrderId` (extractAllocateId) | A7 | — | lifted from the module (the assembler drops it) |
| `eduProcedureId` (extractAllocateId) | A8 | — | lifted from the module (the assembler drops it) |

A2, A5, A8, A9 and A11 need no root variables. Their queries are module-level variables, which the
assembler moves onto each module's top-level group.

## How to try it

Questionnaires on Meld: `soln-pam-root` and `soln-pam-assembled` (the modules `soln-pam-*` and
`soln-A11-nurse-import` are the other agents'; `python3 meld.py modules` showed them identical to the files).
The test data is **not** left on Meld. Load it first:

```sh
python3 testdata.py && python3 meld.py data     # soln-A10-patient-1 + 52 resources
```

1. https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND** → gear → source
   `https://gw.interop.community/QHConnectathon2026/open` (**?**, **SAVE URL…**) → patient
   **Ada Assembletest** → **SAVE** → pick **soln-pam-assembled** → **BUILD FORM** → **POPULATE → Pre-populate**
   (takes about 10 s: 27 queries).
2. Every tab fills. Patient details: female, 162 cm, 68.4 kg. GP: Dr Ruth Ambrose. Surgery: total hip
   replacement on 18/11/2026. History: CKD 3, T2DM, OA knee. Patient-reported: *Only some blood
   products*. Pathology: Hb 121, ferritin 310 (post-treatment). Diagnosis: no anaemia. Treatment: Ganzoni
   877 → 900 mg. Education: THR, Dr Alan Pierce. Follow-up: *Being managed*.
3. What-if across modules: on **Pathology**, set Hb 104, then ferritin 15. **Diagnosis** now suggests iron
   deficiency anaemia (87522002), and **Treatment** shows a deficit of 1098 → 1100 mg. Wait a couple of
   seconds between edits (see *Gaps*).
4. Confirm *Iron deficiency anaemia* (Diagnosis), change the weight to 70 (Patient details), and tick
   *Intravenous iron infusion*, a ferric carboxymaltose product and a date (Treatment). Then **EXTRACT →
   Template-based $extract (modified only)**: Observation, Condition, MedicationRequest (with
   `reasonCode` 87522002 from the *Diagnosis* tab), ServiceRequest (`basedOn` the MedicationRequest), and
   A9's follow-up Task.
5. Clean up: `python3 meld.py clean`.

Headless: `python3 meld.py forms && python3 meld.py data && node playground.mjs --write-back && python3 meld.py clean`.

Rebuild after a module changes:
`(cd ../../questionnaires && npm install)` once (or `SDC_ASSEMBLE_DIR=<folder with @aehrc/sdc-assemble>`), then
`node build.mjs && node verify.mjs && python3 meld.py forms`.

## Verified

* `node build.mjs`: no unresolved clashes; one linkId rename and two hidden-value normalisations,
  as above. `node build.mjs --selftest`: an injected contained-id clash, linkId clash, name clash and
  undefined `%var` are each reported, and the clashing template is renamed and kept.
* `node verify.mjs` (**ALL PASS**, `verify-output.txt`):
  * Structure:
    * linkIds are unique (342).
    * Every `enableWhen.question` exists.
    * Every `linkId='…'` read by an expression exists (113). 9 of them are `pam-pa-*` items, which the A11 module reads from the patient's own response; they were checked against the A11 patient form.
    * All 27 `#id` references resolve, and every contained resource is used.
    * The root variables and allocateIds are carried into the assembled form.
    * **Each module's item tree and templates appear in the assembled form unchanged**, apart from the documented changes, compared against the files in the module folders now.
  * Every `%name` is defined in scope: root variables, allocateIds, and the variables and population contexts of the item and its ancestors. For templates, this is the scope of the item that references them.
  * All **406 FHIRPath expressions parse and evaluate without error**: initial, calculated and enableWhen expressions, variables, x-fhir-query `{{ }}`, and every `templateExtractValue` / `templateExtractContext` / templateExtract sub-extension, walked through the templates as the extractor does. The test data is the response the playground pre-populated for the test patient, the test Patient, and the real x-fhir-query results. 295 evaluations are non-empty.
  * **fhirpath.js gives the same value as the playground for all 148 calculated and pre-populated items.**
  * The cross-module root variables have the expected values.
* `node playground.mjs --write-back` (**ALL PASS**, `playground-output.txt`, screenshots `01`–`14`):
  * Pre-population gave the expected values in every module (above).
  * The A6 what-if passed, and so did the A7 Ganzoni recalculation from A5 results through the root variables.
  * Modified-only extraction gave: the A1 weight Observation; the A6 Condition; the A7 MedicationRequest with its `reasonCode` from A6's answer; the A7 ServiceRequest with `basedOn` = the MedicationRequest's `urn:uuid`, from the lifted `extractAllocateId`; and A9's Task.
  * The write-back succeeded (5 entries). Reading back from Meld found the Observation, Condition, MedicationRequest and ServiceRequest, with `basedOn` resolved to `MedicationRequest/<id>`.
  * Afterwards `meld.py clean` deleted everything.
* Waitlist choice: the test data has an active and a completed waitlist entry, and A3, A6 and A8 picked the same one (the active one).

## `$assemble` and the playground (findings)

* **The playground does not assemble.** Building `soln-pam-root` shows the subQuestionnaire display items
  as tabs and "Unable to load group" (`screenshots/15-root-form-in-playground.png`). It made no
  `$assemble` call and no search for the `-assembled` version. So in the playground, pick
  **soln-pam-assembled**. The Smart Forms app proper is documented to look for
  `<url>|<version>-assembled` on its forms server and fall back to `$assemble`; that wasn't tested here.
* **Meld** (HAPI 6.0.0) has no `$assemble`: `POST Questionnaire/$assemble` → "not-supported".
* **The Smart Forms forms server** `https://smartforms.csiro.au/api/fhir` has a `$assemble` service:
  * `GET` → "This service is healthy! Perform a POST request…".
  * `POST` with `Content-Type: application/json` and a `Parameters` body (`questionnaire` = the root) runs.
  * It resolves subQuestionnaires **only from that server**. With our root it answered: *Unable to fetch questionnaire with canonical url '…/pam-patient-details|0.2.0' at https://smartforms.csiro.au/api/fhir*.
  * With `application/fhir+json` it rejects the same body ("Parameters provided is invalid against the $assemble specification").
  * I did not load our modules there (shared-server rules), so a server-side `$assemble` of the PAM form wasn't run.
  * The MBS 715 precedent is on that server: `http://www.health.gov.au/assessments/mbs/715`, versions `0.3.0-assembled` and `0.4.0-assembled`, plus `AssemblyInstructions` 0.4.0. That is the same `-assembled` convention used here.
  * So the assembled form is produced offline (`build.mjs`) and PUT, as the starter (`questionnaires/assemble.mjs`) does.

## Gaps and decisions (for the track leads)

* **Rename `pam-target-hb` in one of the modules upstream** (A7's is the better candidate). Until then, the
  build renames it in the assembled copy, so the A7 standalone form and the assembled form use
  different linkIds for the Ganzoni target Hb. The same goes for the A7 / A8 hidden-value normalisation.
* The root uses the **changed** `hbThreshold`, `weight`, `targetHb` and `ironStores` (A6, A7 proposals), so
  `soln-pam-root` 0.2.0 differs from the starter root 0.1.0 in behaviour, not just in content.
* **Calculations can go stale with fast consecutive edits.** In the first playground run, Hb then ferritin
  were changed 2.5 s apart. Items that depend on Hb only (`pam-anaemia`, A7's inputs and Ganzoni) kept their
  old values, while the pathway updated. With 4 s between edits, everything updated, and a single Hb edit
  updated everything in both the assembled and the standalone forms. This looks like a Smart Forms
  timing issue with this large form (61 variables) and is worth reporting. It didn't reproduce with
  pauses.
* "Modified only" extraction also produces **A9's follow-up Task** although nothing on the A9 tab was
  edited (its next-step items are pre-filled). That is A9's design, but in the whole form it means every save
  creates a Task. Worth a decision.
* Pre-population makes 27 queries. The same referral query appears 3 times under different names (A2, A3,
  A9; see `REVIEW-strand-A.md`), and so does the waitlist query (A3, A6, A8). That's fine for the
  demo; a shared root-level query would be leaner, but the assembler only propagates module variables to
  the module group, so it would have to be hand-placed on the root.
* Not tested: a SMART EHR launch of the Smart Forms app with the root form (`-assembled` lookup), and
  saving the QuestionnaireResponse.
* Left on Meld: `Questionnaire/soln-pam-root`, `Questionnaire/soln-pam-assembled`. Test data deleted.

## AU Core 2.0.0 (29 Oct 2026)

Rebuilt with the AU Core changes of A1, A4, A5 and A7 (the assembled form now has the `user` launch context too). All its templates: **0 errors** against AU Core 2.0.0 / AU Base (see the scenario READMEs). `testdata-bundle.json` regenerated (TSAT 14801-5); `verify.mjs` gives `%user` = Practitioner/pam-nurse-1 and `fixtures-xfhirquery.json` was refreshed with `--live` (test data loaded, then removed with `meld.py clean`). `playground-results/` are from the earlier run.

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
