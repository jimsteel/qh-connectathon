# B4 Referrals over time — by category, vs waitlisted cases, by diagnosis (PAM 9, 10, 11)

**Status: partly verified** — no-login mode verified headless against the Meld open endpoint, every
per-quarter count checked against an independent FHIR computation (`verify.mjs`, ALL PASS, 28 Oct).
The SMART EHR launch is untested (needs a Meld client registration).

Three charts per **Australian financial-year quarter** (Q1 = Jul–Sep … Q4 = Apr–Jun, labelled
"2025–26 Q1"):

* **PAM 9** — referrals to blood management, stacked by the elective surgery category (1/2/3) of
  the patient's waitlist entry.
* **PAM 10** — referrals vs cases added to the surgical waitlist, side by side (same unit, one
  axis), with "referrals per 100 waitlisted cases" in the table and a tile.
* **PAM 11** — referrals stacked by diagnosis (SNOMED CT-AU Condition): iron deficiency anaemia,
  iron deficiency, anaemia of chronic disease, anaemia, other, uncoded, no anaemia diagnosis.

A table gives every number behind the charts; a financial-year filter shows that year's four quarters.

Files: `index.html`, `launch.html`, `verify.mjs`, `screenshot-referrals.png`.

## How to try it

* No login: `https://<host>/B4-referrals/?server=https://gw.interop.community/QHConnectathon2026/open`
  (`?fhirServiceUrl=` works too). Locally: `python3 -m http.server` in this folder, then
  `http://localhost:8000/?server=…`.
* Check: `node solutions/B4-referrals/verify.mjs` from the track folder.

### Meld registration (for an EHR launch)

* Launch URI: `https://<host>/<path>/B4-referrals/launch.html`
* Redirect URI: `https://<host>/<path>/B4-referrals/`
* Scopes: `launch openid fhirUser profile online_access user/*.read` (SMART v1)
* Client ID into `launch.html`. Launch with a patient selected (ignored: population view).

## How each number is derived from FHIR

```
GET ServiceRequest?code=http://snomed.info/sct|3457005&_count=200                       (referrals)
GET ServiceRequest?category=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/elective-category|&_count=200   (waitlist)
GET Condition?_count=200
```

(`|` sent as `%7C`; `category=<system>|` matches any code in that system; all pages followed.)

| Figure | From |
|---|---|
| Referral | ServiceRequest with code SNOMED 3457005 *Patient referral*, status not entered-in-error / revoked / draft |
| Referral quarter | `ServiceRequest.authoredOn` → Australian FY quarter |
| Category (PAM 9) | `category` (elective-category system) of the waitlist ServiceRequest the referral points to with `supportingInfo`; fallback: the patient's latest waitlist entry authored on/before the referral; else "Unknown" |
| Waitlisted case (PAM 10) | ServiceRequest with an elective-category `category`, status not entered-in-error, counted in the quarter of its `authoredOn` (date placed on the list) |
| Referrals per 100 waitlisted | referrals ÷ waitlisted cases in the same quarter × 100 |
| Diagnosis (PAM 11) | the patient's Condition with the earliest `recordedDate` on or after the referral date (else the latest before it), by its SNOMED code; no code → "Uncoded"; no Condition → "No anaemia diagnosis" (screened and cleared) |
| "All" timeframe | first to last quarter that has a referral; waitlist entries outside that span are not shown (the status line says how many are) |

## Verified (28 Oct 2026, Meld open endpoint)

`verify.mjs` reads all ServiceRequests and Conditions without search filters, assigns quarters with
a different formula (months since July) and joins in memory; it compares every per-quarter series
(referrals, waitlisted, each category, each diagnosis) and the FY filter: ALL PASS.

Synthetic patients (40 referrals): 2025–26 Q1 9, Q2 8, Q3 9, Q4 1; 2026–27 Q1 12, Q2 1.
Diagnoses: 22 iron deficiency anaemia, 6 iron deficiency, 5 anaemia of chronic disease, 7 none.
At the time of the run Meld also held two test referrals from other solutions (A2, A9) without a
waitlist link, which show as category "Unknown" (42 referrals in the screenshot), and an A3 test
waitlist entry authored in 2019, outside the span shown.

## Not verified / gaps / decisions for the track leads

* **EHR launch not tried** (no client ID).
* **What "waitlisted cases" means.** Here: surgical waitlist entries (ServiceRequests with an
  elective category) by date added. The synthetic data only has waitlist entries for referred
  patients, added 7–60 days before referral, so the ratio swings around 100 per quarter (it can
  exceed 100). With real data the waitlist would hold all elective cases and the ratio would be the
  referral rate. An alternative is a snapshot ("on the list at quarter end").
* **Category is on the waitlist entry, not the referral** (`ServiceRequest.category` with a local
  code system). The mapping draft leaves open `priority` vs an extension; the app reads `category`.
* **Diagnosis link** is by patient and date because the referral doesn't reference the Condition
  (the IV iron MedicationRequest does, via `reasonReference`). A `reasonReference` on the referral or
  an EpisodeOfCare `diagnosis` would make the link explicit.
* Grouping is by exact SNOMED code. Grouping by subsumption (e.g. all descendants of 87522002 via
  Ontoserver `$expand` with ECL `<< 87522002`) would cope with more specific codes from A6; not done.
* Light theme only, like the starter dashboard.
