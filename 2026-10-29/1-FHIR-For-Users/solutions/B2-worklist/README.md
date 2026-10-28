# B2 Nurse worklist — patients being managed and follow-ups due (PAM 6)

**Status: partly verified** — no-login mode verified headless against the Meld open endpoint for
two "today" dates, counts and row order checked against an independent FHIR computation
(`verify.mjs`, ALL PASS, 28 Oct). The SMART EHR launch is untested (needs a Meld client registration).

The blood management nurse's working list: every patient **being managed** (active PAM
EpisodeOfCare: PAM 6), **soonest surgery first**, with procedure, unit, elective category,
referral date and days with the team, care manager, latest Hb and ferritin (flagged below
threshold), and the next open **follow-up Task** with its due date (overdue / due within 7 days /
later, shown with icon and text, not colour alone). Tiles: being managed, follow-ups overdue, due
in the next 7 days, surgery within 14 days, being managed with no follow-up planned. Filters: care
manager, "only overdue or due within 7 days", sort by surgery date or by follow-up due date, and
the "today" date. Open Tasks that don't belong to a listed episode appear in a second table.

Files: `index.html`, `launch.html`, `verify.mjs`, `screenshot-worklist-2026-10-06.png`,
`screenshot-worklist-2026-10-28.png`.

## How to try it

* No login: `https://<host>/B2-worklist/?server=https://gw.interop.community/QHConnectathon2026/open`
  (`?fhirServiceUrl=` works too). Add `&today=2026-10-06` to see the list as of the date the
  synthetic data was generated for (default: the browser's date, when most follow-ups are overdue).
  Locally: `python3 -m http.server` in this folder, then `http://localhost:8000/?server=…`.
* Check: `node solutions/B2-worklist/verify.mjs` from the track folder.

### Meld registration (for an EHR launch)

* Launch URI: `https://<host>/<path>/B2-worklist/launch.html`
* Redirect URI: `https://<host>/<path>/B2-worklist/`
* Scopes: `launch openid fhirUser profile online_access user/*.read` (SMART v1)
* Client ID into `launch.html`. Launch with a patient selected (ignored: population view).
  With `fhirUser` the app could default the care-manager filter to the logged-in practitioner;
  not done, because Meld's sandbox users aren't the synthetic nurses.

## How each figure is derived from FHIR

```
GET EpisodeOfCare?status=active&type=…/CodeSystem/episode-type|pam
      &_include=EpisodeOfCare:patient&_include=EpisodeOfCare:care-manager&_include=EpisodeOfCare:incoming-referral
GET Task?status=requested,received,accepted,ready,in-progress,on-hold&_include=Task:patient&_include=Task:owner
GET ServiceRequest?category=…/CodeSystem/elective-category|&subject=Patient/a,Patient/b,…&_include=ServiceRequest:performer
GET Observation?code=http://loinc.org|718-7,http://loinc.org|2276-4&subject=Patient/a,Patient/b,…
```

(`…` = `https://aehrc.github.io/qh-connectathon/track1`; `|` sent as `%7C`; patients in chunks of 20; all pages followed.)

| Figure | From |
|---|---|
| Being managed (PAM 6) | count of EpisodeOfCare `status=active`, type `episode-type#pam` |
| Patient, sex, age | included Patient: `name`, `gender`, `birthDate` (age as of "today") |
| Care manager | included Practitioner from `EpisodeOfCare.careManager` |
| Referred / days with team | `EpisodeOfCare.period.start`; days = today − start |
| Surgery date | waitlist ServiceRequest referenced by the referral's `supportingInfo` (referral = `EpisodeOfCare.referralRequest`, included); fallback: the patient's active waitlist entry with the soonest date. `occurrenceDateTime` (or `occurrencePeriod.start`) |
| Procedure / unit / category | waitlist `ServiceRequest.code`, `performer` → Organization `name`, `category` (elective-category) |
| Follow-up | open Task with `focus` = the EpisodeOfCare (or, if its focus is not an EpisodeOfCare, `for` = the patient); the one due soonest is shown, "+n more" for the rest |
| Due date | `Task.restriction.period.end` (what the synthetic data uses), else `Task.executionPeriod.end` (the draft mapping) |
| Overdue / due soon | due < today / 0–7 days from today |
| Surgery within 14 days | surgery date 0–14 days from today |
| Latest Hb / ferritin | most recent Observation per patient; flagged below 120/130 g/L (F/M) or 100 µg/L |
| Other open follow-ups | open Tasks not matched to a listed episode |

## Verified (28 Oct 2026, Meld open endpoint)

`verify.mjs` reads all EpisodeOfCare, Task and ServiceRequest resources without search filters,
joins them in memory and compares: ALL PASS.

Synthetic patients only (first run):

* Today = 2026-10-06: 8 being managed, 0 overdue, 1 due within 7 days, 0 surgeries within 14 days.
* Today = 2026-10-28: 8 being managed, 5 overdue, 2 due within 7 days, 4 surgeries within 14 days.
* Row order (by surgery date): pam-038, 039, 040, 032, 036, 035, 037, 034.

The live list also picks up other solutions' test data. On a second run the A9 solution's test
episode (`soln-A9-episode-1`, active, type pam) had become active: 9 being managed, still ALL PASS,
with `soln-A9-patient-1` sorted last as "not booked" (its referral has no waitlist entry). When that
episode is closed, its open Task moves to the "Other open follow-ups" table (seen on the first run).

## Not verified / gaps / decisions for the track leads

* **EHR launch not tried** (no client ID).
* **Due date element**: the data uses `Task.restriction.period.end`, the mapping draft suggests
  `executionPeriod`. The app reads both; the track should pick one (the A9 module writes whichever
  it chose).
* Only `status=active` counts as "being managed"; `waitlist`/`onhold` episodes are not listed.
* "Due soon" = 7 days and "surgery soon" = 14 days are arbitrary; easy to change in the code.
* Read-only: no "complete task" button (the brief says never write to Meld from these apps).
* Light theme only, like the starter dashboard.
