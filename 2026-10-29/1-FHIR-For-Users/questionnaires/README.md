# PAM questionnaire (connectathon starter)

A modular SDC questionnaire for Smart Forms. Each PAM form is its own module; a root form pulls
them in with `subQuestionnaire`, and `$assemble` turns them into the single form Smart Forms shows.

**Deliberately partial.** Each working module has only the items shown in the webinar demos.
Everything else is scaffolding — a dashed "🚧 To be built at the connectathon" box that links to the
[scenario](../Scenarios.md) that would finish it.

| Module | Working items | Scenario |
|---|---|---|
| Patient details | Name, DOB, sex, Medicare number, height, weight (pre-populated); age, BMI (calculated) | A1 |
| GP details | — | A2 |
| Proposed surgery | — | A3 |
| History | — | A4 |
| Pathology | Latest Hb, ferritin, TSAT, CRP (pre-populated); external results → **Observation** | A5 |
| Diagnosis | Anaemia, iron deficiency, inflammation (calculated); diagnosis → **Condition** | A6 |
| Treatment | Ideal/dosing weight, Ganzoni total iron dose (calculated); IV iron order → **MedicationRequest** | A7 |
| Patient education | — | A8 |
| Follow-up and status | — | A9 |

## Files

| File | Purpose |
|---|---|
| `build.py` | Generates every module and the root form (keeps linkIds and variable names consistent) |
| `modules/*.json`, `pam-root.json` | Generated Questionnaires |
| `assemble.mjs` | Assembles them with `@aehrc/sdc-assemble` → `pam-assembled.json` |
| `load.sh [base]` | PUTs modules, root and assembled form to the forms server (default: Meld open endpoint) |

```sh
npm install
npm run build      # python3 build.py && node assemble.mjs
./load.sh
```

Canonical URL of the root form: `https://aehrc.github.io/qh-connectathon/track1/Questionnaire/pam|0.1.0`.
Smart Forms finds the pre-assembled version (`0.1.0-assembled`) on the forms server.

## Conventions for module authors

* linkIds are prefixed `pam-`; a module's top-level group is `pam-<module>`.
* Pre-population queries (x-fhir-query variables) sit on the module's top-level group.
* **Shared FHIRPath variables live on the root form** (`sexCode`, `heightCm`, `weightKg`, `hb`,
  `ferritin`, `tsat`, `crp`, `hbThreshold`, Ganzoni `weight`, `targetHb`, `ironStores`, …).
  Smart Forms only evaluates an item's variables once that item has answers, so module-level
  variables never feed sections that are all calculations. Variable names must be unique across
  modules — `$assemble` rejects duplicates.
* Extraction is template-based: the template is a contained resource in the module, referenced
  by `sdc-questionnaire-templateExtract` on the item that fills it.
* Extracted resources conform to **AU Core 2.0.0** (`hl7.fhir.au.core#2.0.0`): Pathology Result
  Observation, Condition, MedicationRequest (checked with the HL7 validator). They don't claim it in
  `meta.profile`: Meld fails a PUT that carries one (HAPI-0389). Pathology `code` is the LOINC code with the form's label
  in `code.text` (the labels aren't LOINC display names). AU Core needs `MedicationRequest.requester`:
  the Treatment module pre-populates *Prescriber* from the `user` launch context (`%user`); without
  a user, the name typed in becomes `requester.display`.
* Each module has a hidden `pam-<module>-module` item with an initial value, so its section exists
  in the response from the start.
