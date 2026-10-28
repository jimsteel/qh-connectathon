# Review: strand A full solutions (A1–A9, A11)

Reviewed 29 Oct 2026, 00:05–00:30 AEST. A10 was not reviewed (being built at the time).

## How verify was run

`node verify.mjs` was run in each folder with `NODE_PATH=T/decks/node_modules` (plus a scratch install of
`@aehrc/sdc-template-extract@1.0.16` for the optional extraction checks).

**None of the test patients is on Meld.** All `soln-A*-patient-1` return HTTP 410: every author deleted
their test data on purpose, to keep it out of the dashboard. A1, A2, A5 and A6 verify offline (fixtures), so
they run as they are. A3, A4, A7, A8, A9 and A11 read the test patient live, so they crash or FAIL until the test data is
loaded (`load.sh` / `reset-test-data.sh` / `curl … test-data.json`). The reviewer wasn't allowed to write test data
to the shared sandbox. Instead, those scripts were run with a fetch mock that answers searches for `soln-*` patients from the
folder's own `test-data.json` and passes everything else (pam-* reads, Ontoserver) to the real servers.
"Mock" below means this.

All 23 `soln-*` Questionnaires on Meld were byte-for-byte identical to the local JSON (ignoring `meta` and `text`) before the review.

| Folder | Verify | README claim | Notes |
|---|---|---|---|
| A1 patient details | 51/51 PASS (offline) | 51 | OK |
| A2 GP details | 104/104 PASS (offline) | 104 | OK |
| A3 proposed surgery | live: crash (no test patient); mock: 47/47 PASS | 47 | |
| A4 history | live: crash; mock: 85/85 PASS (also after the fix) | 85 | fixed one code, see below |
| A5 pathology | 88/88 PASS | 88 | |
| A6 diagnosis | 66/66 PASS | 66 | |
| A7 treatment | live: 2 FAIL (no test patient), extraction SKIP; `offline` + lib: ALL PASS (57); mock + lib: ALL PASS (58) | ALL PASS | |
| A8 education | live: 3 FAIL (no test patient); mock + lib: ALL PASS (22); `offline` + lib: 1 FAIL | ALL PASS | The `offline` FAIL is a verify bug: `communication-links` hard-codes `ServiceRequest/soln-A8-patient-1-surgery` but the offline fixture uses `sr1`. Module is fine. |
| A9 follow-up | live: crash; mock: 34/34; mock + `EXTRACT_DIR`: 44/44 PASS | 34 / 44 | |
| A11 pre-admission | live: crash; `--offline`: 30/30 PASS; mock: 30/31 | 31 live / 30 offline | The mock's 1 FAIL is the Meld-specific `questionnaire=` search check (not mockable). |

## Fixes made

* **A4** `build.py` (→ `soln-pam-history.json`, `soln-A4-standalone.json`): GI symptom *Weight loss* used
  SNOMED 89362005, **inactive** in SNOMED CT-AU since 2025-01-01. It is now 262285001 *Weight loss*, the SAME AS
  replacement. The fix was rebuilt with `build.py`: the diff is that one code in each file, and `test-data.json` is unchanged. Mock verify still passes
  85/85. Both Questionnaires were re-PUT to Meld (200), and Meld now matches the local files. `verify-output.txt` (a recorded run) still
  shows the old code.
* **A11** `README.md`: the README said SNOMED has no active "transfusion refused" concept except 708129006. That is
  wrong: 699128009 *Blood transfusion declined* and 699054003 *Administration of blood product declined* are both active.
  The sentence is corrected. It now also says that the product answers are procedure concepts.

## Per folder: coverage and issues for the leads

Every module covers its whole Scenarios.md row: the prepop sources, the calculations and every listed write-back resource.
Every module also follows the conventions: id `soln-pam-<module>`, the solutions canonical, version 0.2.0, the top group and a
hidden `pam-<module>-module` item, and `pam-` linkIds that are unique within the module. All LOINC/SNOMED codes were looked up on
r4.ontoserver; all UCUM units are valid; all answerValueSets expand. The exceptions are listed below.

* **A1.** No issues. Interpreter uses the core `patient-interpreterRequired` extension. A11 uses AU Base
  `interpreter-required` (see consistency).
* **A2.** No issues. FHIRPath Patch with the Smart Forms-specific `PatchRequestUrl` sub-extension is a design
  choice to note to participants.
* **A3.** Needs a new root variable `surgeryDate`. Requester = surgeon, even when the referral source is GP (open mapping
  question).
* **A4.** `PAMEndoscopyTemplate` sets `Procedure.category` = SNOMED 103693007 *Diagnostic procedure*. That concept
  has been **inactive since 2023-04-30**, with no historical association. It is the value in the FHIR R4 procedure-category example
  value set, so it was left as is: the leads should decide. Smart Forms drops `ifNoneExist` (upstream bug; documented).
* **A5.** eGFR is written back as 62238-1 (CKD-EPI 2009). Australian labs report CKD-EPI 2021 (98979-8), which is
  searched but not written. The LOINC choices for B12, folate and eGFR need confirming (README says so).
* **A6.** Proposes 7 new root variables (`mcv`, `egfr`, `anaemia`, `ironDeficiency`, `inflammation`, `pathway`,
  `suggestedDxCode`) and a **changed `hbThreshold`** (empty for sex other/unknown). Its "Other diagnosis" ECL
  answerValueSet URL is not percent-encoded, unlike A3 and A4. It worked in the playground.
* **A7.** Proposes **changed root `weight`, `targetHb`, `ironStores`**, and a root-level `extractAllocateId`
  (`ivIronOrderId`). The AMT ECL uses `http://snomed.info/sct?fhir_vs` (no AU edition URI). It expands on r4.ontoserver only
  because the default edition is AU. The other modules use `http://snomed.info/sct/32506021000036107?fhir_vs`. The
  MedicationRequest puts one dosageInstruction per infusion, while the synthetic data has the total in `dosageInstruction[0]`
  (affects B1/B5/B6). The hidden module item's value is `soln-pam-treatment|0.2.0`, not `pam-treatment|0.2.0`.
* **A8.** Needs a root-level `extractAllocateId` (`eduProcedureId`). The hidden module item's value is
  `soln-pam-education|0.2.0`. The waitlist query has no `status=active` and takes the latest *authored* entry (see
  consistency). Local education-material codes are placeholders.
* **A9.** No issues. Task due date is in `restriction.period.end` (matches the synthetic data, not the mapping's
  `executionPeriod`).
* **A11.** The nurse module's id is `soln-A11-nurse-import`. By convention it would be `soln-pam-patient-reported`, since its canonical is
  `…/pam-patient-reported`. It wasn't renamed because the id is on Meld and in the scripts.

## Cross-module consistency (for A10 and the leads)

1. **linkId clash: `pam-target-hb` is in both A6** (requested target Hb for the Goal) **and A7** (Ganzoni target).
   `$assemble` / Smart Forms need unique linkIds, so one must be renamed before A6 and A7 are assembled together.
2. **Root variables:** none of the new names clash. But A6 changes `hbThreshold`, and A7 changes `weight` / `targetHb` /
   `ironStores`. A3 adds `surgeryDate`, and A6 adds 7 variables. A7 and A8 each need an `extractAllocateId` on the root. No module redefines a
   root variable at module level.
3. **Contained template ids:** no clashes across modules.
4. **Blood product consent is coded three ways:** A4 has an un-extracted yes/limited/no question. A6 uses the local
   `blood-product-consent` codes and SNOMED *product* concepts (126242007, 256395009, 346447007, 256401009, 789265003,
   714569001). A11 uses the local `transfusion-preference` codes and SNOMED *transfusion procedure* concepts (116863004, 180208003,
   13569004, 116795008, 116788004, 233568002). A11's README suggests feeding A6 from the patient's answers, but the codes
   don't line up.
5. **"The waitlist entry" is chosen differently:** A3 uses `status=active`, earliest `occurrence`. A6 uses `status=active` and filters
   by elective category in FHIRPath. A8 has no status filter and takes the latest `authored`. On a patient with an old entry these can disagree.
6. The same referral query (`ServiceRequest … code=3457005 … _sort=-authored&_count=1`) is defined three times, under different
   names (`gpReferral` A2, `bmsReferral` A3, `fuReferral` A9). It's harmless, but it means three requests in the assembled form.
7. **Interpreter extension:** A1 reads the core `patient-interpreterRequired`, A11 reads AU Base `interpreter-required`.
8. **Hidden module item values:** A7 and A8 use `soln-pam-…|0.2.0`, while the others use `pam-…|0.2.0`.
9. **SNOMED edition in implicit value set URLs:** A7 omits the AU module URI (see A7).
10. **IV iron detection:** A5 detects IV iron by product-name regex plus IV route. A7 uses an AMT ECL. One shared AMT value set would serve both.
