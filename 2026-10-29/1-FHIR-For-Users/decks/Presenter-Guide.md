# Presenter guide: Track 1 kick-off demos

Click-by-click notes for the live demos. The Meld open endpoint, fhirpath-lab and the Smart Forms
playground were checked live on 28 Oct 2026 (headless Chromium 1600×900). The NLM Form Builder
was checked live the same day, click by click, in a browser profile where the LOINC terms had been
accepted (section 1). **The CodeSandbox starter was not run by us** (section 6). Screenshots are
in `img/` and are re-captured with `make shots`. Paths are relative to `decks/`. Presenting? Start
with the run sheets below; they point into the per-site sections 1–6.

**Speaker notes:** every slide has talking points, and each ▶ Demo slide has its cue from this
guide (section, steps, expected result, fallback). In the deck HTML press **`p`** (or ☰ →
presenter view) to see them beside the current slide; in the PPTX they're in the notes pane.

**Before each demo session**

1. `./examples/reset-demo.sh`: puts `pam-demo` back to its baseline (latest Hb 104 g/L on
   14 Oct). Every write-back demo adds an Observation, which changes "latest Hb".
2. `make verify` should end with `all N checks passed` and no `FAIL` lines; `make verify-slides`
   should end with `verify-slides ok`.
3. Use a browser profile where you've already accepted the NLM Form Builder's terms of use
   (section 1). You accept them yourself on first use; they're stored per browser profile.

Demo patient: **Demi Formsdemo**, id `pam-demo` (F, 1961-04-09). Baseline: Hb 112 (2 Sep),
**Hb 104 (14 Oct, latest)**, ferritin 18 (14 Oct), height 164 cm, weight 71.4 kg.

---

## Run sheets (kick-off order)

One block per deck: what to open beforehand, the live steps, what you should see, and the
fallback. "§n" = the per-site section below with the click-by-click detail.

**Open tabs (one browser profile, NLM terms already accepted):**
(a) https://formbuilder.nlm.nih.gov/ · (b) https://aehrc.github.io/qh-connectathon/smart-forms/
→ **GO TO PLAYGROUND** · (c) https://fhirpath-lab.com/FhirPath · (d) the latest-Hb URL (§2) ·
(e) the deck HTML or PDF. Files at hand: `examples/pathology-walkthrough-stage1.json`,
`examples/sample-qr.json`.

### 1. Scenarios (no demo)

* Before: nothing. Have `Scenarios.md` open for questions.
* Slide *Where things are*: the URLs participants need; client IDs come from you.
* Strand D (REDCap) is deliberately not on the slides beyond a one-line pointer on *Three strands*;
  if someone asks, point them at `Scenarios.md` (and the REDCap instance isn't confirmed).

### 2. SMART apps

* Before: logged in to Meld (https://meld.interop.community, sandbox `QHConnectathon2026`).
  Know how you'll hand out client IDs (participants send launch URI + redirect URI + scopes).
* Slides *Where your app lives*, *Hosting on CodeSandbox*, *Hosting on GitHub Pages*: show the
  first, skim the other two (they're for reading back). Any other public HTTPS host is fine too.
* Demo *First app: try the query in your browser*: paste
  `https://gw.interop.community/QHConnectathon2026/open/Observation?code=http://loinc.org%7C718-7&patient=pam-demo&_sort=-date&_format=json`
  → Bundle with `pam-demo-hb-2` (104 g/L, 14 Oct) then `pam-demo-hb-1` (112, 2 Sep) (§2).
  Fallback: `img/smart/01-hb-search-open.png`. If you've run write-back demos without a reset,
  there's a third, newer Hb.
* Optional: launch an app from Meld **with a patient selected** (§5; not scripted). Fallback:
  the `?fhirServiceUrl=...&patientId=pam-demo` URL on the *Run it* slide, or the dashboard
  https://aehrc.github.io/qh-connectathon/pam-dashboard/?server=https://gw.interop.community/QHConnectathon2026/open
* The CodeSandbox starter was never run by us (§6): try a fork and a Meld launch before showing it live.
* Slides *The React starter…* to *React starter: wire it in* are React-only; *Same app, no build* shows
  the GitHub Pages template (https://github.com/aehrc/qh-connectathon-smart-starter), which already has
  the fixes and the Hb table. *Run it* applies to any host.

### 3. Questionnaires

* Before: tab (a) shows *How do you want to create your form?* without the terms dialog
  (accept LOINC, optionally SNOMED CT, once per profile: §1 *First use*). If it offers *start from
  where you left off*, you'll pick **Start from scratch**.
* Live (≈ 10 min), §1 steps 1–12: title `Pathology results`; items and Link Ids `pam-pathology`,
  `pam-hb` (unit `g/L` + Tab), `pam-ferritin` (`ug/L` + Tab), `pam-hb-date`, `pam-ext` (repeats),
  `pam-ext-test` (`coding`, LOINC `718-7` Haemoglobin (Hb), `2276-4` Ferritin), `pam-ext-value`,
  `pam-ext-date`; **Preview**; **Export ▾ → Export to file in FHIR R4 format**.
  Expected: `Pathology-results.R4.json` = `examples/lhc-export-stage1.json`.
* Render: tab (b), paste the export into the JSON editor → **BUILD FORM** (§4 *Alternative to
  step 4*), or pick `pathology-walkthrough-stage1` → **BUILD FORM ▶**.
* Fallback: **Start with existing form → Import from local file** →
  `examples/pathology-walkthrough-stage1.json` (§1 *Fallback*); last resort the screenshots.
* Don't click *Run Validation* (fails on the builder's own `meta.profile`).

### 4. Prepopulation

* Before: `./examples/reset-demo.sh` (latest Hb must be 104, 14 Oct). Tabs (b), (c), (d).
* Browser: open tab (d), §2:
  `https://gw.interop.community/QHConnectathon2026/open/Observation?code=http://loinc.org%7C718-7&patient=pam-demo&_sort=-date&_count=1&_format=json`
  → `total: 2`, one entry `pam-demo-hb-2`, 104 g/L, `2026-10-14T08:45:00+10:00`.
* fhirpath-lab, §3 *Prepopulation*: Ctrl+A/Ctrl+C the Bundle, paste into *Test Resource JSON*,
  Context empty, ▶ after each: `entry.resource` → the Observation; `entry.resource.value` →
  Quantity; `entry.resource.value.value` → `104`;
  `entry.resource.effective.toString().substring(0, 10)` → `2026-10-14`.
* Playground, §4 steps 1–6: gear → *Source FHIR Server URL*
  `https://gw.interop.community/QHConnectathon2026/open` → **?** → **SAVE URL AS SOURCE FHIR
  SERVER** → patient **Demi Formsdemo** (last) → **SAVE**; pick **pathology-walkthrough** →
  **BUILD FORM ▶** (empty) → **POPULATE ▾ → Pre-populate (Replace whole form)** → Hb 104,
  ferritin 18, date 14/10/2026.
* Fallback: screenshots `img/prepop/01`–`10`; `make verify` shows the same expression results.

### 5. Write-back

* Before: `./examples/reset-demo.sh`. Tabs (b), (c); `examples/sample-qr.json` open to copy.
  Playground as left by deck 4 (form built and pre-populated) saves time.
* fhirpath-lab, §3 *Write-back*: paste `sample-qr.json`; *Context Expression*
  `repeat(item).where(linkId='pam-ext')`; then the five template expressions in §3's table →
  Coding 718-7, `98`, `g/L`, `2026-10-27`, `Patient/pam-demo`.
* Playground, §4 steps 7–11: *Results from an external lab*: Test **Haemoglobin (Hb)**, Result
  **98**, Collected **27/10/2026** → **EXTRACT ▾ → Template-based $extract** → **ADVANCED PROPS**
  → **EXTRACT** tab: one `POST Observation`, 98 g/L, `2026-10-27` → **REVIEW WRITE BACK ITEMS** →
  **WRITE BACK (1 ENTRY)** → success snackbar → **POPULATE ▾ → Pre-populate**: Hb 98, 27/10/2026.
* After: `./examples/reset-demo.sh` (step 12).
* Fallback: screenshots `img/writeback/01`–`11`. If write-back fails, stop after the extract
  (step 9): the Bundle is the point; write-back is just a POST of it.

### To do before the decks are final (screenshots by Jim)

- [ ] Meld launcher (§5): `smart/10-meld-apps.png`, `smart/11-meld-launch-patient.png`,
      `smart/12-meld-app-registration.png`. Needs your Meld login.
- [ ] CodeSandbox starter (§6): fork it, check the preview URL form and a Meld launch, then
      `smart/20-codesandbox-files.png`, `smart/21-codesandbox-authorize.png`,
      `smart/22-codesandbox-preview.png`. Automated browsers get a Cloudflare check.
- [ ] Neither set is on a slide yet; add them to `2-smart-apps.md` and run `make check`.

---

## 1. NLM Form Builder (LHC Forms): Questionnaires deck

**URL:** https://formbuilder.nlm.nih.gov/ (redirects to `https://lhncbc.nlm.nih.gov/formbuilder/`).
`formbuilder.lhcforms.nlm.nih.gov` doesn't resolve. On 28 Oct: builder 12.10.0, preview LForms 44.2.0.

**Checked live on 28 Oct 2026**: every step below, in headless Chromium 1600×900, in a browser
profile where you'd already accepted the terms (LOINC and SNOMED CT boxes).
`LHC_PROFILE=<that profile> make shots` repeats the walkthrough and re-takes shots 10–17
(`tools/shoot-lhc.mjs`). It never accepts the terms itself.

**First use in a browser (do this before the session):** the builder opens with *Accept Terms of
Use* (`img/questionnaires/01-lhc-terms.png`). Tick **I accept the LOINC Terms of Use.**
Optionally tick **Optionally, enable SNOMED CT terminology support.**, which shows a second box,
**I accept the SNOMED International SNOMED CT Browser License Agreement.** Tick that too, then
click **Accept**. Accepting is your call as the presenter. The choice is stored in the browser's
localStorage (`acceptedTermsOfUse`), so it's per browser profile: a private window or another
browser asks again. With SNOMED on, *Answer list source* gets an extra *SNOMED answer value set*
button (as in shot 13); nothing else in this demo changes.

### Build the stage 1 form (≈ 10 min live)

1. Open the URL. Optional: **Dismiss** on the yellow NIH banner. Screen: *How do you want to create
   your form?* **Start from scratch** is selected → **Continue**.
   If you've used the builder in this browser before, there's also *Would you like to start from
   where you left off before?*. Pick **Start from scratch**.
2. *Form level attributes*: **Title**: replace `New Form` with `Pathology results`. Leave
   *Status* = draft (`img/questionnaires/10-lhc-new-form.png`). Click **Create questions** (bottom right).
3. The builder adds *Item 0* (type string) and selects it. Left: *Questions Tree*. Right: *Current
   Item*. Set:
   * *Question text*: `Pathology`
   * *Data type*: `group`
   * Click **Advanced fields ⌄** (under *Read only*). *Link Id* shows a random 12-digit number:
     replace it with `pam-pathology`. *Advanced fields* stays open for the next items.
4. In the tree, click **…** (*More options*) on **1 Pathology** → **Insert a new child item**. The
   new item (1.1) is selected:
   * *Question text* `Haemoglobin (Hb)`, *Data type* `decimal`
   * *Units* row (appears for decimal): click the **Display** box, type `g/L`, press **Tab** (don't
     pick from the drop-down). Result: Display *gram per liter*, Code `g/L`, System
     `http://unitsofmeasure.org` (`img/questionnaires/11-lhc-item-editor.png`).
   * *Link Id* `pam-hb` (`img/questionnaires/12-lhc-link-id.png`: the *Extensions* table further
     down shows the `questionnaire-unit` extension the unit became).
5. **…** on **1.1 Haemoglobin (Hb)** → **Insert a new item after this**: `Ferritin`, `decimal`,
   unit: type `ug/L` + **Tab** (→ *microgram per liter*, `ug/L`), *Link Id* `pam-ferritin`.
6. **…** on **1.2 Ferritin** → **Insert a new item after this**: `Date of latest Hb`, `date`,
   *Link Id* `pam-hb-date`.
7. **…** on **1.3 Date of latest Hb** → **Insert a new item after this**: `Results from an
   external lab`, `group`, *Allow repeating question?* **Yes** (a *Repeat count range* Min 0 / Max
   \* row appears), *Link Id* `pam-ext` (`img/questionnaires/14-lhc-repeating-group.png`).
8. **…** on **1.4 Results from an external lab** → **Insert a new child item**: `Test`,
   *Data type* **`coding`**. The builder has no `choice` type: `coding` is exported as `choice` in R4.
   * *Create answer list* **Yes**. *Answer list source*: **Answer options** (already selected).
   * *Answer choices* row 1: *System* `http://loinc.org` (a combo box; just type), *Display*
     `Haemoglobin (Hb)`, *Code* `718-7`. Click **Add another answer**. Row 2: `http://loinc.org`,
     `Ferritin`, `2276-4`. Leave *Score* empty.
   * *Link Id* `pam-ext-test` (`img/questionnaires/13-lhc-answer-options.png`).
9. **…** on **1.4.1 Test** → **Insert a new item after this**: `Result`, `decimal`, *Link Id* `pam-ext-value`.
10. **…** on **1.4.2 Result** → **Insert a new item after this**: `Collected`, `date`, *Link Id* `pam-ext-date`.
11. **Preview** (top right) → *Preview of Questionnaire*, tab *View Rendered Form*: units shown as
    *gram per liter* / *microgram per liter*, *Test* drop-down with *1: Haemoglobin (Hb)* /
    *2: Ferritin*, a **+ Results from an external lab** button that adds a repeat
    (`img/questionnaires/15-lhc-preview.png`). Tab *View/Validate Questionnaire JSON* shows the
    JSON with *R5 Version* / *R4 Version* / *STU3 Version* buttons. **Close**.
12. **Export ▾** (top left) → **Export to file in FHIR R4 format**
    (`img/questionnaires/16-lhc-export-menu.png`). It downloads `Pathology-results.R4.json` (named
    after the title). Expected content: `examples/lhc-export-stage1.json`.

Concepts from the spec that you can show along the way:

* **`required`**: *Answer required* **Yes** on any item adds `"required": true` (checked).
  The stage 1 file has none; set it back to *Unspecified* if you want the export to match.
* **`enableWhen`**: *Advanced fields* → *Conditional method* → **enableWhen condition and
  behavior** (also *enableWhen expression*). Seen, not used in the walkthrough.
* `repeats` (step 7), `answerOption` codings (step 8), the units extension (step 4/12), linkIds
  (every step).

What the form contains (= `examples/pathology-walkthrough-stage1.json`):

| linkId | text | type in builder → R4 | details |
|---|---|---|---|
| `pam-pathology` | Pathology | group | |
| `pam-hb` | Haemoglobin (Hb) | decimal | unit `g/L` (UCUM) |
| `pam-ferritin` | Ferritin | decimal | unit `ug/L` (UCUM) |
| `pam-hb-date` | Date of latest Hb | date | |
| `pam-ext` | Results from an external lab | group | **repeats** |
| `pam-ext-test` | Test | coding → `choice` | answer options, system `http://loinc.org`: `718-7` Haemoglobin (Hb), `2276-4` Ferritin |
| `pam-ext-value` | Result | decimal | |
| `pam-ext-date` | Collected | date | |

**Builder export vs `pathology-walkthrough-stage1.json`** (`examples/lhc-export-stage1.json` is the
real R4 export from the steps above). The `item` tree is the same apart from the unit display text:

| | Builder export | stage 1 file |
|---|---|---|
| `meta.profile` | added: `http://hl7.org/fhir/4.0/StructureDefinition/Questionnaire` | none |
| `id`, `url`, `version`, `name`, `experimental`, `date`, `publisher`, `description` | absent (we only typed a title; *URL*, *Description* and the rest are on *Form level attributes*) | present |
| `title` | `Pathology results` | `Pathology results (walkthrough, stage 1)` |
| unit `display` | `gram per liter`, `microgram per liter` (UCUM names) | `g/L`, `µg/L` |
| unit `system` / `code` | `http://unitsofmeasure.org` `g/L`, `ug/L` | same |
| linkIds | ours, because we typed them (default: random 12-digit numbers) | ours |
| item type | `choice` (builder shows `coding`) | `choice` |
| answer options | `valueCoding` with system, code, display | same |
| `repeats` on `pam-ext` | `true` | same |
| extensions on items | only `questionnaire-unit` | same |

So the builder adds no `lformsVersion`, ids or tags in the R4 export, only `meta.profile`. Meld's
`Questionnaire/$validate` (open endpoint) accepts the export: warnings dom-6 (no narrative) and
que-0 (no `name`) only.

**Gotchas**

* **Link Ids** default to random numbers. Type ours on every item, or the prepopulation and
  write-back decks (which use the real linkIds) won't line up.
* **Units: type, then Tab.** If you pick from the drop-down while typing `g/L`, the first entry
  gives *gram/Liters* with code `g/l` (lower case). Typing and pressing Tab gives code `g/L`. To
  remove a unit use the bin icon: clearing the Display box leaves the code and system behind.
* The builder writes the unit *display* as the UCUM name (*gram per liter*), not `g/L`. The Display
  box is the search box, so you can't type your own display text there.
* **Data type `coding`**, not `choice` (R5 naming); the R4 export says `choice`.
* Tree menu: **…** is at the right of every tree row. *Insert a new item after this* = sibling;
  *Insert a new child item* = inside a group.
* Preview dates are **MM/DD/YYYY** (US).
* **Run Validation** (Preview → *View/Validate Questionnaire JSON* → *R4 Version*) fails with
  *Error: Invalid profile. Failed to retrieve profile with
  url=http://hl7.org/fhir/4.0/StructureDefinition/Questionnaire*: the builder's own
  `meta.profile`. Don't click it on stage.
* The builder keeps the current form in localStorage and offers *start from where you left off*
  next time. Fine for a dry run; on stage choose *Start from scratch*.
* *Export* also offers *Create a new questionnaire on a FHIR server...*; *Update the questionnaire
  on the server (https://lforms-fhir.nlm.nih.gov/baseR5)* is greyed out. Neither was tried. To
  render the export, paste it into the Smart Forms playground's JSON editor (section 4,
  *Alternative to step 4*).

**Fallback (if building runs long or the UI has changed): import the stage 1 file**

* From the start screen: **Start with existing form** → **Import from local file** (selected)
  → **Continue** → file dialog → `examples/pathology-walkthrough-stage1.json`
  (`img/questionnaires/17-lhc-import-existing.png`). It opens on *Form level attributes* with title
  *Pathology results (walkthrough, stage 1)*. Click **Edit questions** for the tree.
* From inside the builder: **Import ▾** → **Import from file...** → file dialog → *Replace existing
  form?* → **Continue**.
* Round trip checked: importing the stage 1 file and exporting R4 gives the same JSON, plus
  `meta.profile`.
* *Import from FHIR server* and *Import from LOINC* are also on the start screen (not tried).
* Last resort: show `examples/pathology-walkthrough-stage1.json` and render it in the Smart Forms
  playground (section 4, pick `pathology-walkthrough-stage1`,
  `img/questionnaires/02-playground-stage1.png`).

---

## 2. Meld open endpoint in a browser: Prepopulation and SMART decks

**URL to paste** (latest Hb for pam-demo):

```
https://gw.interop.community/QHConnectathon2026/open/Observation?code=http://loinc.org%7C718-7&patient=pam-demo&_sort=-date&_count=1&_format=json
```

Expected: a searchset Bundle, `total: 2`, one entry `Observation/pam-demo-hb-2`, value 104 g/L,
`effectiveDateTime` `2026-10-14T08:45:00+10:00` (`img/prepop/01-query-in-browser.png`).
SMART deck variant without `_count=1` (both Hb results): `img/smart/01-hb-search-open.png`.

Gotchas:

* **`|` must be typed as `%7C`.** A raw `|` gets HTTP 400 with an empty body, on `/open` as well
  as `/data`. `code=718-7` (no system) also works.
* **Add `&_format=json`.** Without it the browser gets XML (`application/fhir+xml`) and
  Chrome/Edge download a file instead of showing it.
* `total` counts all matches (2); `_count=1` only limits the page. `_sort=-date` puts the latest first.

---

## 3. fhirpath-lab: building and testing expressions (only expressions)

**URL:** https://fhirpath-lab.com/FhirPath

Layout (wide window): left = *Context Expression (optional)*, *Fhirpath Expression*, *RESULTS*;
right = *Test Resource JSON* editor. Engine defaults to **R4 / fhirpath.js** (shows
`fhirpath.js-4.5.1 (r4b)`). **Results don't update while you type**: click **▶** (top right;
tooltip "press alt+g to go") or press Ctrl+Enter.

To paste a resource: click in *Test Resource JSON*, Ctrl+A, paste. The header then says
*(local resource JSON)*.

### Prepopulation (paste the Bundle from section 2)

1. Copy the JSON from the browser tab in section 2 and paste it into *Test Resource JSON*.
   Leave *Context Expression* empty. To copy it in Chrome/Edge, click in the page, then Ctrl+A,
   Ctrl+C. The page text starts at `{`; the *Pretty-print* checkbox isn't part of it. Meld already
   indents the JSON.
2. Expression `entry.resource` → ▶ → the Observation `pam-demo-hb-2`
   (`img/prepop/02-fhirpath-lab-entry-resource.png`).
3. `entry.resource.value` → ▶ → a Quantity: `{"value":104,"unit":"g/L","system":"http://unitsofmeasure.org","code":"g/L"}`
   (`img/prepop/03-fhirpath-lab-value.png`).
4. `entry.resource.value.value` → ▶ → `104` (`img/prepop/04-fhirpath-lab-value-value.png`).
5. `entry.resource.effective.toString().substring(0, 10)` → ▶ → `2026-10-14` (String)
   (`img/prepop/05-fhirpath-lab-hb-date.png`).

In the form these become `%latestHb.entry.resource.value.value` and
`%latestHb.entry.resource.effective.toString().substring(0, 10)`.

### Write-back (paste `examples/sample-qr.json`)

1. Paste `examples/sample-qr.json` into *Test Resource JSON*. Its full text:

<details><summary>examples/sample-qr.json</summary>

```json
{
  "resourceType": "QuestionnaireResponse",
  "status": "completed",
  "questionnaire": "https://aehrc.github.io/qh-connectathon/track1/Questionnaire/pathology-walkthrough|0.1.0",
  "subject": {
    "reference": "Patient/pam-demo"
  },
  "authored": "2026-10-28T10:30:00+10:00",
  "item": [
    {
      "linkId": "pam-pathology",
      "text": "Pathology",
      "item": [
        {
          "linkId": "pam-hb",
          "text": "Haemoglobin (Hb)",
          "answer": [
            {
              "valueDecimal": 104
            }
          ]
        },
        {
          "linkId": "pam-ferritin",
          "text": "Ferritin",
          "answer": [
            {
              "valueDecimal": 18
            }
          ]
        },
        {
          "linkId": "pam-hb-date",
          "text": "Date of latest Hb",
          "answer": [
            {
              "valueDate": "2026-10-14"
            }
          ]
        },
        {
          "linkId": "pam-ext",
          "text": "Results from an external lab",
          "item": [
            {
              "linkId": "pam-ext-test",
              "text": "Test",
              "answer": [
                {
                  "valueCoding": {
                    "system": "http://loinc.org",
                    "code": "718-7",
                    "display": "Haemoglobin (Hb)"
                  }
                }
              ]
            },
            {
              "linkId": "pam-ext-value",
              "text": "Result",
              "answer": [
                {
                  "valueDecimal": 98
                }
              ]
            },
            {
              "linkId": "pam-ext-date",
              "text": "Collected",
              "answer": [
                {
                  "valueDate": "2026-10-27"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

</details>

2. *Context Expression*: `repeat(item).where(linkId='pam-ext')`. Results then show
   *Context: QuestionnaireResponse.item[0].item[3]*. The template's expressions run on the
   `pam-ext` repeat, as the extract does for an item with `templateExtract`
   (`expressions.json` id `ext-context`).
3. Expressions (from `examples/expressions.json`), each followed by ▶:

| Expression | Result | Screenshot |
|---|---|---|
| `item.where(linkId='pam-ext-test').answer.value` | Coding `http://loinc.org` `718-7` Haemoglobin (Hb). The template takes its `.code` and `.display` (→ `code.text`), so the Observation passes AU Core | `writeback/01-fhirpath-lab-ext-code.png` |
| `item.where(linkId='pam-ext-value').answer.value` | `98` | `writeback/02-fhirpath-lab-ext-value.png` |
| `iif(item.where(linkId='pam-ext-test').answer.value.code = '718-7', 'g/L', iif(item.where(linkId='pam-ext-test').answer.value.code = '2276-4', 'µg/L', iif(item.where(linkId='pam-ext-test').answer.value.code = '14801-5', '%', 'mg/L')))` | `g/L` | `writeback/03-fhirpath-lab-ext-unit.png` |
| `item.where(linkId='pam-ext-date').answer.value.toString()` | `2026-10-27` | `writeback/04-fhirpath-lab-ext-date.png` |
| `%resource.subject.reference` | `"Patient/pam-demo"` | `writeback/05-fhirpath-lab-ext-subject.png` |

`%resource` = the pasted resource (the QR); it works without setting anything.
fhirpath-lab note: *variables are not supported in the context expression*. Other `%names` used
in the main expression appear on a **Variables** tab (left), where you type their values (per
fhirpath-lab's source; not tried live).

Fallback: `make verify` runs the same expressions locally (fhirpath.js 5.2.2) with the same results.

---

## 4. Smart Forms playground: render, prepopulate, extract, write back

**Use the patched build: https://aehrc.github.io/qh-connectathon/smart-forms/playground**

* That deep link works in a browser, and so does a page refresh on it. GitHub Pages has no
  `/playground` file, though: it answers **HTTP 404** and serves the app's `404.html` SPA
  fallback, which renders the playground. Verified with Chromium on 28 Oct: status 404, page shows
  *Playground [^1.5.0]*, same after reload. curl and link checkers report 404.
* **Reliable route if the deep link misbehaves** (e.g. a proxy that replaces 404 pages): open
  **https://aehrc.github.io/qh-connectathon/smart-forms/** (HTTP 200). It goes to
  *dashboard/questionnaires*. Click **GO TO PLAYGROUND** in the left sidebar.
* The demos use **the patched build already deployed on `gh-pages`**
  (`apps/smart-forms`, `apps/deploy-pages.sh`). No rebuild or redeploy is needed. Don't redeploy
  before the session: a redeploy that changes `config.json` (forms server = Meld open endpoint)
  would break the picker in step 4.

**Not** `https://smartforms.csiro.au/playground`: the public build can't read anything from
Meld (see Surprises 1). The patched build is the same playground (header *Playground [^1.5.0]*).
Its forms server is the Meld open endpoint, so our questionnaires are in its picker.
Settings persist in the browser's localStorage.

1. Click the **gear** (top right) → *Launch Context Settings*.
2. *Source FHIR Server URL*: replace `https://hapi.fhir.org/baseR4` with
   `https://gw.interop.community/QHConnectathon2026/open`. Click the **?** icon at the right of the
   field (validates; shows *URL validated* and a green tick), then **SAVE URL AS SOURCE FHIR SERVER**.
   The SAVE URL button stays disabled until you validate.
3. *Selected Patient* dropdown → **Demi Formsdemo** (the **last** of 42 names; scroll down)
   (`img/prepop/06-playground-patient-list.png`). Shows ID `pam-demo`, female, 1961-04-09.
   *Selected Encounter*: "No encounters available for this patient" (fine).
   → **SAVE** (`img/prepop/07-playground-settings.png`). The header shows *Patient: Demi Formsdemo*.
4. *Or... pick a Questionnaire from our Forms Server*: click the box, choose
   **pathology-walkthrough** (or type it). Shows ID, title, canonical URL, version 0.1.0,
   resolvable URL (`img/prepop/08-playground-pick-form.png`). → **BUILD FORM ▶** (under the details).
5. The form renders **empty**; nothing is prepopulated automatically (`img/prepop/09-playground-built.png`).
6. **POPULATE ▾** → **Pre-populate (Replace whole form)**. Hb **104** g/L, ferritin **18** µg/L,
   date of latest Hb **14/10/2026** (`img/prepop/10-playground-prepopulated.png`). Network:
   `GET .../open/Observation?code=http://loinc.org%7C718-7&patient=pam-demo&_sort=-date&_count=1` → 200
   (the patched build encodes the `|`).

Write-back, continuing from 6:

7. *Results from an external lab*: Test = **Haemoglobin (Hb)**, Result **98**, Collected
   **27/10/2026** (type DD/MM/YYYY) (`img/writeback/06-playground-filled.png`). The *Result* field has no unit
   (the template computes it).
8. **EXTRACT ▾** → **Template-based $extract [^1.0.16]** (`img/writeback/07-playground-extract-menu.png` was meant to
   show the open menu but the capture missed it: it shows the filled form, as in 06; not used in the decks).
   Snackbar: *Successful template-based extraction. See Advanced Properties > Extracted to view
   extracted bundle.* (The other entries: Observation-based, Definition-based are greyed out,
   StructureMap-based struck through, plus *Template-based $extract (modified only)*.)
9. **ADVANCED PROPS** (right panel header) → tab **EXTRACT** → **TemplateExtractResult**: a
   `transaction` Bundle with one `POST Observation` (conforms to AU Core Pathology Result):
   LOINC 718-7 (no display; *Haemoglobin (Hb)* in `code.text`), subject `Patient/pam-demo`,
   valueQuantity 98 g/L (UCUM), `effectiveDateTime` `2026-10-27`
   (`img/writeback/08-playground-extracted-bundle.png`; taken before the AU Core change, so it still
   shows the label as `coding.display`).
   The **QR** tab shows the QuestionnaireResponse (same content as `examples/sample-qr.json`;
   see Surprises 7).
10. **REVIEW WRITE BACK ITEMS** (bottom right) → dialog *Select items to write back to patient
    record*: Haemoglobin (Hb), Observation, `new` (`img/writeback/09-playground-write-back-dialog.png`)
    → **WRITE BACK (1 ENTRY)**. Snackbar: *Write back to https://gw.interop.community/QHConnectathon2026/open
    successful. See Network tab for response* (`img/writeback/10-playground-write-back-ok.png`).
    It POSTs the Bundle to the source FHIR server; the new Observation gets a server id (e.g. `694`).
11. Close the loop: **POPULATE ▾ → Pre-populate** again. Hb **98**, date **27/10/2026**; ferritin
    still 18 (`img/writeback/11-playground-close-the-loop.png`).
12. Afterwards: `./examples/reset-demo.sh`.

Alternative to step 4: paste a Questionnaire's JSON into the editor on the right (or drop a file
on the dashed box), then click **BUILD FORM** in the right panel's header.
**DESTROY FORM** returns to the picker.

The JSON editor takes the right half of the screen. I found no button that hides it; the icons
at the top right are readOnly display, quantity comparator, *show all items regardless of
enableWhen* and **Format JSON**. **ADVANCED PROPS** replaces it with the store viewer, and **SHOW
EDITOR** brings it back. For a cleaner view of the prepopulated form, zoom the browser or crop.

**Fallbacks:** if the patched build is down, `https://fhir-in-qh.smartforms.io/playground` (the
2025 connectathon build, *Playground [^1.0.0-alpha.107]*) can list Meld patients, but it sends a
raw `|`, so prepopulation fails unless the x-fhir-query uses `%7C` or a code without its system
(Surprises 2). Last resort: show the screenshots.

---

## 5. Meld launcher: SMART deck (screenshot by Jim)

Not automated (needs your Meld login). Screenshots to take, into `img/smart/`:

* `smart/10-meld-apps.png` (screenshot by Jim): the sandbox's Apps page with the app registration.
* `smart/11-meld-launch-patient.png` (screenshot by Jim): launch dialog with a patient selected (no patient = blank page).
* `smart/12-meld-app-registration.png` (screenshot by Jim): app registration form (launch URI, comma-separated redirect URIs, SMART v1 scopes).

---

## 6. CodeSandbox SMART starter: SMART deck (screenshot by Jim)

**URL:** https://codesandbox.io/p/sandbox/smart-on-fhir-0rd1q

**Not run by us.** CodeSandbox (page and API) shows a Cloudflare bot check (*Performing security
verification*) to automated browsers; `tools/shoot-codesandbox.mjs` only reports whether the
check is still there. The source files (`src/index.js`, `src/App.jsx`, `package.json`) came from
you; the SMART deck's *The starter* and *Fix* slides are based on them: `FHIR.oauth2.init({
clientId, scope })` with another app's client id and scope `launch/patient openid profile`.
**Unverified:** that a fork's preview URL has the form `https://<id>.csb.app/` (the deck's
example), and a Meld launch of a fixed fork.

To do by hand before the SMART deck is final: fork it, check the preview URL, launch it from Meld
with a patient selected, and take:

* `smart/20-codesandbox-files.png` (screenshot by Jim): file tree with the entry file open.
* `smart/21-codesandbox-authorize.png` (screenshot by Jim): the `FHIR.oauth2.init` call.
* `smart/22-codesandbox-preview.png` (screenshot by Jim): the preview pane / preview URL.

---

## Screenshot index

| File | Shows |
|---|---|
| `questionnaires/01-lhc-terms.png` | NLM Form Builder opening dialog (LOINC Terms of Use) |
| `questionnaires/02-playground-stage1.png` | Stage 1 form rendered in the playground |
| `questionnaires/03-playground-lhc-export.png` | Builder's R4 export (`lhc-export-stage1.json`) pasted into the playground and built (`tools/shoot-questionnaires-playground.mjs`) |
| `questionnaires/04-playground-enablewhen-before.png` | enableWhen illustration (deck only): *Result* hidden before a test is chosen |
| `questionnaires/05-playground-enablewhen-after.png` | ... and shown after choosing Haemoglobin (Hb) |
| `questionnaires/10-lhc-new-form.png` | Form Builder: *Form level attributes*, title `Pathology results` |
| `questionnaires/11-lhc-item-editor.png` | Haemoglobin (Hb): decimal, unit g/L (UCUM); full question tree on the left |
| `questionnaires/12-lhc-link-id.png` | *Advanced fields*: Link Id `pam-hb`, and the `questionnaire-unit` extension |
| `questionnaires/13-lhc-answer-options.png` | Test (`coding`): answer options with system `http://loinc.org`, 718-7 / 2276-4 |
| `questionnaires/14-lhc-repeating-group.png` | Results from an external lab: group, *Allow repeating question?* Yes |
| `questionnaires/15-lhc-preview.png` | Preview: rendered form, Test drop-down open with the two LOINC answers |
| `questionnaires/16-lhc-export-menu.png` | Export menu, *Export to file in FHIR R4 format* highlighted |
| `questionnaires/17-lhc-import-existing.png` | Fallback: *Start with existing form* → *Import from local file* |
| `prepop/01-query-in-browser.png` | Latest-Hb search on the open endpoint, JSON in the browser |
| `prepop/02-fhirpath-lab-entry-resource.png` | fhirpath-lab: `entry.resource` on the Bundle |
| `prepop/03-fhirpath-lab-value.png` | `entry.resource.value` → Quantity |
| `prepop/04-fhirpath-lab-value-value.png` | `entry.resource.value.value` → 104 |
| `prepop/05-fhirpath-lab-hb-date.png` | `...effective.toString().substring(0, 10)` → 2026-10-14 |
| `prepop/06-playground-patient-list.png` | Playground settings: patient list, Demi Formsdemo last |
| `prepop/07-playground-settings.png` | Settings: Meld open endpoint validated, pam-demo selected |
| `prepop/08-playground-pick-form.png` | pathology-walkthrough picked from the forms server |
| `prepop/09-playground-built.png` | Form built, empty |
| `prepop/10-playground-prepopulated.png` | After Pre-populate: 104, 18, 14/10/2026 |
| `writeback/01-fhirpath-lab-ext-code.png` | `ext-code` on sample-qr.json, pam-ext context → LOINC 718-7 |
| `writeback/02-fhirpath-lab-ext-value.png` | `ext-value` → 98 |
| `writeback/03-fhirpath-lab-ext-unit.png` | `ext-unit` → g/L |
| `writeback/04-fhirpath-lab-ext-date.png` | `ext-date` → 2026-10-27 |
| `writeback/05-fhirpath-lab-ext-subject.png` | `%resource.subject.reference` → Patient/pam-demo |
| `writeback/06-playground-filled.png` | External result Hb 98 on 27/10/2026 entered |
| `writeback/07-playground-extract-menu.png` | Meant to be the EXTRACT menu; the menu wasn't captured, so it shows the filled form as in 06 (not used in decks) |
| `writeback/08-playground-extracted-bundle.png` | TemplateExtractResult: the Observation |
| `writeback/09-playground-write-back-dialog.png` | Write-back review dialog |
| `writeback/10-playground-write-back-ok.png` | Write-back success snackbar |
| `writeback/11-playground-close-the-loop.png` | Re-populated: latest Hb 98, 27/10/2026 |
| `smart/01-hb-search-open.png` | All Hb Observations for pam-demo on the open endpoint |

---

## Surprises

1. **The public Smart Forms playground (`smartforms.csiro.au/playground`) can't use Meld.** It
   sends `Cache-Control: no-cache` on FHIR requests. Meld's CORS preflight doesn't allow that header
   (`access-control-allow-headers: X-FHIR-Starter,authorization,Prefer,Origin,Accept,X-Requested-With,Content-Type,...`),
   so `Patient?_count=100` fails (`net::ERR_FAILED`) and the settings dialog says *No patients
   available*. No patient means no prepopulation, and write-back would hit the same problem.
   Only `metadata` works, so the URL still validates. Our patched build
   (`aehrc.github.io/qh-connectathon/smart-forms/playground`, already deployed on gh-pages)
   drops that header and encodes `|`. Everything in section 4 works there. That URL is served
   via the Pages 404 SPA fallback (HTTP 404, renders fine in browsers). The reliable route is
   `/smart-forms/` → **GO TO PLAYGROUND**.
2. **Raw `|` in the x-fhir-query:** tested on the unpatched 2025 build
   (`fhir-in-qh.smartforms.io/playground`, which can list Meld patients): `code=http://loinc.org|718-7`
   → request fails (400, reported as CORS), form stays empty. **Both workarounds work** there:
   `code=http://loinc.org%7C718-7` → 200, Hb 104; `code=718-7` → 200, Hb 104 (tested on temporary
   copies; `examples/` unchanged). With the patched build no workaround is needed.
3. **Opening a Meld search URL in a browser downloads a file** (XML) unless you add `&_format=json`.
4. **LHC Form Builder URL** in the brief (`formbuilder.lhcforms.nlm.nih.gov`) doesn't resolve; use
   `https://formbuilder.nlm.nih.gov/`. It opens with a LOINC Terms of Use dialog (per browser
   profile; the presenter accepts it on first use). Everything in the spec's Questionnaires deck
   works in the builder: UCUM units, answer options with a system, repeats, our linkIds,
   `required`, R4 export, and importing the stage 1 file. Differences from the spec's
   assumptions: the type is called **`coding`** (R4 export: `choice`); linkIds default to random
   numbers; unit display is the UCUM name (*gram per liter*), not `g/L`; *Run Validation* fails
   on the builder's own `meta.profile`. Export vs stage 1 file: section 1.
5. **CodeSandbox blocks automated browsers** (Cloudflare check, also on its API), so the starter
   was never run here; its code came from Jim (section 6).
6. **fhirpath-lab doesn't evaluate as you type** (▶ / Ctrl+Enter), and its fhirpath.js is 4.5.1
   (r4b) vs 5.2.2 in `make verify`. Results are the same for all our expressions.
7. The playground's QuestionnaireResponse matches `sample-qr.json` in items and answers but has
   `status: in-progress`, no `authored`, `subject` with `type: "Patient"` and
   `display: "Demi Formsdemo"`, and `meta.source: https://smartforms.csiro.au`. The extracted
   Observation is as expected (`effectiveDateTime: "2026-10-27"`, date only).
8. The playground doesn't prepopulate on Build. You have to choose *POPULATE → Pre-populate*.
   No SMART launch is needed: the settings dialog's patient picker sets `%patient`.
