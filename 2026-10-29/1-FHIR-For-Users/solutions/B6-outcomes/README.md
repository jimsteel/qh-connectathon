# B6 Outcomes — initial vs post-treatment Hb and ferritin, by sex (PAM 15, 16)

**Status: partly verified** — no-login mode verified headless against the Meld open endpoint, every
headline number checked against an independent FHIR computation (`verify.mjs`, ALL PASS, 28 Oct).
The SMART EHR launch is untested (needs a Meld client registration, which only the user can make).

The complete version of the starter dashboard's outcome charts (`apps/pam-dashboard`). It adds:

* **Paired per-patient changes**: a slope chart per test (one line per patient, initial → post,
  by sex) with the median per group, beside the dashboard-style box plots.
* **Thresholds** drawn on every chart: anaemia Hb < 120 g/L (female) / < 130 g/L (male); ferritin
  < 100 µg/L (the draft decision rules in `FHIR-Mapping-DRAFT.md`).
* **Counts**: patients in view, paired, "initial but no post-treatment result yet", median change,
  how many rose, below threshold initial → post, and how many were "corrected" (below → at/above),
  per sex and overall; a per-patient table with dates.
* **A clinically anchored definition of initial and post-treatment** (below), with the starter's
  "earliest vs latest" method still selectable for comparison.
* Filters: treatment date by Australian financial year; patients given IV iron / not / all.

Files: `index.html` (the app), `launch.html` (SMART launch), `verify.mjs` (check),
`screenshot-outcomes.png`, `screenshot-earliest-latest.png`.

## How to try it

* No login (open endpoint), after hosting the folder (e.g. on GitHub Pages):
  `https://<host>/B6-outcomes/?server=https://gw.interop.community/QHConnectathon2026/open`
  (`?fhirServiceUrl=` works too). Locally: `python3 -m http.server` in this folder, then
  `http://localhost:8000/?server=https://gw.interop.community/QHConnectathon2026/open`.
* Check: `node solutions/B6-outcomes/verify.mjs` from the track folder (uses Playwright from `decks/node_modules`).

### Meld registration (for an EHR launch)

* Launch URI: `https://<host>/<path>/B6-outcomes/launch.html`
* Redirect URI: `https://<host>/<path>/B6-outcomes/` (trailing slash)
* Scopes: `launch openid fhirUser profile online_access user/*.read` (SMART v1)
* Put the client ID in `launch.html` (`CLIENT_ID`). Launch from Meld **with a patient selected**
  (the patient is ignored; this is a population view).

## How each number is derived from FHIR

Three searches, all pages followed (`|` sent as `%7C`):

```
GET Observation?code=http://loinc.org|718-7,http://loinc.org|2276-4&_include=Observation:subject&_count=200
GET MedicationRequest?_count=200
GET EpisodeOfCare?type=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/episode-type|pam&_count=200
```

| Figure | From |
|---|---|
| Result value | `Observation.valueQuantity.value` for LOINC 718-7 (Hb, g/L; g/dL ×10) and 2276-4 (ferritin, µg/L); status not entered-in-error/cancelled |
| Result date | `effectiveDateTime` (else `effectivePeriod.start`, else `issued`), date part |
| Sex | included `Patient.gender` (female / male; others appear in the tables, not the by-sex charts) |
| PAM cohort | patients with an IV iron MedicationRequest or a PAM `EpisodeOfCare` (type `episode-type#pam`). Patients with results but neither (e.g. `pam-demo`, `pam-spike-1`) are left out and counted in the status line |
| IV iron | MedicationRequest with `dosageInstruction.route` = SNOMED 47625008 (intravenous) or medication = AMT 1312141000168105 / 1086251000168104; status not cancelled / entered-in-error / draft |
| **Treatment (anchor) date** | earliest such `MedicationRequest.authoredOn`; for patients not given IV iron, the PAM referral date `EpisodeOfCare.period.start` |
| **Initial** | the patient's latest result **on or before** the anchor date |
| **Post-treatment** | the patient's latest result **after** the anchor date |
| Paired / change | patients with both; change = post − initial |
| Below threshold | Hb < 120 (F) / < 130 (M) g/L; ferritin < 100 µg/L |
| Timeframe | the anchor date, by Australian financial year |

In the synthetic data (`data/generate.py`) initial labs are taken 1–10 days before referral, IV
iron is ordered 5–14 days after referral, and the recheck 21–35 days after that, so "latest on or
before treatment" and "latest after treatment" pick exactly the generator's `-1` and `-2`
Observations. The alternative "earliest vs latest" method (the starter dashboard's) treats any
second result as post-treatment, including in untreated patients.

## Verified (28 Oct 2026, Meld open endpoint)

`verify.mjs` recomputes from separate searches (system-less codes, no `_include`, Patient and
MedicationRequest read in full) and compares with the app's numbers: ALL PASS.

* Given IV iron: 28 patients; 21 with paired Hb and ferritin; 7 with an initial result but no post yet.
* Hb: median change +17 g/L; anaemic 15 → 8 (of 21 paired); every paired patient rose.
* Ferritin: median change +261 µg/L; below 100: 21 → 0.
* Earliest-vs-latest method (all PAM patients): 25 Hb pairs (21 given IV iron + 4 not given IV iron, i.e. anaemia of chronic disease).

Screenshots show the default view and the comparison method.

## Not verified / gaps / decisions for the track leads

* **EHR launch not tried** (no client ID). `launch.html` follows the dashboard's working pattern.
* **Anchoring is a proposal**: "initial = latest on/before the first IV iron order; post = latest
  after it". Alternatives: the infusion date (MedicationAdministration, not in the data), a fixed
  window (e.g. post = 2–8 weeks after), or the last result before surgery. Untreated patients are
  anchored on referral — check this is wanted.
* `MedicationRequest.authoredOn` is the order date, not the infusion date.
* Thresholds use `<` (WHO); the mapping draft says "≤130 / ≤120". Ferritin < 100 only (the TSAT
  rule for iron deficiency is not applied: B6 is about Hb and ferritin).
* Demo write-backs on the shared data show up (e.g. extra IV iron orders on `pam-034` from the
  webinar demos); they don't change the anchor because the earliest order is used.
* Light theme only, like the starter dashboard.
