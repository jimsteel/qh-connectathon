# Track 1 reference solutions

Worked solutions to the scenarios in [`../Scenarios.md`](../Scenarios.md), built overnight on
28–29 Oct 2026. They exist so the track leads can **fill gaps or show how a scenario could work**
at the end of the event; they are not the only (or the best) answer. Each folder's `README.md` says
what it does, how to try it, what was verified and what wasn't.

Strand D (REDCap) was skipped on purpose.

## Index

| ID | Folder | Status | What it is |
|---|---|---|---|
| A1 | [A1-patient-details](A1-patient-details/) | verified | Demographics pre-populated; height and weight written back as Observations |
| A2 | [A2-gp-details](A2-gp-details/) | verified | Pick the GP from three sources; `Patient.generalPractitioner` updated with a FHIRPath Patch template |
| A3 | [A3-proposed-surgery](A3-proposed-surgery/) | verified | Waitlist entry pre-populated, days until surgery; referral ServiceRequest written back |
| A4 | [A4-history](A4-history/) | partly verified | History with deep `enableWhen` and SNOMED CT-AU ECL; Conditions and Procedures written back (repeats duplicate: Smart Forms drops `ifNoneExist`) |
| A5 | [A5-pathology](A5-pathology/) | verified | Repeating pathology time points, initial vs post; hand-entered results written back |
| A6 | [A6-diagnosis](A6-diagnosis/) | verified | Pathway classification; Condition, Flag and Goal written back |
| A7 | [A7-treatment](A7-treatment/) | verified | Ganzoni iron dose; MedicationRequest and infusion ServiceRequest |
| A8 | [A8-education](A8-education/) | verified | Education delivered; Procedure / Communication |
| A9 | [A9-follow-up](A9-follow-up/) | verified | Days with the team, follow-up due; Task and EpisodeOfCare status |
| A10 | [A10-assembly](A10-assembly/) | verified | The full PAM form (`soln-pam-assembled`) assembled from the modules with a new root (`soln-pam-root`) |
| A11 | [A11-pre-admission](A11-pre-admission/) | verified | Patient-facing form; nurse forms pre-populate from its QuestionnaireResponse |
| B1 | [B1-patient-summary](B1-patient-summary/) | partly verified | Patient app: the nurse's summary of the launch patient |
| B2 | [B2-worklist](B2-worklist/) | partly verified | Worklist: patients being managed, follow-ups due |
| B3 | [B3-kpi-tiles](B3-kpi-tiles/) | partly verified | Headline number tiles (PAM 6–8a) |
| B4 | [B4-referrals](B4-referrals/) | partly verified | Referrals over time (PAM 9–11) |
| B5 | [B5-referral-profile](B5-referral-profile/) | partly verified | Referral profile (PAM 12–14) |
| B6 | [B6-outcomes](B6-outcomes/) | partly verified | Initial vs post-treatment Hb and ferritin by sex (PAM 15–16) |
| B7 | [B7-demographics](B7-demographics/) | verified | Demographics (PAM 17–19) |
| B8 | [B8-filters](B8-filters/) | verified | Shared filters (PAM 1–5) as a reusable module |
| B9 | [B9-analytics](B9-analytics/) | verified | SQL on FHIR ViewDefinitions and Measure/MeasureReport, no BI tool |
| C1 | [C1-closed-loop](C1-closed-loop/) | verified | A6 + A7 in Smart Forms → write-back → B4 and B6 update |
| C2 | [C2-mapping-review](C2-mapping-review/) | verified | Critique of `FHIR-Mapping-DRAFT.md`, with decisions for the leads |

"Partly verified" for the B apps means no-login mode was tested against Meld but an EHR launch
from Meld wasn't. B1–B8 are now registered in the `QHConnectathon2026` Meld sandbox (30 Oct 2026),
with their client IDs in `B1-patient-summary/config.js` and each app's `launch.html`; launch them
from Meld's app list.

## Try the apps (no Meld registration)

The apps are on GitHub Pages at `https://jimsteel.github.io/qh-connectathon/2026-10-29/1-FHIR-For-Users/solutions/`.
These links launch each one through the [SMART launcher](https://launch.smarthealthit.org)'s
`remote-launch` endpoint, which proxies to the Meld open endpoint, so no client ID is needed.
They launch as nurse `pam-nurse-1` with patient `pam-001`; change `patient=` in the link for B1.
The launcher's proxy collapses `//` in query strings, so the apps send systems as `http%3A%2F%2F…`.

| ID | Launch |
|---|---|
| B1 | [Patient summary](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB1-patient-summary%2F&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B2 | [Worklist](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB2-worklist%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B3 | [Headline numbers](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB3-kpi-tiles%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B4 | [Referrals over time](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB4-referrals%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B5 | [Referral profile](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB5-referral-profile%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B6 | [Outcomes](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB6-outcomes%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B7 | [Demographics](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB7-demographics%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |
| B8 | [Shared filters](https://launch.smarthealthit.org/remote-launch?fhir_server=https%3A%2F%2Fgw.interop.community%2FQHConnectathon2026%2Fopen&launch_uri=https%3A%2F%2Fjimsteel.github.io%2Fqh-connectathon%2F2026-10-29%2F1-FHIR-For-Users%2Fsolutions%2FB8-filters%2Flaunch.html&fhir_ver=4&patient=pam-001&provider=pam-nurse-1) |

## Reviews

* [REVIEW-strand-A.md](REVIEW-strand-A.md): cross-module issues (linkId clash, consent coded three
  ways, eGFR code, inactive codes).
* Strand B was reviewed too; its fixes are in the commit history (escaping, ages, a B8 crash).

## On Meld

Only the `soln-*` Questionnaires are left on the `QHConnectathon2026` sandbox. Test patients and
their data were deleted so they don't show up in the shared dashboards; each folder has the test
data and a `load.sh` / `cleanup.sh` (or equivalent) to recreate and remove it. Some `verify.mjs`
scripts need that test data loaded to pass their live checks.
