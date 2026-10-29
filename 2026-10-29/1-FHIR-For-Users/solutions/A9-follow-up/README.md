# A9 Follow-up + Status: full solution

**Status: verified.** Every FHIRPath expression was checked with fhirpath.js, and Smart Forms' own
extractor was run on the forms. Pre-population, extraction and write-back were run in the patched
Smart Forms playground against Meld (headless, 28 Oct 2026). The server was then checked for each case.

This extends the scaffolding module `questionnaires/modules/pam-follow-up.json` (0.1.0). It keeps the same
top-level group `pam-follow-up` and the hidden `pam-follow-up-module` item. The 🚧 box is replaced by working items.

## What it does

| | |
|---|---|
| **Pre-population** (x-fhir-query on the `pam-follow-up` group) | `fuEpisode`: latest PAM EpisodeOfCare (`type=…/episode-type\|pam`, `_sort=-date`). `fuReferral`: latest referral ServiceRequest (SNOMED 3457005). `fuTasks`: the patient's follow-up Tasks (`…/task-type\|follow-up`, oldest first). |
| Pre-populated items | Referral date (from the referral; falls back to `EpisodeOfCare.period.start`). Status before this review (`EpisodeOfCare.status`). Due date of the open follow-up. **Previous notes** (every `Task.note` as `date: text`, one per line). Hidden: EpisodeOfCare id, care manager, id of the open Task. |
| **Calculations** | **Days with the blood management team** = review date − referral date. **Follow-up due** = review date + *n* weeks (default 4). |
| Logic | *Status after this review*: **Being managed** (`active`) / **Cleared** (`finished`). The *Next follow-up* group shows only while the patient is being managed (`enableWhen`). |
| **Write-back** (template extraction) | (1) A new follow-up **Task** (POST) when being managed. It has `for`, `focus` → the EpisodeOfCare, `owner` = care manager, `restriction.period.end` = due date, `description`/`code.text`, and the note with its time. (2) The previous open **Task** is set to `completed` (FHIRPath PATCH). (3) **EpisodeOfCare status change** (FHIRPath PATCH): `status`, plus `period.end` = review date when the patient is cleared. This entry is written only when the status actually changes. |

The Task follows the synthetic data (`data/generate.py`), not the draft mapping: the due date is in
`Task.restriction.period.end`, not `executionPeriod`. That way the B2 worklist reads one shape.

No new shared root variables are needed. The module's variables (`fuEpisode`, `fuReferral`, `fuTasks`)
are its own, and their names are unique for `$assemble`.

## Updating an existing EpisodeOfCare with template extraction

SDC template extraction can express an update, and **Smart Forms can do it both ways**. Both were tested
end to end on Meld:

1. **FHIRPath Patch (used in the module).** The contained template is a `Parameters` resource with FHIRPath Patch
   operations. Its values come from `templateExtractValue`, for example
   `replace EpisodeOfCare.status` and `add EpisodeOfCare.period / end`. The `templateExtract` extension carries the request URL in
   Smart Forms' **temporary, non-standard** sub-extension
   `https://smartforms.csiro.au/ig/StructureDefinition/TemplateExtractExtensionPatchRequestUrl`
   (`'EpisodeOfCare/' + <episode id item>`). It is in sdc-template-extract 1.0.10 and later. SDC has no standard slot for this yet
   (see the changelog's link to the chat.fhir.org thread). Smart Forms drops operations whose value is
   empty, and a Parameters with no operations left. The module uses this to write only what changed. The
   playground's write-back dialog shows these entries as *update* with each operation (`img/cleared-4-write-back-dialog.png`).
   Meld (HAPI 6.0.0) accepts PATCH entries in a transaction.
2. **Full PUT (standard SDC), in `A9-standalone-put.json`.** The template is a whole EpisodeOfCare. The standard
   `resourceId` sub-extension (the episode id) makes the entry `PUT EpisodeOfCare/<id>`. Every element has to be
   carried through hidden items (organisation, period start/end, referral, care manager), or the PUT erases
   it. Anything the form doesn't know about, such as `statusHistory` or `diagnosis`, is lost.
   The form also sets the standard `ifMatch` (`W/"<versionId>"`) for optimistic locking, but **Smart Forms
   (sdc-template-extract 1.0.16) drops it**. Its `getOptionalBundleEntryRequestProperty()` keeps a
   result only if `result[0].id` is a string, which a string never has. The same applies to `ifNoneMatch`,
   `ifModifiedSince` and `ifNoneExist`. This is worth reporting upstream. `verify.mjs` records the behaviour.

Recommendation: use PATCH for status changes, and say clearly that it relies on a Smart Forms extension. Use PUT only where the form
owns the whole resource.

## Files

| File | |
|---|---|
| `pam-follow-up.json` | The module: id `soln-pam-follow-up`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-follow-up`, 0.2.0, `assemble-child` |
| `A9-standalone.json` | Standalone test form `soln-A9-standalone` (same items and templates, no assemble flag) |
| `A9-standalone-put.json` | Variant `soln-A9-standalone-put`: EpisodeOfCare written by PUT (`resourceId` + `ifMatch`) |
| `build.py` | Generates the three forms (`python3 build.py`) |
| `test-data.json` | Transaction Bundle (PUT): Patient `soln-A9-patient-1` (Fiona Followup-A9), referral, active EpisodeOfCare, two Tasks with notes |
| `reset-test-data.sh` | Loads `test-data.json` and deletes Tasks written back for the test patient |
| `delete-test-data.sh` | Deletes all of the test patient's data from Meld |
| `load.sh` | PUTs the three Questionnaires to Meld |
| `verify.mjs` | FHIRPath and extraction checks (below) |
| `playground.mjs` | Headless run of the playground: managed / cleared / put |
| `img/` | Screenshots, the extracted Bundles and the QRs from the playground |

## Try it

1. Load the test data: `./reset-test-data.sh` (this is the one-line load command; or
   `curl -X POST -H 'Content-Type: application/fhir+json' --data-binary @test-data.json https://gw.interop.community/QHConnectathon2026/open`).
2. Open https://aehrc.github.io/qh-connectathon/smart-forms/, click **GO TO PLAYGROUND**, then the gear icon. Set the source server to
   `https://gw.interop.community/QHConnectathon2026/open`, then validate (?), save the URL, choose patient **Fiona Followup-A9**, and click SAVE.
3. Pick **soln-A9-standalone**, click **BUILD FORM**, then **POPULATE → Pre-populate**. You should see: referral 01/09/2026, status *Being managed*,
   open follow-up due 08/10/2026, two dated notes, review date today, days with the team (57 on 28 Oct) and due date = today + 4 weeks.
4. Change the weeks or choose **Cleared**, then **EXTRACT → Template-based $extract**, then **REVIEW WRITE BACK ITEMS → WRITE BACK**.
5. Check the result: `…/open/EpisodeOfCare/soln-A9-episode-1?_format=json` and `…/open/Task?patient=soln-A9-patient-1&_format=json`.
   Pre-populate again to see your note under *Previous notes*.
6. Clean up: `./delete-test-data.sh`.

On a real PAM patient (read only), for example `pam-032`, the queries return its episode, its open Task and its referral date. `verify.mjs` checks this.

## Verification

* `node solutions/A9-follow-up/verify.mjs` (from `T/`, with the test data loaded) gives **34 checks passed**.
  `EXTRACT_DIR=<dir with @aehrc/sdc-template-extract@1.0.16 installed> node …/verify.mjs` gives **44 checks passed**.
  The checks cover: structure and linkIds; the three queries on Meld (test patient and pam-032); every initialExpression; the
  calculations (including across a year end and a leap day); and the extracted Bundles from Smart Forms' own
  `inAppExtract` (managed: `POST Task` + `PATCH Task`; cleared: `PATCH EpisodeOfCare` + `PATCH Task`;
  PUT variant: `PUT EpisodeOfCare` with every element; no EpisodeOfCare entry when the status is unchanged).
* Playground (`node solutions/A9-follow-up/playground.mjs`, 28 Oct). Each case was pre-populated, filled, extracted and written back
  to Meld, then the server was checked:
  * **managed** (weeks 6, with a note): a new Task with due 2026-12-09, the focus/owner/note, and the previous Task `completed`.
    The episode stayed `active`. Pre-populating again shows the new note and due date (`img/managed-6-close-the-loop.png`).
  * **cleared**: EpisodeOfCare `finished`, `period {start 2026-09-01, end 2026-10-28}`, and the previous Task `completed`.
  * **put**: EpisodeOfCare replaced with status `finished` and every original element kept.

## Known gaps and decisions

* "Days with the team": fhirpath.js can't subtract two dates (no `difference()` in 4.x/5.x), so the
  calculation turns the date parts into day numbers. It is long but exact.
* "Previous notes" come from `Task.note`. The synthetic `pam-*` data has no notes, so on those patients the box is empty.
* Clearing doesn't record a reason, and doesn't add `statusHistory`. FHIRPath Patch can add a complex element, but it
  is verbose. Reopening a cleared episode (finished → active) doesn't remove `period.end`.
* In the playground the due date recalculates about 1 s after the weeks change. If you extract immediately, you get the old value.
* The Task write-back gets a server-assigned id (POST). Those Tasks reference only the test patient and are
  deleted by the scripts.
* The module hasn't been run through `$assemble` with the other modules (that is A10). Its variable names are unique.

## AU Core 2.0.0 (29 Oct 2026)

Task and EpisodeOfCare (no AU Core / AU Base profile) as base R4: **0 errors**, no change. Warnings: local `task-type` / `episode-type` CodeSystems aren't published. The status PATCHes are Parameters, not profiled.

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
