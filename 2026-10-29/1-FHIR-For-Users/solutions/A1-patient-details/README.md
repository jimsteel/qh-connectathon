**Status: verified** (FHIRPath with fhirpath.js; pre-population, extraction and write-back run headless in the patched Smart Forms playground against Meld, 28 Oct 2026)

# A1 Patient details: reference solution

Extends the starter module [`questionnaires/modules/pam-patient-details.json`](../../questionnaires/modules/pam-patient-details.json)
(same group `pam-patient`, same linkIds for the items it had, same `obsHeight` / `obsWeight`
queries) to cover the whole scenario row:

| | What the module does |
|---|---|
| Pre-population | Name, date of birth, sex, Medicare number (as before); **Indigenous status** (AU Base extension `http://hl7.org.au/fhir/StructureDefinition/indigenous-status`); **interpreter required** (`patient-interpreterRequired`); **preferred language** (`Patient.communication`, preferred first); **phone** (mobile first); **address** (home first: street lines joined, suburb, state, postcode); **next of kin** (`Patient.contact`, next-of-kin first); latest height and weight Observations, plus a read-only "Latest on record: 162 cm (2026-09-15), 68.4 kg (2026-09-15)" |
| Answer bindings | Indigenous status: `answerValueSet` `https://healthterminologies.gov.au/fhir/ValueSet/australian-indigenous-status-1`; language: `…/common-languages-australia-2` (autocomplete); state: `…/australian-states-territories-2`; sex: `answerOption` (administrative-gender). All expanded from Ontoserver. |
| Calculations | Age, BMI (unchanged; they use the root form's `dob`, `heightCm`, `weightKg`) |
| Write-back | `templateExtract` on `pam-height` and on `pam-weight`, each with a contained Observation template: status final, category vital-signs, LOINC 8302-2 Body height / 29463-7 Body weight, UCUM cm / kg, subject from the response, `effectiveDateTime` = the new item **"Height and weight measured on"** (`pam-hw-date`, defaults to today) |

Files:

| File | |
|---|---|
| `pam-patient-details.json` | The module: id `soln-pam-patient-details`, url `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-patient-details`, version `0.2.0` |
| `A1-standalone.json` | Standalone test form `soln-A1-standalone` (`…/solutions/Questionnaire/A1-standalone`): the module plus the root variables `dob`, `heightCm`, `weightKg` copied from `pam-root.json` |
| `build.py` | Generates both forms and `testdata-bundle.json` (all expressions are defined once here) |
| `testdata-bundle.json` | Transaction bundle (PUT): `Patient/soln-A1-patient-1` "Anna Testdetails" with every field the form reads, and two height + weight Observations (Mar and Sep 2026) |
| `load.sh` / `cleanup.sh` | Load test data + Questionnaires to the Meld open endpoint / delete the test data again |
| `verify.mjs` | Every FHIRPath expression in the module, evaluated with fhirpath.js (R4), PASS/FAIL; output in `verify-output.txt` |
| `playground.mjs`, `playground-lib.mjs` | Headless Playwright run of the playground (below); output in `playground-output.txt`, screenshots in `screenshots/`, the pre-populated response and extracted bundle in `playground-*.json` |

## Try it

```sh
./load.sh                 # test patient + Observations + the two Questionnaires (PUT, soln-A1- ids)
# ... try it ...
./cleanup.sh              # remove the test patient and Observations again (the Questionnaires stay)
```

1. https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**; gear → source FHIR server
   `https://gw.interop.community/QHConnectathon2026/open` (validate, save) → patient **Anna Testdetails** → SAVE.
2. Pick **soln-A1-standalone** → BUILD FORM → **POPULATE → Pre-populate**.
3. Change the weight (e.g. 66.2) → **EXTRACT → Template-based $extract (modified only)** → ADVANCED PROPS → EXTRACT:
   one `POST Observation` (29463-7, 66.2 kg, today). **REVIEW WRITE BACK ITEMS** → WRITE BACK.
4. Pre-populate again: the weight is 66.2. Delete the new Observation afterwards (it has a server-assigned id;
   `Observation?patient=soln-A1-patient-1&code=29463-7`), then `./cleanup.sh`.

In the full PAM form, replace the root's `pam-patient-details|0.1.0` subQuestionnaire canonical with
`https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-patient-details|0.2.0`.
**No new shared (root) variables are needed.**

## What was verified, and how

* `node verify.mjs` → ALL PASS (51 checks): every `initialExpression` against the test patient and against a
  sparse patient shaped like the synthetic `pam-*` patients (no Indigenous status, interpreter, language, phone,
  next of kin, Observations: all give empty, nothing errors); age and BMI with root variables; the three root
  variables over the playground's real response; every `templateExtractValue` with the QR item as context; a
  coverage check that all 27 FHIRPath expressions in the module were evaluated.
* `node playground.mjs` (test data loaded) → ALL PASS (27 checks), in the patched playground:
  pre-population of all 21 items (screenshot `01-prepopulated.png`); **an unchanged form extracts nothing**
  with "modified only"; after changing the weight, "modified only" gives exactly one Observation with the expected
  content (`02-extracted-modified-only.png`, `playground-extracted-bundle.json`), the full extraction gives both;
  write-back succeeds (`03-write-back-dialog.png`), the Observation is on Meld, and pre-populating again shows the new
  weight. The script deletes the Observation it wrote.

Not verified: the module inside the assembled PAM form (`$assemble`), and an EHR launch from Meld (the
playground's patient picker sets `%patient`; the app's "save as final" uses the same modified-only extraction).

## Decisions and known gaps (for the track leads)

* **Write height/weight only when changed.** The prepopulated values would otherwise be written back as new
  Observations every time. Smart Forms' launched app always extracts "modified only" (compared with a fresh
  pre-population), so only a changed value produces an Observation. In the playground, use the *modified only*
  menu entry; the plain template extract writes both.
* **Effective date** comes from the new "measured on" date item (default today), not from the old Observation.
  Changing only the date writes nothing (the comparison only sees value changes, see next point).
* **Smart Forms quirk found here:** in a modified-only extraction the comparison re-runs the templates over the
  pre-populated response, but `%resource` still means the *current* response. So template values must be relative
  to the item carrying `templateExtract` (here `answer.value`), or the change is filtered out. A2's README has the
  details; it bit A2 harder.
* Patient demographics (Indigenous status, interpreter, language, address, next of kin) are **pre-populated
  only**: the scenario asks for write-back of height and weight only. Updating the Patient would use A2's FHIRPath
  Patch pattern.
* Next of kin is read from `Patient.contact` (`relationship` v2-0131 `N` first, relationship text shown); the
  starter's to-do box mentioned RelatedPerson, which the synthetic data doesn't have.
* The starter module's 🚧 to-do box is removed in the solution.

## Left on Meld

`Questionnaire/soln-pam-patient-details`, `Questionnaire/soln-A1-standalone`. Test data was deleted
(`./cleanup.sh`); `./load.sh` recreates it.
