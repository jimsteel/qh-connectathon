# B1 Patient summary for the blood management nurse

**Status: partly verified.** No-login mode was tested headless against the Meld open endpoint for 5
patients, and its numbers match direct FHIR queries. The EHR launch from Meld is untested because it
needs a client ID, which only the user can register.

A patient app (plain HTML/JS, fhirclient.js 2.6.3, Plotly; no build step) for the launch patient. It shows:

* **Hb and ferritin trend charts** with the sex-specific anaemia threshold (Hb < 130 g/L male,
  < 120 g/L female) and the iron deficiency line (ferritin < 100 µg/L). Dotted lines mark the IV iron
  order dates and the surgery date.
* **Pathway classification** at referral (each test's earliest result) and now (each test's latest),
  with the anaemia, iron deficiency and inflammation flags behind it.
* **Days to surgery**, plus the procedure, unit, category and surgeon from the waitlist entry.
* **Days with the blood management team** and episode status (being managed or cleared), plus the
  nurse.
* **Treatments ordered** (IV iron MedicationRequests: product, dose, date, status, prescriber).
* A pathology table (Hb, ferritin, TSAT, CRP, earliest and latest, flagged values in red), the
  recorded diagnosis, the referral source and open follow-up Tasks.
* The FHIR queries behind the page, under a `<details>` element.

Files: `index.html`, `app.js` (FHIR reads and rendering), `logic.js` (decision rules, no DOM, so
`verify.mjs` can test it in Node), `config.js` (client ID and scope), `verify.mjs`, `screenshot-*.png`.
It is based on `apps/smart-starter`, including the fix that makes a new Meld launch code start a fresh
login.

## Try it

No login needed. Serve the folder (or deploy it to GitHub Pages as is) and add the open endpoint and
a patient:

```sh
cd T/solutions && python3 -m http.server 8000
```

* `http://localhost:8000/B1-patient-summary/?fhirServiceUrl=https://gw.interop.community/QHConnectathon2026/open&patientId=pam-034`
* Other good patients:
  * `pam-demo`: Hb only, no surgery or episode
  * `pam-012`: treated, with post-treatment results
  * `pam-008`: anaemia of chronic disease
  * `pam-004`: not anaemic, cleared
  * `pam-032`…`pam-040`: being managed
* Optional `&today=2026-10-28` fixes "today" so that days to surgery and days with the team are
  reproducible.

If the folder is published alongside the other apps (e.g. as `/qh-connectathon/solutions/B1-patient-summary/`),
use the same query string on that URL.

## Meld registration (EHR launch)

* Launch URI: `<site>/B1-patient-summary/` (the page itself: `FHIR.oauth2.init` handles both the
  launch and the redirect, as in the starter)
* Redirect URI: `<site>/B1-patient-summary/` (trailing `/` included)
* Scopes: `launch openid fhirUser patient/*.read` (SMART v1)
* Put the client ID in `config.js`, then launch from Meld **with a patient selected**.

## How each figure comes from FHIR

All searches are scoped to the launch patient (`client.patient.id`), with `|` sent as `%7C`.

| Figure | FHIR |
|---|---|
| Name, sex, age | `Patient/{id}`: `gender` picks the Hb threshold; age is from `birthDate` |
| Hb, ferritin, TSAT, CRP | `Observation?patient={id}&code=http://loinc.org\|718-7,…\|2276-4,…\|14801-5,…\|2502-3,…\|1988-5` (TSAT: 14801-5, and 2502-3 for older data), using `valueQuantity.value` and the date from `effectiveDateTime`; results that are `entered-in-error` or `cancelled` are skipped |
| Pathway | From each test's latest value ("latest") and earliest value ("at referral"), with the rules in `FHIR-Mapping-DRAFT.md`. **Anaemia:** Hb < 130 (M) / 120 (F) g/L. **Iron deficiency:** ferritin < 100 µg/L, or TSAT < 20% with ferritin 100–300 µg/L. **Inflammation:** CRP > 10 mg/L. Combined: iron deficiency anaemia → iron replacement; iron deficiency without anaemia → consider iron; anaemia without iron deficiency → anaemia of chronic disease if inflamed, else investigate other causes; neither → can be cleared. Missing inputs are named ("needs TSAT…") rather than guessed |
| Days to surgery | `ServiceRequest?patient={id}&_include=ServiceRequest:performer&_include=ServiceRequest:requester`. The waitlist entry is the ServiceRequest with a `…/CodeSystem/elective-category` category. The next `occurrenceDateTime` on or after today, else the latest one; days = that date − today. Unit = `performer` Organization, surgeon = `requester` |
| Referral source | The ServiceRequest with a `…/CodeSystem/referral-source` category: its display |
| Days with the team | `EpisodeOfCare?patient={id}` (newest by `period.start`): `period.end` (or today, if still active) − `period.start`. Status `active` = being managed, `finished` = cleared. Nurse = `careManager` |
| Treatments | `MedicationRequest?patient={id}`, without `entered-in-error` or `cancelled`: `medicationCodeableConcept`, `dosageInstruction[0].doseAndRate[0].doseQuantity` (or the dosage text), `authoredOn`, `status`, `requester` |
| Diagnosis | `Condition?patient={id}`: `code` |
| Follow-ups | `Task?patient={id}` that aren't completed, cancelled, rejected or failed: `code`, due date `restriction.period.end` (as in the synthetic data) or `executionPeriod.end` |

## Verified

`cd T/decks && node ../solutions/B1-patient-summary/verify.mjs`: **37 checks pass**.

* 12 unit tests of the decision rules:
  * the sex-specific thresholds, with a value exactly at the threshold
  * the ferritin 100–300 / TSAT rule, including no TSAT
  * the anaemia of chronic disease and "other causes" branches
  * missing sex
  * the day arithmetic
* The app runs headless (Playwright, no-login mode, `today=2026-10-28`) for `pam-demo`, `pam-034`,
  `pam-012`, `pam-008` and `pam-004`. For each one:
  * no page errors
  * the pathway, days to surgery, treatment count and days with the team equal the values worked out
    from separate, unfiltered FHIR queries (`Observation?patient=`, `ServiceRequest?patient=`,
    `MedicationRequest?patient=`, `EpisodeOfCare?patient=`)
* Screenshots: `screenshot-pam-demo.png`, `screenshot-pam-034.png`, `screenshot-pam-012.png`,
  `screenshot-pam-008.png`, `screenshot-pam-004.png`.

Nothing was written to Meld.

## Not verified

* **EHR launch from Meld.** It needs a client ID.
* Whether Meld returns the `_include`d Practitioner and Organization resources under
  `patient/*.read`. They sit outside the patient compartment. If they're missing, the app falls back
  to the reference's `display`, then its id.

## Decisions and known gaps (for the track leads)

* **Threshold: strictly below.** The mapping says "Hb below the threshold (≤130 / ≤120)", which is
  ambiguous. The app uses `<`, which matches WHO and the generator. Missing sex means no Hb
  classification; no threshold is assumed.
* **The rules disagree with some synthetic diagnoses.** `pam-008` has a recorded diagnosis of anaemia
  of chronic disease (generator profile "acd"), but ferritin 150 with TSAT 17 meets the draft
  iron-deficiency rule (TSAT < 20 with ferritin 100–300), so the app classifies it as iron deficiency
  anaemia. Either the rule or the generator needs adjusting. The app shows the recorded diagnosis
  next to the calculated pathway.
* **"At referral" vs "latest"** use each test's earliest and newest results, as the dashboard does.
  The classification is not anchored to the IV iron date. After treatment it can therefore read, for
  example, "anaemia without iron deficiency: investigate other causes" (`pam-012`: Hb 119 g/L after
  iron, ferritin 256 µg/L).
* **"Treatments given"** are MedicationRequests, i.e. orders. The data has no MedicationAdministration,
  so the tile is labelled "Treatments ordered". `pam-034` has three extra write-back test orders from
  other people (`MedicationRequest/3`, `/5`, `/7`), and they show up.
* **Shared data.** `pam-demo`'s latest Hb (98 g/L) and ferritin (14 µg/L) are write-back results from
  someone else (`Observation/71`, `/72`). After a demo reset the values will differ. `pam-034` also
  has two uncoded write-back Conditions, shown as "(no code)".
* **Today** is the browser's local date (override it with `?today=`). The synthetic data was
  generated with "today" = 6 Oct 2026, so surgeries for finished patients are in the past ("N days ago").
