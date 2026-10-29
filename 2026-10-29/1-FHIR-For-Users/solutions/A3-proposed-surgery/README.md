Status: **verified** (FHIRPath with fhirpath.js; pre-population, extraction and write-back in the patched Smart Forms playground on 28 Oct 2026; the module inside the assembled root form was not tested)

# A3 Proposed surgery / referral: full solution

This extends the starter module `questionnaires/modules/pam-proposed-surgery.json`. It keeps the same top-level group
`pam-surgery` and the hidden `pam-proposed-surgery-module` item, and replaces the 🚧 scaffolding.

| File | What |
|---|---|
| `build.py` | Generates the two Questionnaires and `test-data.json`. `python3 build.py` |
| `soln-pam-proposed-surgery.json` | The module. Id `soln-pam-proposed-surgery`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-proposed-surgery`, version `0.2.0`, `assemble-child` |
| `soln-A3-standalone.json` | Standalone test form. Id `soln-A3-standalone`, canonical `…/solutions/Questionnaire/A3-standalone`. It is the module plus the root variable it needs |
| `test-data.json` | Transaction Bundle (PUT) with test patient `soln-A3-patient-1` (*Avery Solnthree*), an active waitlist entry and an old completed one |
| `load.sh` / `cleanup.sh` | PUT the test data and both Questionnaires to Meld / delete the test patient and everything that refers to it |
| `verify.mjs`, `verify-output.txt` | FHIRPath checks (47, all PASS) |
| `playground.mjs`, `screenshots/` | Headless Playwright run of the playground |
| `extracted-bundle.json`, `written-back-resource.json` | Output of the last playground run |

## What it does

* **Pre-population.** One x-fhir-query on the group, `waitlist`:
  `ServiceRequest?patient={{%patient.id}}&category=<elective-category system>|&status=active&_sort=occurrence&_include=ServiceRequest:requester&_include=ServiceRequest:performer`.
  The waitlist entry is the ServiceRequest that has an elective category. The same Bundle includes the
  surgeon (Practitioner) and the unit (Organization). It fills these items:
  * Procedure (SNOMED CT-AU coding)
  * Surgeon (`Dr Alan Pierce`)
  * Surgical unit
  * Category (radio buttons; options use the synthetic data's local elective-category codes 1/2/3)
  * Booked date
  * Hidden references to the waitlist entry, surgeon and unit, which write-back uses
  
  A second query, `bmsReferral`, finds an earlier referral to blood management (SNOMED `3457005`). Its date is shown read-only.
* **Procedure binding.** `answerValueSet` is an ECL implicit value set on SNOMED CT-AU,
  `http://snomed.info/sct/32506021000036107?fhir_vs=ecl/<< 387713003` (surgical procedures), shown as autocomplete
  and expanded by Ontoserver.
* **Days until surgery.** This is a calculatedExpression. FHIRPath R4 and fhirpath.js have no date difference (`-` between dates and
  `difference()` both fail), so the expression turns each `YYYY-MM-DD` string into a day number
  (days-from-civil arithmetic) and subtracts: `daynum(%surgeryDate) - daynum(today())`. `verify.mjs` checks it
  against JavaScript date arithmetic, including leap years and century years. Below 28 days a warning shows
  (enableWhen on the calculated item).
* **Write-back.** The question "Refer the patient to the blood management service now?" (yes) enables a group whose
  `templateExtract` creates a **ServiceRequest**:
  * `status` active, `intent` order, `code` SNOMED 3457005 *Patient referral*
  * `category` is the referral source (the synthetic data's local referral-source codes)
  * `priority` is `urgent` when surgery is less than 28 days away, otherwise `routine`
  * `subject`; `authoredOn` is the referral date (defaults to today)
  * `requester` is the surgeon from the waitlist entry
  * `performer` is `Organization/pam-blood-management`
  * `reasonCode` (SNOMED: anaemia / iron deficiency anaemia / iron deficiency / anaemia of chronic disease)
  * `supportingInfo` is the waitlist entry; `note` holds the notes
  
  This has the same shape as the synthetic referrals in `data/generate.py`, so the population apps count it.

### New shared root variable (needed in `pam-root.json`)

| Name | Expression |
|---|---|
| `surgeryDate` | `%resource.repeat(item).where(linkId='pam-surgery-date').answer.value` |

The module's days calculation reads `%surgeryDate`. As with the other shared variables, it sits on the root
because Smart Forms evaluates questionnaire-level variables reliably. The standalone form carries it.

## How to try it

1. Recreate the test data (it was deleted from Meld after testing): `./load.sh`
2. Open https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**.
3. Settings (gear icon):
   * Source FHIR server `https://gw.interop.community/QHConnectathon2026/open`. Validate with **?**, then click **SAVE URL…**.
   * Patient **Avery Solnthree** (`soln-A3-patient-1`) → **SAVE**.
4. Pick **soln-A3-standalone** → **BUILD FORM** → **POPULATE → Pre-populate**. You should see:
   * Total hip replacement, Dr Alan Pierce, Orthopaedics (synthetic), Category 2, 18/11/2026
   * Days until surgery (21 on 28 Oct) and the "< 4 weeks" warning
5. Answer **Yes** to the referral question, then pick a source and a reason. Then **EXTRACT → Template-based $extract** and
   **REVIEW WRITE BACK ITEMS → WRITE BACK**.
6. Afterwards: `./cleanup.sh` (deletes the test patient, its data and the written-back referral).

Automated: `./load.sh && node verify.mjs && node playground.mjs && ./cleanup.sh`. The scripts resolve `fhirpath` and
`playwright` from `../../decks/node_modules`.

## What was verified and how

* `verify.mjs` (47 checks, all PASS, `verify-output.txt`):
  * Both queries run against Meld for the test patient.
  * Every initialExpression is checked against the real Bundle, and also against `pam-001`'s real data (read-only).
  * The days calculation is checked on 13 dates and date pairs.
  * The root variable and every `templateExtractValue` are checked against a sample QuestionnaireResponse, including priority urgent vs routine.
  * A coverage check confirms that every expression in the module was evaluated.
  * The ECL value set expands on Ontoserver (SNOMED CT-AU 20260930) and contains both the test patient's procedure and `pam-001`'s.
* Playground (`playground.mjs`, screenshots `01`–`07`):
  * Pre-populated values were as above, with 21 days and the warning shown.
  * Extraction produced one `POST ServiceRequest` (`extracted-bundle.json`). Every field was as specified.
  * Write-back returned "successful".
  * The resource read back from Meld matched (`written-back-resource.json`).
  * Pre-populating again showed the new referral's date as "Previous referral" (closing the loop).
  * The written-back resource was then deleted.

## Not verified / known gaps

* The module was not run inside the assembled PAM root form, because the root does not yet have `surgeryDate`.
  The standalone form has the identical item tree; `verify.mjs` checks that it is identical.
* Requester = the surgeon on the waitlist entry, as in the synthetic data, even when the referral source is
  e.g. the GP. **Track leads:** decide whether the referral source should become `requester` (FHIR-Mapping open question).
* **Decisions to check:**
  * The 28-day threshold for "urgent" and for the warning.
  * The waitlist entry is identified by having an elective-category coding.
  * When there are several active entries, the soonest booked surgery is used.
* ECL terms (`|Surgical procedure|`) are left out of the answerValueSet URL. Smart Forms passes the URL to
  `$expand?url=` without encoding it, and Ontoserver then reads a `|` as the canonical|version separator
  ("Invalid version format for SNOMED"). This was found and fixed while testing A4's autocompletes.
* `playground.mjs` writes to the open endpoint (one ServiceRequest) and deletes it again.

## AU Core 2.0.0 (29 Oct 2026)

Referral ServiceRequest → AU Base ServiceRequest (no AU Core profile): **0 errors**, no change. Warning: the local `referral-source` CodeSystem isn't published, so the validator can't check it.

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
