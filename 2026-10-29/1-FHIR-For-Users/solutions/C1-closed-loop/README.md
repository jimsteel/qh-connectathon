# C1 Closed loop: A6 + A7 in Smart Forms → write-back → B4 and B6 update

**Status: verified** (automated end-to-end run, 28 Oct 2026: patched Smart Forms playground, write-back to
Meld, B4 and B6 in no-login mode before and after, all test data deleted afterwards. `node demo.mjs` →
ALL PASS.) Not tried: Smart Forms or the apps launched from Meld (SMART launch).

The loop: a test patient who has been referred to blood management but not yet diagnosed or treated →
the nurse fills in **A6 Diagnosis** (confirms iron deficiency anaemia, target Hb) and **A7 Treatment**
(Ganzoni, IV iron order, infusion booking) in Smart Forms and writes the extracted resources back →
**B4 Referrals** moves the referral from "No anaemia diagnosis" to "Iron deficiency anaemia" and **B6
Outcomes** moves the patient into "Given IV iron", anchored on the new order → after the post-treatment
bloods, B6 pairs initial and post Hb / ferritin.

Built only from the completed solutions (nothing in their folders was changed):
[A6](../A6-diagnosis/), [A7](../A7-treatment/), [B4](../B4-referrals/), [B6](../B6-outcomes/),
and [A5](../A5-pathology/)'s playground helper library.

## Files

| File | Purpose |
|---|---|
| `test_data.py` → `testdata-baseline.json`, `testdata-recheck.json` | Test data as transaction Bundles (PUT, ids `soln-C1-…`) |
| `meld.py` | `load baseline` / `load recheck` / `list` / `clean` / `check` on the Meld open endpoint |
| `demo.mjs` | The automated demo (all stages, checks, clean-up) |
| `apps-lib.mjs`, `snapshot.mjs` | Open B4 and B6 headless (serves `../B4-referrals`, `../B6-outcomes` unchanged), read their numbers, screenshot. `node snapshot.mjs <label>` for a single snapshot |
| `results/` | Numbers per stage (`0-empty.json` … `3-recheck.json`), the A6 / A7 responses and extract bundles, `written-back.json` (resources as stored on Meld) |
| `screenshots/` | `A6-*`, `A7-*` (playground), `<stage>-B4.png`, `<stage>-B6.png`, `<stage>-B6-patient.png` (B6 per-patient table, other rows hidden) |

## Test patient

**Clara Loopdemo** (`Patient/soln-C1-patient-1`), female, 165 cm, 68 kg, shaped like a `data/generate.py`
patient (iron deficiency anaemia profile):

| Resource | Content | Date |
|---|---|---|
| ServiceRequest `soln-C1-p1-surgery` | Waitlist entry: total knee replacement, `category` elective-category **2** | authored 2026-09-15, surgery 2026-12-10 |
| Observation ×8 | Height 165, weight 68; **Hb 98**, **ferritin 18**, TSAT 9, CRP 4, MCV 76, eGFR 85 | 2026-10-09 |
| ServiceRequest `soln-C1-p1-referral` | SNOMED 3457005 *Patient referral*, referral source pre-admission, `supportingInfo` → waitlist entry | **2026-10-14** (FY 2026–27 Q2) |
| EpisodeOfCare `soln-C1-p1-episode` | type `episode-type#pam`, active, `referralRequest` → referral | from 2026-10-14 |
| *testdata-recheck.json*: Observation ×4 | **Hb 121**, **ferritin 385**, TSAT 27, CRP 3 | **2026-11-25** (future-dated, see below) |

No Condition or MedicationRequest: those come from the forms. No references to shared `pam-*` resources
(requester / performer / managing organisation are `display` only).

**Why the recheck is future-dated and loaded separately:** A7 writes the IV iron order with
`authoredOn = now()`, and B6 counts a result as post-treatment only if it is *after* that date. Post-treatment
bloods dated before the demo would be classed as *initial*. So the demo "fast-forwards" by loading results
dated 25 Nov 2026 after the forms. (The demo works while the run date is before 25 Nov 2026; after that,
change `RECHECK` in `test_data.py`.)

## Automated run

From this folder (playwright resolves from `../../decks/node_modules`):

```sh
python3 test_data.py      # regenerate the bundles (already in the folder)
node demo.mjs             # ~3 min; cleans up at the end. --keep leaves everything on Meld
```

It needs `soln-A6-standalone` and `soln-A7-standalone` on Meld (they are; reload with
`python3 ../A6-diagnosis/meld.py forms` / A7's README if not).

## Results (run of 28 Oct 2026, Meld open endpoint)

Test patient as the apps see it (`results/*.json`; B4 row = the app's own per-referral record, B6 row = its
per-patient row):

| Stage | B4: the test referral | B6: the test patient |
|---|---|---|
| 0 empty | — | — |
| 1 baseline loaded | 2026–27 Q2, category 2, diagnosis **none** ("No anaemia diagnosis") | group **Not given IV iron**, anchor 2026-10-14 (referral); Hb 98 initial, no post |
| 2 after A6 + A7 write-back | diagnosis **87522002 Iron deficiency anaemia** (the A6 Condition) | group **Given IV iron**, anchor **2026-10-28 (the A7 order)**; Hb 98 / ferritin 18 initial, no post yet |
| 3 after recheck | (unchanged) | Hb 98 → **121 (+23)**, ferritin 18 → **385 (+367)** |

Aggregates (other agents were writing test data to Meld at the same time, so read these as "what moved"):

| Figure | 1 baseline | 2 after forms | 3 after recheck |
|---|---|---|---|
| B4 2026–27 Q2 referrals | 3 | 3 | 3 |
| B4 2026–27 Q2 "Iron deficiency anaemia" | 1 | **2** | 2 |
| B4 2026–27 Q2 "No anaemia diagnosis" | 2 | **1** | 1 |
| B6 (Given IV iron) patients in view | 28 | **29** | 29 |
| B6 with initial and post Hb (paired) | 21 | 21 | **22** |
| B6 initial Hb, no post yet | 7 | **8** | **7** |
| B6 anaemic, initial → post (paired) | 15 → 8 | 15 → 8 | **16 → 8** |
| B6 ferritin < 100, initial → post | 21 → 0 | 21 → 0 | **22 → 0** |
| B6 median Hb change | +17 | +17 | +17 |

Written back by the playground (server ids, deleted afterwards): Condition (87522002), Goal (Hb ≥ 130 g/L by
2026-12-10), MedicationRequest (ferric carboxymaltose 1 g/20 mL, 1000 + 200 mg IV), ServiceRequest
(718520009 IV iron infusion, 2026-11-05, `basedOn` → the MedicationRequest). No Flag (full consent) and **no
QuestionnaireResponse** (the playground writes back only the extracted resources).

Screenshots: `screenshots/1-baseline-B4.png` vs `2-forms-B4.png` (PAM 11, 2026–27 Q2 bar);
`1-baseline-B6-patient.png` → `2-forms-B6-patient.png` → `3-recheck-B6-patient.png`; full pages `*-B6.png`.

## Demo script for a presenter (by hand)

Before: in a terminal in this folder, `python3 meld.py load baseline`. Open three tabs:

* B4: `https://<host>/solutions/B4-referrals/?server=https://gw.interop.community/QHConnectathon2026/open`
* B6: `https://<host>/solutions/B6-outcomes/?server=https://gw.interop.community/QHConnectathon2026/open`
* Smart Forms: https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**

(No hosting yet? `python3 -m http.server 8000` in `T/solutions/` and use `http://localhost:8000/B4-referrals/?server=…`.)

1. **B4, before.** Financial year *All*. In *Referrals per quarter by diagnosis (PAM 11)*, the 2026–27 Q2 bar
   has a grey "No anaemia diagnosis" segment: that includes Clara's referral (14 Oct, category 2). Note the
   table row *Diagnosis: Iron deficiency anaemia*, column 2026–27 Q2.
2. **B6, before.** Default view (*Given IV iron*): note the tiles (patients in view, "Initial Hb, no post-treatment
   Hb yet"). Switch *Patients* to *All in the PAM cohort*, open *Per-patient values*: Clara Loopdemo, anchor
   2026-10-14 **referral**, Hb initial 98, no post.
3. **A6 in Smart Forms.** Gear → *Source FHIR Server URL* `https://gw.interop.community/QHConnectathon2026/open`
   → **?** → **SAVE URL AS SOURCE FHIR SERVER** → patient **Clara Loopdemo** → **SAVE**. Pick
   **soln-A6-standalone** → **BUILD FORM** → **POPULATE → Pre-populate**. Show: Hb 98, ferritin 18 → anaemia
   (moderate), iron deficiency, no inflammation; suggested *Iron deficiency anaemia (87522002)*.
   Confirm *Iron deficiency anaemia*; *Consents to all blood products*; target Hb 130, *Surgeon* (due date
   10/12/2026 comes from the waitlist entry). **EXTRACT → Template-based $extract** (Condition + Goal) →
   **REVIEW WRITE BACK ITEMS → WRITE BACK (2 ENTRIES)**.
4. **B4, after.** Reload. 2026–27 Q2: one more *Iron deficiency anaemia* (blue), one fewer *No anaemia
   diagnosis*. Nothing else moves: the referral itself was already counted.
5. **A7 in Smart Forms.** Reload the playground page (or use a fresh tab: the patient picker didn't open a
   second time in the automated run) and select Clara again. **soln-A7-standalone** → **BUILD FORM** →
   **Pre-populate**: 68 kg, 165 cm, Hb 98 → ideal body weight 56.8 kg, deficit 1209 mg, suggested 1200 mg.
   Tick *Intravenous iron infusion*, product *Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial*
   (2 infusions: 1000 + 200 mg), first infusion 05/11/2026. **EXTRACT** (MedicationRequest + ServiceRequest)
   → **WRITE BACK (2 ENTRIES)**.
6. **B6, after.** Reload. Default view: *Patients in view* +1 and *Initial Hb, no post yet* +1. Per-patient
   values: Clara now anchored on **today, IV iron**; initial 98 / 18, no post. Explain: the post-treatment
   result can only come later.
7. **Fast forward.** `python3 meld.py load recheck` (Hb 121, ferritin 385 on 25 Nov). Reload B6: paired +1,
   "no post yet" −1, *Anaemic: initial → post* gains one in the initial count only (98 < 120 → 121 ≥ 120:
   corrected); Clara's line appears in the Female slope chart; per-patient row 98 → 121 (+23), 18 → 385 (+367).
8. **Afterwards: `python3 meld.py clean && python3 meld.py check`** (deletes the patient, the baseline and
   recheck data and every written-back resource, whatever its id; `check` must say 0 left). Do this before
   the PAM dashboard is shown: it reads the same server.

## Mismatches between what A6 / A7 write and what B4 / B6 read

Checked in the run (R) or from the code (C). None fixed here; they are for the A6 / A7 / B4 / B6 owners.

1. **B6 anchors on the order date, and A7's order is dated "now" (R).** `MedicationRequest.authoredOn =
   now()` (A7 template); B6 initial = latest result on/before the earliest IV iron `authoredOn`, post = latest
   after it. Consequences: (a) post-treatment results already on file before the form is filled count as
   *initial*: a closed-loop demo needs future-dated rechecks (above); (b) the infusion date (A7's
   ServiceRequest `occurrenceDateTime`, 2026-11-05 here) is ignored, so a result taken between the order and
   the first infusion counts as "post-treatment"; (c) B6 labels the group "Given IV iron", but A7 writes an
   `active` order, not an administration (synthetic data: `completed`). B6 would need the infusion
   ServiceRequest / a MedicationAdministration, or A7 a status update, to tell "ordered" from "given".
2. **A5 and B6 choose a different anchor (C).** A5 (pathology form) uses the **most recent** IV iron order,
   B6 the **earliest**. Same result with one order (as here), different after a second course or a duplicate
   write-back. Without IV iron: A5 = earliest vs latest result, B6 = latest on/before vs after the referral
   (`EpisodeOfCare.period.start`).
3. **Anaemia threshold: ≤ in A6, < in B6 (C).** A6 (and the mapping draft): Hb ≤ 120 (F) / ≤ 130 (M).
   B6: < 120 / < 130. A woman with Hb exactly 120 is anaemic (IDA) in A6 but "not below threshold" in B6.
4. **B4 links the diagnosis by patient and date only (R/C).** No reference connects the A6 Condition to the
   referral or the episode: B4 takes the patient's Condition with the earliest `recordedDate` on or after
   the referral date (A6 sets `recordedDate = now()`, so it works). But: (a) when the nurse also fills
   *Other diagnosis*, A6 writes **two** Conditions with the same `recordedDate` *date*; B4 compares dates
   only, so which one it shows depends on server order (and an "other" SNOMED code lands in *Other diagnosis*);
   (b) a Condition written for an unrelated reason after the referral could be picked; (c) `recordedDate`
   is local time with offset, B4 takes its first 10 characters (date at the form's time zone).
   Neither A6 nor A7 updates `EpisodeOfCare.diagnosis` or adds `reasonReference` to the referral.
5. **A6 offers a code B4 doesn't group (C).** A6's confirm list has 707323002 *Anaemia in chronic kidney
   disease*; B4's PAM 11 groups only 87522002, 35240004, 234347009, 271737000 (exact match, no
   subsumption), so 707323002 and any *Other diagnosis* (e.g. 724556004 *IDA due to blood loss*, a child of
   87522002) show as "Other diagnosis", not iron deficiency anaemia.
6. **A7's MedicationRequest has no link to the diagnosis (R).** Standalone A7 has no `pam-diagnosis` item, so
   `reasonCode` is empty; the template never writes `reasonReference` (the synthetic data has
   `reasonReference` → Condition). In the assembled form `reasonCode` would carry the A6 code. `requester` is
   absent in the playground (no `author`). B4 / B6 don't need either, but B5 (recommended treatment) and any
   "treated for what" view would.
7. **A7 dose shape (C, from the A7 README):** one `dosageInstruction` per infusion (1000, 200) vs the synthetic
   data's single total. B6 doesn't read doses (only `route` / product code, both of which A7 sets: route
   47625008, AMT 1312141000168105). OK for B6; matters for B1 / B5.
8. **B6's IV iron product list is two codes (C).** A7's AMT value set has 7 products; B6 also accepts route
   47625008, which A7 always writes, so all 7 work. A product-only check would miss 5.
9. **Nothing reads A6's Goal or Flag** in B4 / B6 (expected: not in their scope). The target Hb (Goal, 130 g/L)
   could be B6's per-patient "corrected" threshold; B6 uses the fixed sex thresholds.
10. **EpisodeOfCare is not touched by the forms (R).** It stays `active` after diagnosis and treatment (B6
    shows "active"); closing it ("cleared" / finished) is not part of A6 / A7. Fine for B4 / B6, matters for
    B2 / B3 (days with the team, being managed).
11. **No QuestionnaireResponse is stored (R)**, although the mapping says form answers are "kept alongside
    the extracted resources". Playground write-back sends only the extracted resources.
12. **Re-running a form duplicates (C).** No identifiers / conditional create: a second A6 write-back adds a
    second Condition (B4 keeps the earliest on/after referral), a second A7 order doesn't move B6's anchor
    (earliest) but would move A5's (most recent).

What lines up (R): SNOMED 87522002 Condition → B4's IDA series; MedicationRequest with IV route → B6's IV
group; Observation LOINC 718-7 / 2276-4 in g/L / µg/L → B6; the waitlist `category` (elective-category) →
B4's category 2 and A6's Goal due date; the referral `supportingInfo` → waitlist link.

## Decisions

* The referral, waitlist entry and episode are test data: neither A6 nor A7 creates them (A11 pre-admission
  or a referral form would). So B4's referral counts don't change with the forms; only the diagnosis does.
* Full consent to blood products in A6 (no Flag) to keep the demo short; A6's own run covers the Flag.
* A fresh browser for each form in the automated run (the playground's settings dialog didn't open a second
  time in the same page).

## On Meld

Nothing left by this scenario. The end of `node demo.mjs` runs `meld.py clean` (deletes everything that
references `Patient/soln-C1-patient-1`, found by type searches and `$everything`, then the Patient) and
`meld.py check` (searches 12 resource types by patient, plus `$everything`: 0 left). Uses the existing
`soln-A6-standalone` and `soln-A7-standalone` Questionnaires; creates no Questionnaires of its own.

## TSAT code (29 Oct 2026)

`test_data.py` now writes TSAT as LOINC 14801-5 (AU Core / RCPA SPIA) and the bundles were regenerated. The `soln-C1-…` data already on Meld, if any, still has 2502-3 until reloaded.
