# A7 Treatment + Ganzoni — full solution

**Status: verified** (fhirpath.js and the Smart Forms extraction library offline; prepopulation,
calculation, AMT value set, extraction and write-back in the patched Smart Forms playground
against Meld, 28 Oct 2026). Not checked: a SMART launch from Meld, and the assembled PAM form
in Smart Forms (assembly itself checked with `@aehrc/sdc-assemble`).

Extends the starter module [`questionnaires/modules/pam-treatment.json`](../../questionnaires/modules/pam-treatment.json)
(0.1.0). It keeps the 0.1.0 linkIds (`pam-ganzoni-intro`, `pam-ideal-weight`, `pam-dosing-weight`,
`pam-ganzoni`, `pam-iv-iron`, `pam-iron-product`, `pam-iron-dose`) and the template id
`PAMIVIronTemplate`.

## What it does

| Part | How |
|---|---|
| Pre-population: weight, height, sex, latest Hb | From the shared root variables (`weightKg`, `heightCm`, `sexCode`, `hb`), which read the Patient details (A1) and Pathology (A5) items. The module shows them read-only under *Inputs*, with a note if any is missing. The standalone form contains copies of those A1/A5 items with their x-fhir-query prepopulation |
| Ideal body weight | Devine: 50 kg (male) / 45.5 kg (female) + 0.9 kg per cm over 152.4 cm (2.3 kg per inch over 5 ft) |
| Dosing weight | Ideal body weight if the patient weighs more than that, otherwise actual weight; actual weight if there's no height. The form says which one it used |
| Target Hb, iron stores | 150 g/L and 500 mg; 130 g/L and 15 mg/kg below 35 kg (actual body weight) |
| Total iron deficit (Ganzoni) | dosing weight × (target Hb − actual Hb) × 0.24 + iron stores. When Hb is at or above target, the deficit is the iron stores alone (0.1.0 returned 0) |
| Suggested total dose | Deficit rounded to the nearest 100 mg; the nurse can prescribe a different dose (warning if it is above the rounded deficit) |
| Treatment plan | Multi-select: IV iron, oral iron, ESA, red cell transfusion (SNOMED CT-AU). The IV iron order and the infusion booking appear only when IV iron is ticked (`enableWhen`) |
| Product | `answerValueSet` = AMT (SNOMED CT-AU) ECL, expanded by Ontoserver: the 7 unbranded ferric carboxymaltose and ferric derisomaltose injection products |
| Infusion split | Per-infusion maximum by product: ferric carboxymaltose min(20 mg/kg, 1000 mg); ferric derisomaltose min(20 mg/kg, 1500 mg), with 20 mg/kg on the dosing weight. Number of infusions, and the dose of infusions 1–3 (each at least 7 days apart); a note if more than three are needed |
| Write-back: MedicationRequest | One per order (extracted when a product is chosen): AMT product, `dosageInstruction` per infusion (`sequence`, IV route, dose in mg; infusions 2 and 3 only if needed, via `templateExtractContext`), a note with the Ganzoni workings, `reasonCode` from the Diagnosis module's `pam-diagnosis` answer when the form has one, `requester` from `QuestionnaireResponse.author` |
| Write-back: ServiceRequest | The day-unit infusion booking (extracted when a requested date is entered): SNOMED 718520009 *Intravenous iron infusion*, `occurrenceDateTime` = first infusion, `quantityQuantity` = number of infusions, `priority`, notes, and `basedOn` → the MedicationRequest (same transaction, `urn:uuid` fullUrl from `extractAllocateId`; Meld resolves it to `MedicationRequest/<id>`) |

The ECL (SNOMED CT-AU 20260930 on Ontoserver, checked 28 Oct):

```
(< 763158003 : 762949000 = (430077004 OR 1172494003), 411116001 = << 129011000036109) MINUS (* : 774158006 = *)
```

i.e. medicinal products whose precise active ingredient is ferric carboxymaltose or ferric
derisomaltose, in an injection dose form, without a brand name. Both codes used by the synthetic
data (`1312141000168105`, `1086251000168104`) are in it. Iron sucrose and iron polymaltose are left
out on purpose: their per-dose rules (small repeated doses; total dose infusion) differ, so the
split calculation would be wrong for them. Adding them means adding their rules too.

## Sources for the dose rules

* National Blood Authority, *Iron product choice and dose calculation for adults* (2016; ©2015,
  CC BY 3.0 AU): Ganzoni formula with 0.24 (= 0.0034 × 0.07 × 1000) and Hb in g/L; *"use ideal
  body weight in overweight patients; if underweight, use actual body weight"*; iron depot 500 mg
  at ≥ 35 kg, 15 mg/kg below; worked example 70 kg, Hb 80 → 1676 mg ≈ 1700 mg with target
  150 g/L; the deficit is not the per-infusion dose; ferric carboxymaltose max 1000 mg (20 mg/kg)
  per administration and per week.
  https://blood.gov.au/sites/default/files/documents/iron-product-choice-and-dose-calculation-adults-20052016.docx
* Monofer (ferric derisomaltose) Australian PI, revised 27 Feb 2024: Ganzoni with default target
  Hb 150 g/L, 500 mg stores above 35 kg, ideal body weight for obese patients; single infusion up
  to 20 mg/kg, split in two at least a week apart above that, single doses above 1500 mg not
  recommended. https://medsinfo.com.au/api/documents/Monofer_PI?format=pdf
* Ferinject (ferric carboxymaltose) Australian PI (AusPAR attachment 2019, and current generic PIs
  e.g. Ferrive): single dose ≤ 20 mg/kg and ≤ 1000 mg; no more than 1000 mg a week.
  https://www.tga.gov.au/sites/default/files/auspar-ferric-carboxymaltose-191001-pi.pdf
* Venofer (iron sucrose) SmPC: the 35 kg split (target 13 g/dL and stores 15 mg/kg below 35 kg;
  15 g/dL and 500 mg at or above). https://www.medicines.org.uk/emc/product/5911/smpc
* Ganzoni AM. Intravenous iron-dextran: therapeutic and experimental possibilities. Schweiz Med
  Wochenschr 1970;100:301–3 (PMID 5413918).
* Devine BJ. Gentamicin therapy. Drug Intell Clin Pharm 1974;8:650–5 (ideal body weight).

## Decisions for the track leads to check

1. **Dosing weight rule.** Kept the starter's rule (lower of actual and Devine ideal body weight),
   which matches the webinar slide and the NBA wording if "overweight" means "above ideal". Read
   strictly, the NBA and Monofer PI use ideal weight only for *overweight/obese* patients (and
   the Monofer PI suggests IBW = 25 × height²), so a normal-BMI patient a few kg over Devine IBW
   would get a slightly higher dose. Still to confirm against the REDCap specification.
2. **Proposed root changes** (`questionnaires/build.py`, `SHARED_VARIABLES`). The module works with
   the 0.1.0 root, but the standalone form uses these corrected definitions:
   * `weight`: `iif(%idealWeight.exists() and %idealWeight < %weightKg, %idealWeight, %weightKg)`.
     0.1.0 gives no dosing weight (so no dose) when height is missing.
   * `targetHb`: `iif(%weightKg < 35, 130, 150)`, and `ironStores`: `iif(%weightKg < 35, 15 * %weight, 500)`.
     0.1.0 tests the 35 kg threshold on the *dosing* weight. Ganzoni's threshold is body weight,
     so a short adult (IBW < 35 kg) got the paediatric target.
   * New root extension `sdc-questionnaire-extractAllocateId` = `ivIronOrderId`. `$assemble`
     drops module-level extensions other than variables and launch contexts, so it must be on the
     root. Without it extraction still works, but the ServiceRequest has no `basedOn` (the
     extraction library logs an "undefined environment variable" error and carries on: checked).
3. **Ganzoni bug fixed in the module:** 0.1.0 returned 0 mg when Hb ≥ target Hb, but the iron
   stores still need replacing (the synthetic "iron deficiency without anaemia" patients).
4. **MedicationRequest shape:** one dosageInstruction per infusion, so `dosageInstruction[0]` holds
   the *first infusion*, not the total. The synthetic data has the total in `dosageInstruction[0]`.
   Apps that read the total dose (B1, B5) should sum `dosageInstruction.doseAndRate.doseQuantity`,
   or read the note. Status `active`; the synthetic data uses `completed` for given courses.
5. **ServiceRequest, not Appointment**, for the infusion: the nurse requests a booking. The day unit
   books the slot (Appointment `basedOn` this ServiceRequest). The performer (day unit) isn't
   recorded, because the data has no day-unit Organization.
6. The treatment plan (oral iron, ESA, transfusion) isn't written back. Only the IV iron order is,
   as the scenario asks.

## Try it

The test data is **not** left on Meld: it would show up in the population apps and the dashboard.
Load the test patient (synthetic: *Iris Ganzonitest*, female, 160 cm, 82 kg, Hb 98 g/L):

```sh
curl -X POST -H 'Content-Type: application/fhir+json' --data @test-data.json https://gw.interop.community/QHConnectathon2026/open
```

Then in the playground, https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**
(set the Meld open endpoint and the patient as in the presenter guide §4), pick
**soln-A7-standalone**, **BUILD FORM**, **POPULATE → Pre-populate**. You'll see IBW 52.3 kg, dosing
weight 52.3 kg, deficit 1153 mg, suggested 1200 mg. Tick *Intravenous iron infusion*, choose
*Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial* (1000 mg per infusion, 2 infusions:
1000 + 200), enter a date, then **EXTRACT → Template-based $extract**.

On Meld (open endpoint):
* Module: `Questionnaire/soln-pam-treatment`, canonical
  `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-treatment|0.2.0`
* Standalone: `Questionnaire/soln-A7-standalone`, canonical `…/solutions/Questionnaire/A7-standalone|0.2.0`

Delete the test data afterwards (and anything written back for the patient):

```sh
B=https://gw.interop.community/QHConnectathon2026/open
for r in Observation/soln-A7-patient-1-height Observation/soln-A7-patient-1-weight Observation/soln-A7-patient-1-hb Observation/soln-A7-patient-1-ferritin Patient/soln-A7-patient-1; do curl -X DELETE "$B/$r"; done
```

(Delete written-back MedicationRequests and ServiceRequests first: `MedicationRequest?subject=Patient/soln-A7-patient-1`.)

## Verification

| Check | How | Result |
|---|---|---|
| Every FHIRPath expression and x-fhir-query (66 in the standalone form, 48 in the module) | `node verify.mjs`: fhirpath.js 5.2.2 (R4 model), a small form simulator (`sdc-sim.mjs`: root variables, calculatedExpressions iterated to a fixed point, enableWhen / enableWhenExpression) | ALL PASS |
| Ganzoni and split | 8 cases checked against an independent JS implementation: overweight (IBW), below IBW, Hb above target, no height, < 35 kg, manual override with 3 and with 4 infusions, derisomaltose 1500 mg cap | ALL PASS |
| Prepopulation | x-fhir-queries run against Meld for `soln-A7-patient-1`, initialExpressions evaluated | PASS |
| Extraction | `@aehrc/sdc-template-extract` 1.0.16 (the version in the playground): MedicationRequest + ServiceRequest, 1/2/3 dosage entries, `basedOn` = MedicationRequest fullUrl, nothing extracted without product and date, booking without order has no `basedOn` | ALL PASS |
| Assembly | `@aehrc/sdc-assemble` with the 0.1.0 root and the other starter modules (this module replacing pam-treatment) | assembles; templates `PAMIVIronTemplate`, `PAMInfusionTemplate` carried over |
| Playground | `node playground.mjs [--write-back]` (headless Chromium, patched Smart Forms 1.5.0): prepopulation, calculations, AMT value set (7 options from Ontoserver), split, extraction; write-back to Meld | ALL PASS; Meld stored MedicationRequest + ServiceRequest with `basedOn` resolved to `MedicationRequest/763` (both since deleted) |

Screenshots: `screenshots/01-prepopulated-ganzoni.png`, `02-order-and-booking.png`,
`03-extracted-bundle.png`, `04-write-back.png`.

Running the checks (from this folder):

```sh
npm install --no-save @aehrc/sdc-template-extract@1.0.16   # optional: extraction checks (don't commit node_modules)
node verify.mjs                                             # fhirpath from ../../decks/node_modules
node playground.mjs                                         # needs the test patient on Meld
```

## Known gaps

* Smart Forms keeps answers of disabled items in the response. If the nurse picks a product and
  then unticks IV iron, the order is still extracted. Clear the product first.
* The infusion schedule beyond three infusions is left to the nurse; dates of the later infusions
  aren't calculated (only "at least 7 days apart").
* Target Hb can't be changed per patient (e.g. a lower target in pregnancy). That would need a
  target Hb override item, or the A6 Goal.
* `requester` is only filled when the QuestionnaireResponse has an `author` (a SMART launch with
  a practitioner user). The playground has none.
* Not tested: launching the module from Meld's launcher, and the assembled form in Smart Forms.
