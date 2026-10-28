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

"Partly verified" for the B apps means no-login mode was tested against Meld but an EHR launch was
not (no client IDs were registered).

## Reviews

* [REVIEW-strand-A.md](REVIEW-strand-A.md): cross-module issues (linkId clash, consent coded three
  ways, eGFR code, inactive codes).
* Strand B was reviewed too; its fixes are in the commit history (escaping, ages, a B8 crash).

## On Meld

Only the `soln-*` Questionnaires are left on the `QHConnectathon2026` sandbox. Test patients and
their data were deleted so they don't show up in the shared dashboards; each folder has the test
data and a `load.sh` / `cleanup.sh` (or equivalent) to recreate and remove it. Some `verify.mjs`
scripts need that test data loaded to pass their live checks.
