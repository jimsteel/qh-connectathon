# A5 Pathology results (repeating): full solution

**Status: verified** (fhirpath.js checks, offline and live, and an end-to-end run in the patched
Smart Forms playground: pre-population, template extraction, write-back to Meld, pre-population
again. Last run 28 Oct 2026.)

Extends the starter module `questionnaires/modules/pam-pathology.json` (0.1.0). Every linkId and
variable name from 0.1.0 is kept (`pam-hb`, `pam-ferritin`, `pam-tsat`, `pam-crp`, `pam-hb-date`,
`pam-ext…`, `latestHb`, `latestFerritin`, `latestTsat`, `latestCrp`), so the decks' cut-down version
(`decks/examples/pathology-walkthrough.json`) and the diagnosis module still line up.

## What it does

| Part | How |
|---|---|
| **Latest results**: Hb, ferritin, TSAT, CRP, MCV, B12, folate, eGFR, each with its collection date | One `x-fhir-query` per test (`Observation?code=…&patient={{%patient.id}}&_sort=-date&_count=1`, variables `latestHb` … `latestEgfr`), `initialExpression` on each item |
| **Initial vs post-treatment** for all eight tests, with dates and the change | `initialExpression`s over two more queries: `pathHistory` (all eight tests, newest first, `_count=200`) and `pathIvIron` (MedicationRequests). Change = `calculatedExpression` (post − initial) |
| **All results** (repeating time points): one row per result, with date, test, value, unit, before / after IV iron, laboratory | Repeating `gtable` group filled with `sdc-questionnaire-itemPopulationContext` over `%pathHistory.entry.resource` |
| **Results from an external lab** (hand-entered) → **Observation** | Repeating group with `sdc-questionnaire-templateExtract`; one Observation per row (contained template `PAMExternalResultTemplate`) |

**Initial vs post-treatment rule.** Anchor = the most recent IV iron order (MedicationRequest with
route IV, SNOMED CT 47625008, and an iron product name, not cancelled / entered in error).
Initial = the latest result on or before that date; post-treatment = the latest result after it.
With no IV iron order (e.g. anaemia of chronic disease): initial = earliest result,
post-treatment = latest (only if there are two or more), which is the PAM dashboard's rule. Over the 40
synthetic PAM patients this gives exactly the generator's initial (`-1`) and post-treatment (`-2`)
results (160 patient-tests).

**Extracted Observation** (per row): `status` final, category laboratory, `code` = LOINC code with
its LOINC display and the short name as `text`, `subject` from the response, `effectiveDateTime`,
`valueQuantity` with the UCUM unit for that test, `performer.display` = the laboratory (left out when
blank), and a `note` saying it was entered by hand from an external report.

LOINC codes and units:

| Test | LOINC | Unit (UCUM) |
|---|---|---|
| Haemoglobin | 718-7 | g/L |
| Ferritin | 2276-4 | ug/L (µg/L) |
| Transferrin saturation | 14801-5 (also reads 2502-3, the code used before the AU Core switch) | % |
| CRP | 1988-5 | mg/L |
| MCV | 787-2 | fL |
| Vitamin B12 | 14685-2 (moles/volume) | pmol/L |
| Folate (serum) | 14732-2 (moles/volume) | nmol/L |
| eGFR | 62238-1 (CKD-EPI); searches also find 98979-8 (CKD-EPI 2021) | mL/min/{1.73_m2} |

**Shared variables:** this module needs no root variables. It defines the x-fhir-query variables
`latestHb`, `latestFerritin`, `latestTsat`, `latestCrp`, `latestMcv`, `latestB12`, `latestFolate`,
`latestEgfr`, `pathHistory`, `pathIvIron` (unique across the PAM modules). The A6 diagnosis module
reads `pam-mcv` and `pam-egfr` from this module through two new root variables (`mcv`, `egfr`; see
`../A6-diagnosis/root-variables.json`).

## Files

| File | Purpose |
|---|---|
| `soln-pam-pathology.json` | The module: id `soln-pam-pathology`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-pathology`, version 0.2.0 |
| `soln-A5-standalone.json` | Standalone test form `soln-A5-standalone` (`…/solutions/Questionnaire/A5-standalone`): the same item tree and template, without the assemble-child flag |
| `build.py`, `sdc.py` | Generate both forms (`python3 build.py`); `sdc.py` holds helpers shared with A6 |
| `test_data.py` → `test-data.json` | Test patient `soln-A5-patient-1` (Paula Pathtest, female): results on 3 June (another lab), 12 Aug (initial) and 24 Sep 2026 (post), IV iron order 20 Aug |
| `meld.py` | `forms` (PUT the Questionnaires), `data` (PUT the test data), `clean` (delete the test patient and everything that references it, including written-back results) |
| `verify.mjs`, `verify-lib.mjs` | fhirpath.js checks (below); the lib is shared with A6 |
| `playground.mjs`, `playground-lib.mjs` | Headless end-to-end run in the patched Smart Forms playground; the lib is shared with A6 |
| `playground-results/` | Responses and extracted bundle captured by `playground.mjs` |
| `screenshots/` | `01`–`07` from `playground.mjs` |

## How to try it

1. Load the test patient (deleted from Meld after testing, see below):
   `python3 test_data.py && python3 meld.py data`
2. Open https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND** (presenter
   guide §4). Gear → *Source FHIR Server URL* `https://gw.interop.community/QHConnectathon2026/open`
   → **?** → **SAVE URL AS SOURCE FHIR SERVER** → patient **Paula Pathtest** → **SAVE**.
3. Pick **soln-A5-standalone** → **BUILD FORM** → **POPULATE → Pre-populate**.
   Expect: latest Hb 121 g/L (24/09/2026), B12 310 and folate 22 (12/08/2026); IV iron 20/08/2026;
   Hb initial 104 → post 121 (change 17), ferritin 15 → 310 (295); B12 and folate have no
   post-treatment value; 18 rows under *All results*.
4. *Results from an external lab*: add rows, **EXTRACT → Template-based $extract**, **ADVANCED PROPS
   → EXTRACT**, then **REVIEW WRITE BACK ITEMS → WRITE BACK**, and pre-populate again.
5. Afterwards: `python3 meld.py clean`.

Or run it all headless: `python3 meld.py forms && python3 meld.py data && node playground.mjs`
(cleans up and reloads the baseline itself), then `python3 meld.py clean`.

## Verified

* `node verify.mjs` → **all 88 checks passed** (also `node verify.mjs --live` against Meld with the
  test data loaded). It evaluates every FHIRPath expression in the module with fhirpath.js 5 (R4
  model) and checks: latest values and dates, treatment date, initial / post / change for all eight
  tests, the 18 history rows (order, units, labs, before / after); edge cases (no IV iron:
  earliest vs latest, ignoring a non-iron IV order, a cancelled IV iron order and oral iron; IV iron
  with no earlier result; a product named only "Ferric derisomaltose"; dateTime with timezone);
  the rule against all 40 synthetic PAM patients; the Observation template for every answer option
  (code, LOINC display, UCUM unit, lab left out when blank); standalone = module; the playground's
  pre-populated response equals fhirpath.js's results (45 answers); and that every FHIRPath
  expression (73) was evaluated.
* `node playground.mjs` (patched Smart Forms playground 1.5.0, headless Chromium): pre-population as
  above; two external results (Hb 98 with a lab, B12 180 without) → transaction Bundle with two
  `POST Observation` exactly as intended; **WRITE BACK (2 ENTRIES)** succeeded on Meld; pre-populating
  again shows Hb 98 (27/10/2026), B12 180 and 20 history rows.
* All codes checked against Ontoserver (`../A6-diagnosis/check-codes.py`: 20/20 valid).
* Assembled into the whole PAM form with A6 (`../A6-diagnosis/assemble-check.mjs`), no duplicate
  variables, and run in the playground (`../A6-diagnosis/playground-assembled.mjs`).

Not verified: the SMART-launched Smart Forms app (only the playground); LHC-Forms.

## Decisions and known gaps (for the track leads)

* **LOINC codes** for the "to confirm" tests (table above) are my choice: the molar B12 and folate
  codes because Australian labs report pmol/L and nmol/L; serum folate, not red cell folate; eGFR
  CKD-EPI (62238-1) as the code written back. Please confirm.
* **Initial vs post-treatment** anchored to the most recent IV iron order (answers the dashboard
  README's open question); identical to the dashboard on the synthetic data. The IV iron test is a
  name match (`iron|ferr|ferumoxytol|ferinject|monofer|venofer`) plus IV route: an AMT value set
  would be better.
* Pre-populated values are editable, but only the *external lab* rows are written back. Editing a
  pre-populated value doesn't change the record.
* Hand-entered results must be in the unit shown with the test (g/L, not g/dL): no unit picker.
* History is limited to the 200 most recent results (no paging). Results without a value
  (e.g. reported as text) show an empty value. A comparator such as eGFR "> 90" is dropped.
* Written-back Observations have no `identifier`, so writing back the same form twice creates
  duplicates.
* The playground shows the history table squeezed next to its JSON editor (scroll sideways); the
  Smart Forms app uses the full width.

## AU Core 2.0.0 (29 Oct 2026)

External-result Observation → AU Core Pathology Result: **0 errors** (warning: no `performer` when no lab is entered). Changed: TSAT is LOINC **14801-5** *Iron saturation [Molar fraction] in Serum or Plasma* (in the RCPA SPIA value set AU Core binds to); pre-population still also reads 2502-3 for older data. `test-data.json` regenerated. `playground-results/` are from the earlier run (2502-3).

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
