# A6 Diagnosis + decision support: full solution

**Status: verified** (fhirpath.js checks, offline and live, including all 40 synthetic PAM patients;
end-to-end runs in the patched Smart Forms playground, standalone and inside the assembled PAM
form, with write-back of Condition, Flag and Goal to Meld. Last run 28 Oct 2026.)

Extends the starter module `questionnaires/modules/pam-diagnosis.json` (0.1.0): keeps
`pam-diagnosis-section`, `pam-anaemia`, `pam-iron-deficiency`, `pam-inflammation`, `pam-diagnosis`
and the `PAMDiagnosisTemplate`, and adds the rest of the scenario.

## What it does

**Pathway classification (calculated expressions, sex-specific thresholds).** Inputs: sex (`pam-sex`,
Patient details) and Hb, ferritin, TSAT, CRP, MCV, eGFR (Pathology, A5). Rules from the track's
[FHIR mapping](../../FHIR-Mapping-DRAFT.md):

| Finding | Rule |
|---|---|
| Anaemia | Hb ≤ 130 g/L (male), ≤ 120 g/L (female) |
| Severity (WHO) | severe < 80, moderate 80–109, otherwise mild |
| Iron deficiency | ferritin < 100 µg/L, or TSAT < 20% with ferritin 100–300 µg/L |
| Inflammation | CRP > 10 mg/L |

| Pathway | When | Suggested diagnosis (SNOMED CT-AU) |
|---|---|---|
| `ida` | anaemia and ferritin < 100; or anaemia, TSAT < 20%, ferritin 100–300, no inflammation | 87522002 Iron deficiency anaemia |
| `acd` | anaemia, TSAT < 20%, ferritin 100–300, CRP > 10 | 234347009 Anaemia of chronic disease |
| `id` | iron deficiency, no anaemia | 35240004 Iron deficiency |
| `anaemia` | anaemia, no iron deficiency (text adds MCV > 100 / < 80 and eGFR < 60 hints) | 271737000 Anaemia |
| `none` | neither | — |

No pathway (and no suggestion) while Hb, ferritin or (for ferritin ≥ 100) TSAT is missing, or sex
isn't male / female (with the proposed threshold, below). This reproduces the recorded diagnosis of
**all 40 synthetic PAM patients** (22 IDA, 6 iron deficiency, 5 ACD, 7 none).

**Diagnosis → Condition.** The nurse confirms the diagnosis from five SNOMED CT-AU options (the
four used in the synthetic data plus 707323002 Anaemia in chronic kidney disease); a warning appears
(`enableWhenExpression`) if it differs from the suggestion. *Other diagnosis* searches SNOMED CT-AU
on Ontoserver (`answerValueSet` = ECL `<< 271737000 OR << 35240004`, autocomplete). Each answered one
becomes a Condition: clinical status active, verification confirmed, category encounter-diagnosis,
`recordedDate` now, and the pathway text as a `note`.

**Blood products → Flag.** Consent: all / limited / refuses all; for limited, which products are
declined (SNOMED CT-AU: red cells, platelets, FFP, cryoprecipitate, albumin, normal immunoglobulin);
reason; details. Limited consent or refusal → a Flag: status active, category `safety`, code
708129006 *Transfusion of blood product refused for religious reason* (religious reason) or
699054003 *Administration of blood product declined*, and a `text` that spells out what is
declined, why and the details; `period.start` today. Full consent → no Flag (a hidden calculated item
has an answer only for limited / refused consent and carries the template).

**Requested target Hb → Goal.** Target Hb (g/L), *requested by* (surgeon / anaesthetist /
haematologist / patient), and a due date pre-populated with the booked surgery date (the active
waitlist ServiceRequest with an elective category). Also shows the Hb increase needed. Goal:
lifecycleStatus active, description "Haemoglobin at least 130 g/L before surgery", target LOINC
718-7 with `detailQuantity` `>=` 130 g/L and `dueDate`, `startDate` today, requester as a `note`.

## Shared (root) variables

Existing on `pam-root` 0.1.0 and used: `sexCode`, `hb`, `ferritin`, `tsat`, `crp`, `hbThreshold`.
**New, to add to the root** (definitions in `root-variables.json`): `mcv`, `egfr`, `anaemia`,
`ironDeficiency`, `inflammation`, `pathway`, `suggestedDxCode`. Module-level x-fhir-query variable:
`dxWaitlist`.

**Proposed root change:** `hbThreshold` = `iif(%sexCode = 'male', 130, iif(%sexCode = 'female', 120, {}))`.
The current one uses 120 for anything but male, so sex *other* / *unknown* / blank is classified
with the female threshold. The standalone form uses the proposed version; the module works with
either (verified: identical results for male and female).

## Files

| File | Purpose |
|---|---|
| `soln-pam-diagnosis.json` | The module: id `soln-pam-diagnosis`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-diagnosis`, version 0.2.0 |
| `soln-A6-standalone.json` | Standalone test form `soln-A6-standalone` (`…/solutions/Questionnaire/A6-standalone`): the root variables, an editable *Inputs* group (sex + latest results, pre-populated) and the module |
| `root-variables.json` | Root variables the module needs: existing, new, proposed `hbThreshold` |
| `build.py` | Generates the three files above (uses `../A5-pathology/sdc.py`) |
| `test_data.py` → `test-data.json` | Test patient `soln-A6-patient-1` (Arlo Diagtest, male): Hb 118, ferritin 160, TSAT 14, CRP 28, MCV 84, eGFR 55 (5 Oct 2026); total hip replacement booked 3 Dec 2026 |
| `meld.py` | `forms` / `data` / `clean`, as in A5 |
| `verify.mjs` | fhirpath.js checks (uses `../A5-pathology/verify-lib.mjs`) |
| `playground.mjs` | Headless end-to-end run of the standalone form in the patched playground |
| `assemble-check.mjs` → `soln-A6-pam-assembled.json` | Assembles the whole PAM form (starter root + new root variables, starter modules, A5 and A6 solutions) with `@aehrc/sdc-assemble` |
| `playground-assembled.mjs` | Runs the assembled form in the playground for the test patient |
| `check-codes.py` | Validates every SNOMED CT / LOINC code in the A5 and A6 forms on Ontoserver |
| `playground-results/`, `screenshots/` | Captured responses / bundles / resources read back from Meld; screenshots `01`–`08` |

## How to try it

1. `python3 test_data.py && python3 meld.py data` (test data is not left on Meld).
2. https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND** → gear → source
   `https://gw.interop.community/QHConnectathon2026/open` (**?**, **SAVE URL…**) → patient
   **Arlo Diagtest** → **SAVE** → pick **soln-A6-standalone** → **BUILD FORM** → **POPULATE →
   Pre-populate**.
3. Findings: anaemia yes (mild), iron deficiency yes, inflammation yes; pathway *Anaemia with
   inflammation … anaemia of chronic disease*; suggested *Anaemia of chronic disease (234347009)*;
   due date 03/12/2026. Change ferritin to 40 and the suggestion becomes iron deficiency anaemia.
4. Confirm a diagnosis, fill *Blood products* and *Requested target haemoglobin*, then
   **EXTRACT → Template-based $extract** and **REVIEW WRITE BACK ITEMS → WRITE BACK**.
5. Whole form: pick **soln-A6-pam-assembled** instead (tab *Diagnosis*).
6. Afterwards: `python3 meld.py clean`.

Headless: `python3 meld.py forms && python3 meld.py data && node playground.mjs && node playground-assembled.mjs`, then `python3 meld.py clean`.
Rebuild the assembled form: `(cd ../../questionnaires && npm install) && node assemble-check.mjs`.

## Verified

* `node verify.mjs` → **all 66 checks passed** (also with `--live`): 19 rule cases (each pathway,
  both Hb boundaries per sex, ferritin 100 / 300 / 301, CRP 10, absolute vs functional iron
  deficiency, severe, missing ferritin / TSAT / Hb, unknown sex) for anaemia, iron deficiency,
  inflammation, severity, pathway and suggested code; pathway and suggestion texts; the current
  root threshold; **suggested = recorded diagnosis for 40/40 synthetic patients**; the mismatch
  warning; the Flag trigger (none for full consent / unanswered); target gap; the Condition (both
  copies), Flag (limited + religious, refused + personal, bare refusal, limited without products)
  and Goal templates (with and without due date / requester); pre-population; standalone = module;
  the playground's calculated answers equal fhirpath.js's; every FHIRPath expression evaluated
  (29 in the module, 49 in the standalone).
* `node playground.mjs`: findings and suggestion as expected; the what-if (ferritin 40 → IDA,
  back to 160 → ACD); the warning shows for IDA and hides for ACD; Ontoserver search finds
  *Iron deficiency anaemia due to blood loss*; extraction gives Condition 234347009, Condition
  724556004, Flag 708129006 (text as above), Goal ≥ 130 g/L due 2026-12-03; **WRITE BACK (4
  ENTRIES)** succeeded and the 2 Conditions, Flag and Goal were read back from Meld
  (`playground-results/meld-*.json`).
* `node assemble-check.mjs`: assembles with no duplicate variables (9 sections, 6 templates,
  34 variables); `node playground-assembled.mjs`: in the whole form, sex from *Patient details* and
  results from *Pathology* (A5) drive the A6 pathway and suggestion.
* `python3 check-codes.py`: 20/20 codes valid on Ontoserver (SNOMED CT-AU edition, LOINC); the two
  Flag codes, set by expression, were checked by hand (both active).

Not verified: the SMART-launched Smart Forms app; behaviour with real (non-synthetic) data.

## Decisions and known gaps (for the track leads)

* **Rules follow the FHIR mapping, which differs from the 0.1.0 module:** its iron-deficiency
  expression also required CRP > 10 for the TSAT branch; I left that out (mapping doc and PBM
  guidance). No difference on the synthetic data. Anaemia uses ≤ as in the mapping (WHO uses <).
  All thresholds still "to confirm with Metro North".
* ACD vs IDA in the 100–300 ferritin band is decided by CRP; with no CRP it's IDA.
* The suggestion is shown, not pre-selected: the nurse confirms. Pre-selecting a choice with a
  calculatedExpression wasn't tried.
* **Smart Forms extracts each contained template only once**: `pam-diagnosis` and
  `pam-diagnosis-other` sharing one template gave a single Condition, so the module has two
  identical templates (`PAMDiagnosisTemplate`, `PAMOtherDiagnosisTemplate`).
* **Flag vs Consent:** Flag (as in the mapping), category `safety`. SNOMED CT has no "limited
  consent to blood products" concept, so limited consent uses 699054003 (or 708129006 when
  religious) with the detail in `code.text`. A Consent resource could carry the per-product detail
  properly. Consent options, reasons and requester roles use placeholder local CodeSystems under
  `https://aehrc.github.io/qh-connectathon/track1/CodeSystem/` (as the synthetic data does).
* Product list (6 SNOMED CT-AU concepts) is my pick; albumin is the medicinal product concept
  789265003. 35240004 *Iron deficiency* is used (as in the data) although 234340006 *Iron deficiency
  without anaemia* is more specific.
* Goal: requester only as a note (`expressedBy` needs a person reference); no `addresses` link to
  the Condition; Condition has no `evidence` links to the Observations.
* Writing back twice creates duplicate Conditions / Flags / Goals (no identifiers or conditional
  updates); an existing Flag is not pre-populated or ended.
