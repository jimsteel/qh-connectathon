# Synthetic PAM data

40 fictional preoperative anaemia patients (July 2025 – October 2026) as a FHIR R4 transaction
bundle, following the [draft mapping](../FHIR-Mapping-DRAFT.md). All names, people and
organisations are made up.

| File | Purpose |
|---|---|
| `generate.py` | Deterministic generator (fixed seed) → `pam-synthetic-bundle.json` |
| `au_core.py` | AU Core 2.0.0 post-pass used by `generate.py`; `python3 au_core.py <bundle>` upgrades another bundle (e.g. `../decks/examples/pam-demo-bundle.json`) |
| `diff_bundles.py old new` | Checks a change is additive: every old value unchanged, lists what was added |
| `pam-synthetic-bundle.json` | The bundle (PUT with fixed ids, so reloading updates in place) |
| `load.sh [base]` | Posts the bundle; defaults to the Meld sandbox open endpoint |

## What's in it

| Resource | Count | Notes |
|---|---|---|
| Patient | 40 | ids `pam-001`…`pam-040`; northside Brisbane postcodes |
| Observation | 340 | Height, weight; Hb (718-7), ferritin (2276-4), TSAT (14801-5), CRP (1988-5) at referral, and again after treatment for those who finished |
| ServiceRequest | 80 | Per patient: surgical waitlist entry (SNOMED procedure, elective category, unit) and the referral to blood management (referral source) |
| Condition | 33 | Iron deficiency anaemia (22), iron deficiency (6), anaemia of chronic disease (5) |
| MedicationRequest | 28 | IV iron (AMT), dose from Ganzoni |
| EpisodeOfCare | 40 | 32 finished ("cleared"), 8 active ("being managed") |
| Task | 8 | Follow-ups for active episodes |
| Organization / Practitioner | 6 / 8 | Blood management service, surgical units, nurses, surgeons |

Local codes (elective category, referral source, episode and task types) use the placeholder
system `https://aehrc.github.io/qh-connectathon/track1/CodeSystem/…` until the mapping is agreed.

## AU Core 2.0.0

The data conforms to [AU Core 2.0.0](https://hl7.org.au/fhir/core/2.0.0/) (`hl7.fhir.au.core#2.0.0`):
zero errors from the HL7 validator (`-ig hl7.fhir.au.core#2.0.0 -sct au`, tx.ontoserver.csiro.au).
The upgrade only **adds** elements; ids, codes, categories, values and dates are unchanged
(`diff_bundles.py` proves it), so existing searches and forms give the same results.

The resources conform but **don't declare** their profiles: Meld returns HTTP 500 (HAPI-0389) on
any resource with `meta.profile`. To validate, generate a copy with the claims
(`AU_CORE_DECLARE=1 python3 generate.py`) so the validator picks each profile up.

| Resource | Conforms to | Added |
|---|---|---|
| Patient | AU Core Patient | IHI (synthetic, `800360 99…`, valid Luhn), Indigenous status, interpreter required (+ preferred language for the 5 who need one), home phone (`07 5550 xxxx`, reserved for fiction) |
| Observation Hb, ferritin, TSAT, CRP | AU Core Pathology Result Observation | nothing (already conforms) |
| Observation height / weight | AU Core Body Height / Body Weight | SNOMED CT coding (50373000 / 27113001) after the LOINC one |
| Condition, MedicationRequest | AU Core Condition / MedicationRequest | nothing (already conforms) |
| Practitioner | AU Core Practitioner | HPI-I (`800361 99…`) |
| Organization | AU Core Organization | HPI-O (`800362 99…`) on the blood management service |
| ServiceRequest | AU Base ServiceRequest | nothing (already conforms) |
| EpisodeOfCare, Task | (no AU profile) | nothing |

Empty arrays (`prefix: []`, `reasonCode: []`, not valid FHIR JSON and dropped by servers anyway) are
no longer written. One deliberate code change: TSAT is LOINC **14801-5** *Iron saturation [Molar fraction]*
(the RCPA SPIA code AU Core's pathology binding uses), replacing 2502-3; values, units and ids are
the same. Queries for TSAT must use 14801-5. The remaining validator warnings: the placeholder
CodeSystems can't be resolved, and no narrative / Observation.performer.
