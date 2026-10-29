**Status: verified** (FHIRPath with fhirpath.js on real Meld responses; pre-population, extraction and write-back of `Patient.generalPractitioner` run headless in the patched Smart Forms playground against Meld, 28 Oct 2026)

# A2 GP details: reference solution

Replaces the scaffolding in the starter module [`questionnaires/modules/pam-gp-details.json`](../../questionnaires/modules/pam-gp-details.json)
(keeps the group `pam-gp` and the hidden `pam-gp-details-module` item).

| | What the module does |
|---|---|
| Pre-population | Three candidate doctors, each resolved through PractitionerRole → Practitioner + Organization with `_include` / `_include:iterate`, showing name, practice, phone and Medicare provider number: **GP on record** (`Patient.generalPractitioner`), **referring doctor** (requester of the latest referral, `ServiceRequest` SNOMED 3457005 *Patient referral*), **GP on the latest admission** (`Encounter` class `IMP`, the participant typed SNOMED 62247001 *General practitioner*). A reference to a Practitioner, PractitionerRole or Organization all work. |
| Logic | "Which GP should be recorded?" (radio: keep / referring / admission / manual, local code system `…/track1/CodeSystem/gp-source`), pre-selected "keep" when there is a GP; `enableWhen` shows the matching group; a calculated read-only "GP to be recorded". |
| Write-back | **`Patient.generalPractitioner` updated with a FHIRPath Patch**: a contained `Parameters` template on the `pam-gp` group gives a `PATCH Patient/<id>` entry (`replace` `Patient.generalPractitioner` if the patient had a GP, else `add` to `Patient`). For **manual entry**, also a `Practitioner` and a `PractitionerRole` (practice name, phone, GP role code), each `PUT` with a deterministic id so the PATCH can reference them. |

Pre-population queries (variables on `pam-gp`, then FHIRPath variables `gpCurrentRef/Target/Prac/Org`, same for `gpReferring…`, `gpAdmission…`):

```
Patient?_id={{%patient.id}}&_include=Patient:general-practitioner&_include:iterate=PractitionerRole:practitioner&_include:iterate=PractitionerRole:organization
ServiceRequest?patient={{%patient.id}}&code=http://snomed.info/sct|3457005&_sort=-authored&_count=1&_include=ServiceRequest:requester&_include:iterate=…(same two)
Encounter?patient={{%patient.id}}&class=http://terminology.hl7.org/CodeSystem/v3-ActCode|IMP&_sort=-date&_count=1&_include=Encounter:participant&_include:iterate=…(same two)
```

The resource a reference points to is found in the search Bundle by `entry.where(fullUrl.endsWith('/' + ref)).resource`.

## Updating a Patient with template extraction: how, and what Smart Forms can do

The question for this scenario: template-based extraction is built for *creating* resources, so how do you
*update* one element of an existing Patient? Options, with what we found:

1. **FHIRPath Patch (used here, works).** The template is a contained `Parameters` resource in the
   [FHIRPath Patch](https://hl7.org/fhir/R4/fhirpatch.html) format. Smart Forms (sdc-template-extract 1.0.16, the
   patched playground) sees a Parameters with `operation` parameters and emits `request.method = PATCH`; the URL
   comes from a sub-extension of `sdc-questionnaire-templateExtract` that is **Smart Forms-specific for now**:
   `https://smartforms.csiro.au/ig/StructureDefinition/TemplateExtractExtensionPatchRequestUrl` (proposed upstream as
   `patchRequestUrl`, see the changelog / chat.fhir.org thread). Here its expression is `%resource.subject.reference`.
   The operation's `type`, `path` and `value` all use `templateExtractValue`:

   ```json
   {"resourceType": "Parameters", "id": "PAMGpPatchTemplate", "parameter": [{"name": "operation", "part": [
     {"name": "type",  "_valueCode":   {"extension": [{"url": "…templateExtractValue", "valueString": "iif(<had a GP>, 'replace', 'add')"}]}},
     {"name": "path",  "_valueString": {"extension": [{"url": "…templateExtractValue", "valueString": "iif(<had a GP>, 'Patient.generalPractitioner', 'Patient')"}]}},
     {"name": "name",  "valueString": "generalPractitioner"},
     {"name": "value", "valueReference": {"_reference": {…"<chosen reference>"}, "_display": {…"<chosen name>"}}}]}]}
   ```

   Smart Forms' write-back dialog understands it ("Patient.generalPractitioner — New value: Dr Omar Haddad — replace",
   `screenshots/04-write-back-dialog.png`) and Meld (HAPI 6.0.0) applies it.
2. **PUT the whole Patient** (`resourceId` sub-extension → `PUT Patient/<id>`). Smart Forms supports it, but the
   template would have to rebuild the entire Patient from the form, and anything the form doesn't carry would be
   lost. Not used.
3. **Definition-based extraction** (`definition` on items, `Patient.generalPractitioner`): the SDC way to
   update a resource that was pre-populated, but **Smart Forms doesn't support it** (the menu entry is greyed out).

### Meld / HAPI behaviour we tested directly (curl, 28 Oct)

* `replace` on `Patient.generalPractitioner` with one GP: replaced. With **two** GPs: HAPI replaced both with the one
  value (the spec says the path must match a single element, so other servers may reject it). With **none**: HAPI
  added it (non-conformant; the spec says fail), which is why the template still chooses `add` when there's no GP.
* `Patient.generalPractitioner[0]` or `.first()` as the path: HAPI 6.0 fails with a NullPointerException.
* `replace` with an extra `name` part: accepted (HAPI ignores it), so `name` is static.
* **`urn:uuid:` references inside a PATCH body are not resolved** in a transaction: the Patient ended up pointing
  at `urn:uuid:…`. That rules out the usual "POST the new PractitionerRole with a `urn:uuid` fullUrl and reference
  it" for manual entry. Hence the PUT with a known id (next section).
* A transaction with PATCH entries returns no `entry` for them in the response (HAPI 6.0); the patch is applied anyway
  and Smart Forms reports success.

### Manual entry: why PUT and not POST

Because the PATCH can't reference a `urn:uuid`, the new Practitioner and PractitionerRole are written with
`resourceId` (→ `PUT`) and an id built from the answers:
`soln-A2-gp-<family>-<given>-<provider number>` (lower case, `[a-z0-9-]`, ≤ 50 chars), role id + `-role`.
Re-submitting the same GP updates instead of duplicating. The `soln-A2-` prefix is only the sandbox's id rule:
change `ID_PREFIX` in `build.py` for real use. On a server that resolves `urn:uuid` in PATCH bodies, POST +
`fullUrl` would be the more usual design. The practice is recorded as `PractitionerRole.organization.display` (no
Organization is created; decision to keep the write-back small).

## Files

| File | |
|---|---|
| `pam-gp-details.json` | The module: id `soln-pam-gp-details`, url `https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-gp-details`, version `0.2.0` |
| `A2-standalone.json` | Standalone test form `soln-A2-standalone` (`…/solutions/Questionnaire/A2-standalone`); the module needs **no root variables**, so it is the module minus `assemble-expectation` |
| `build.py` | Generates both forms (all expressions defined once) |
| `testdata.py` → `testdata-bundle.json` | Transaction bundle (PUT, all ids `soln-A2-…`): `soln-A2-patient-1` "Gina Testgp" (GP on record Dr Ruth Ambrose; referral by Dr Lucy Tran; admission Aug 2026 with GP Dr Omar Haddad and an attending doctor), `soln-A2-patient-2` "Noel Nogp" (no GP), 3 Organizations, 4 Practitioners, 3 PractitionerRoles, 1 ServiceRequest, 1 Encounter |
| `load.sh` / `cleanup.sh` | Load test data + Questionnaires to the Meld open endpoint / delete the test data |
| `capture-fixtures.mjs` → `fixtures-searchsets.json` | The three queries' real Meld responses for both test patients and `pam-001`, so `verify.mjs` runs offline |
| `verify.mjs` | Every FHIRPath expression in the module with fhirpath.js (R4), PASS/FAIL; output `verify-output.txt` |
| `playground.mjs`, `playground-lib.mjs` | Headless playground run; output `playground-output.txt`, screenshots `screenshots/`, extracted bundles `playground-extracted-*.json` |

## Try it

```sh
./load.sh          # test data + Questionnaires
# ... try it ...
./cleanup.sh       # delete the test data (Questionnaires stay)
```

1. https://aehrc.github.io/qh-connectathon/smart-forms/ → **GO TO PLAYGROUND**; gear → source FHIR server
   `https://gw.interop.community/QHConnectathon2026/open` (validate, save) → patient **Gina Testgp** → SAVE.
2. **soln-A2-standalone** → BUILD FORM → **POPULATE → Pre-populate**: GP on record Dr Ruth Ambrose, "Keep" selected.
3. Choose **GP from the latest admission** (Dr Omar Haddad appears) → **EXTRACT → Template-based $extract (modified
   only)** → one `PATCH Patient/soln-A2-patient-1` → **REVIEW WRITE BACK ITEMS** → WRITE BACK. Pre-populate again:
   the GP on record is now Dr Omar Haddad.
4. Patient **Noel Nogp** (no GP): choose **Enter the GP manually**, fill the name etc. → modified-only extract:
   `PUT Practitioner/soln-A2-gp-…`, `PUT PractitionerRole/…-role`, `PATCH Patient/soln-A2-patient-2` (add).
5. `./cleanup.sh` (and, if you wrote a manual GP, delete it: `curl -X DELETE …/PractitionerRole/<id>-role` then
   `…/Practitioner/<id>`, after the Patient is gone). `node playground.mjs` does all of this and resets afterwards.

## What was verified, and how

* `node verify.mjs` → ALL PASS (104 checks): pre-population for the three patients on the real search responses
  (test patient 1: all 18 items; patient 2: all empty; `pam-001`: no GP, referring doctor = the surgeon, a
  direct Practitioner reference with no role / practice); the calculated display and every PATCH template expression
  for keep / referring / admission / manual / nothing chosen / Practitioner reference; the manual Practitioner and
  PractitionerRole templates incl. `resourceId` and `templateExtractContext`; coverage: all 48 FHIRPath expressions
  in the module evaluated.
* `node playground.mjs` → ALL PASS (29 checks): pre-population (`01-prepopulated.png`); unchanged form → modified-only
  extraction is empty; admission chosen → exactly one PATCH (replace, PractitionerRole/soln-A2-role-haddad)
  (`02`, `03`), write-back succeeds (`04`), **Meld shows the new `generalPractitioner`**, re-pre-population shows
  Dr Omar Haddad (`05`); manual entry for a patient with no GP → PUT, PUT, PATCH add (`06`, `07`), write-back
  succeeds (`08`), Meld shows the new reference and the new PractitionerRole. The script then reloads the test data
  and deletes the manual Practitioner/PractitionerRole.

Not verified: inside the assembled PAM form, and from an EHR launch (same extraction code path as the playground's
modified-only extract).

## Decisions and known gaps (for the track leads)

* **"GP from latest admission"**: there is no standard place for "the patient's GP as recorded on this admission".
  We used `Encounter.participant` with `type` = SNOMED 62247001 *General practitioner* (the binding is extensible to
  v3 ParticipationType, which has no GP code). The synthetic data has no Encounters, so only the test patient has one.
* **"Referring doctor"** = requester of the latest PAM referral (`ServiceRequest` 3457005). In the synthetic data that's
  always the surgeon, as a Practitioner (no PractitionerRole, practice or phone); the form copes (verified with `pam-001`).
* The write-back value is the **reference the source already uses** (PractitionerRole for the test data, Practitioner
  for `pam-*` referrals), plus `display`.
* **Smart Forms gotchas found (worth telling participants):**
  1. In *modified only* extraction (always used by the launched app), the comparison re-runs the templates over a
     freshly pre-populated response, but **`%resource` still points at the current response**; template expressions
     written with `%resource.repeat(item)…` therefore never differ and the change is dropped. Write them relative to the
     item that carries `templateExtract` (hence `templateExtract` on the `pam-gp` group, not on the radio item).
  2. The pre-populated comparison response has **no calculated answers**, so a template that reads a
     calculatedExpression item extracts on an unchanged form. The PATCH value is computed inside the template from
     pre-populated answers instead.
  3. **Meld (HAPI) drops a `_given` array that has no `given`** when the Questionnaire is stored, silently removing
     that `templateExtractValue`; the template uses `"given": [null], "_given": [{…}]`, which survives.
  4. In headless testing, filling fields back to back (no pause) sometimes left calculated answers out of the response;
     with a short pause it's reliable. Not seen as a problem for a person typing.
* Only one GP is kept (`replace` on HAPI replaces all). Keeping several GPs (e.g. add without replacing) would need a
  different operation.
* `PATCH_URL` sub-extension is Smart Forms-specific; other SDC engines may ignore it.

## Left on Meld

`Questionnaire/soln-pam-gp-details`, `Questionnaire/soln-A2-standalone`. All test data was deleted (`./cleanup.sh`);
`./load.sh` recreates it. Stray resources created by early tests (Practitioner 78 / 781, PractitionerRole 79 / 782,
server-assigned ids) were deleted.

## AU Core 2.0.0 (29 Oct 2026)

Practitioner → AU Core Practitioner, PractitionerRole → AU Core PractitionerRole: **0 errors**, no change. The Patient PATCH (`generalPractitioner`) is a Parameters resource, not profiled; its target types are the ones AU Core Patient allows.

Extracted resources were validated with the HL7 FHIR validator against `hl7.fhir.au.core#2.0.0` (Ontoserver, SNOMED CT-AU), profile given explicitly; templates don't set `meta.profile` (Meld fails a PUT that carries one, HAPI-0389). Extraction: `@aehrc/sdc-template-extract` 1.0.16 on a response answering every item.
