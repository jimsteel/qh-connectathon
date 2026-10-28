# A8 Patient Education — full solution

**Status: verified** (fhirpath.js and the Smart Forms extraction library offline; prepopulation,
multi-select, extraction and write-back in the patched Smart Forms playground against Meld,
28 Oct 2026). Not checked: a SMART launch from Meld, and the assembled PAM form in Smart Forms.

Extends the starter module [`questionnaires/modules/pam-education.json`](../../questionnaires/modules/pam-education.json)
(0.1.0, which had only the hidden module item and the to-do box). Same top-level group `pam-education`.

## What it does

| Item | Source / answers |
|---|---|
| Patient | `%patient` name (official name first) |
| Surgical unit | x-fhir-query on the module group (`eduSurgery`): latest surgical waitlist ServiceRequest (category system `…/CodeSystem/elective-category`) with `_include` of its requester and performer → the performer Organization's name |
| Consultant | Same query → the requester Practitioner's prefix, given and family names |
| Proposed surgery | The waitlist entry's code (shown for context) |
| Waitlist entry | Hidden: `ServiceRequest/<id>`, for the write-back |
| Date education given | Defaults to today |
| **Delivery method** (multi-select, required) | HL7 v3 ParticipationMode, the binding of `Communication.medium`: face-to-face, telephone, videoconference, written (printed), email, online |
| **Materials given** (multi-select) | Local codes (placeholder system `https://aehrc.github.io/qh-connectathon/track1/CodeSystem/education-material`, defined in `CodeSystem-education-material.json`), including *Other* → free-text item (`enableWhen`) |
| Notes | Free text |

Write-back (template-based, triggered by the delivery-method item, so nothing is written until a
method is ticked):

* **Procedure**: the education session. `status` completed, `category` SNOMED 409073007
  *Education*, `code` SNOMED 311401005 *Patient education*, `performedDateTime` = date given,
  `performer` = `QuestionnaireResponse.author` (if any), one `usedCode` per material (*Other*:
  text only), `note`.
* **Communication**: what was given and how. `status` completed, `category`
  `communication-category#instruction`, `partOf` → the Procedure (same transaction,
  `urn:uuid` from `extractAllocateId eduProcedureId`), `about` → the waitlist ServiceRequest,
  `sent` = date given, **one `medium` per delivery method**, **one `payload` (contentString) per
  material**, `topic` 311401005, `note`.

**B3 alignment:** B3 counts education sessions as Procedures or Communications coded 409073007 or
311401005 (code or category), dated by `Procedure.performed[x]` / `Communication.sent`. The
Procedure matches (category 409073007, code 311401005, performedDateTime). The Communication's
category is deliberately the HL7 `instruction` code, not SNOMED (311401005 is only its `topic`), so
B3 counts each session **once**. If B3 also matched `Communication.topic` it would count every
session twice. B3 also needs a PAM EpisodeOfCare for the patient, which the test patient here
doesn't have.

## Multiple answers: what was checked

* Three delivery methods → three `Communication.medium` CodeableConcepts with one coding each, not
  one CodeableConcept with three codings. Each repeat comes from `templateExtractContext` =
  `answer.value`.
* Four materials (one *Other*) → four `payload` and four `usedCode` entries, the *Other* one with
  the typed text.
* One method, no materials → one `medium`, no `payload` / `usedCode` / `note`.
* No method → nothing extracted.
* **Found while testing** (`@aehrc/sdc-template-extract` 1.0.16, the playground's version): with a
  `templateExtractContext` element *and* a second, separately templated element in the same
  array (the first version had `payload: [{context: materials…}, {contentString: other text}]`),
  the second element is merged by index into the context's elements. The second material was
  overwritten and one material was lost. Workaround: a single templated element per array (the
  *Other* text is chosen inside the context with `iif(code = 'other', …, display)`). Worth reporting
  upstream.
* **Found on write-back:** Meld rejected the first version (HTTP 422, HAPI-0931) because
  `Procedure.reasonReference` can't reference a ServiceRequest in R4. The playground showed no
  clear error. The link to the waitlist entry is now only `Communication.about`.

## Decisions for the track leads to check

1. **Both Procedure and Communication** are written, with distinct jobs: the Procedure is the
   countable session, the Communication says what was given and how. Either alone would do. One
   Procedure with `usedCode` loses the delivery method; one Communication isn't a "procedure" for
   activity counts.
2. Materials use placeholder local codes. Swap them for real document references
   (DocumentReference / `contentAttachment.url`) once the service's actual leaflets are listed.
   The titles are generic, not real brochure names.
3. Unit and consultant come from the waitlist ServiceRequest's `performer` / `requester`, as in
   the synthetic data. They're shown read-only and not written back.
4. Needs one root-level extension, `sdc-questionnaire-extractAllocateId` = `eduProcedureId`
   (`$assemble` drops it from modules). Without it the Communication has no `partOf` (extraction
   still works). No shared root variables are needed. The module defines its own query variable
   `eduSurgery` (unique name).

## Try it

The test data is **not** left on Meld: it would show up in the population apps and the dashboard.
Load the test patient (synthetic: *Evan Edutest*, a waitlist entry for total knee replacement,
unit *Orthopaedics (A8 test unit)*, consultant *Dr Nora Testsurgeon*):

```sh
curl -X POST -H 'Content-Type: application/fhir+json' --data @test-data.json https://gw.interop.community/QHConnectathon2026/open
```

In the playground (https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**;
Meld open endpoint, patient *Evan Edutest*), pick **soln-A8-standalone**, **BUILD FORM**,
**POPULATE → Pre-populate**, tick several methods and materials, **EXTRACT → Template-based
$extract**. A synthetic patient such as `pam-001` also prepopulates (read only; don't write back
for `pam-*` patients).

On Meld (open endpoint):
* Module: `Questionnaire/soln-pam-education`, canonical
  `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-education|0.2.0`
* Standalone: `Questionnaire/soln-A8-standalone`, canonical `…/solutions/Questionnaire/A8-standalone|0.2.0`

Delete the test data afterwards (written-back Procedures and Communications first:
`Procedure?subject=Patient/soln-A8-patient-1`, `Communication?subject=Patient/soln-A8-patient-1`):

```sh
B=https://gw.interop.community/QHConnectathon2026/open
for r in ServiceRequest/soln-A8-patient-1-surgery Patient/soln-A8-patient-1 Practitioner/soln-A8-consultant Organization/soln-A8-unit; do curl -X DELETE "$B/$r"; done
```

## Verification

| Check | How | Result |
|---|---|---|
| Every FHIRPath expression and x-fhir-query (30) | `node verify.mjs`: fhirpath.js 5.2.2 (R4 model), form simulator `sdc-sim.mjs` | ALL PASS |
| Prepopulation | Query run against Meld for `soln-A8-patient-1` (and read-only for `pam-001`: *Orthopaedics (synthetic)*, *Dr Alan Pierce*) | PASS |
| Extraction, multiple / single / no answers | `@aehrc/sdc-template-extract` 1.0.16 | ALL PASS |
| Playground | `node playground.mjs [--write-back]`: prepopulation, 3 methods + 4 materials, extraction, write-back | ALL PASS; Meld stored Procedure + Communication with `partOf` resolved to `Procedure/<id>` (since deleted) |

Screenshots: `screenshots/01-filled.png`, `02-extracted-bundle.png`, `03-write-back.png`.

```sh
npm install --no-save @aehrc/sdc-template-extract@1.0.16   # optional: extraction checks (don't commit node_modules)
node verify.mjs
node playground.mjs
```

## Known gaps

* `performer` / `sender` are only filled when the response has an `author` (a SMART launch with a
  practitioner user). The playground has none.
* The educator isn't asked for when there's no author. A "given by" item could be added.
* The surgery query takes the most recently authored waitlist entry. A patient with several open
  entries gets the latest.
