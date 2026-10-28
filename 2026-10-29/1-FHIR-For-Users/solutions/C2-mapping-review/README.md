# C2 Mapping review: critique of `FHIR-Mapping-DRAFT.md`

**Status: verified.** This is a review, so it has no app or form to run. Every code and value-set
claim was checked on Ontoserver (`r4.ontoserver.csiro.au`, SNOMED CT-AU 20260930, LOINC 2.83) with
[`check-codes.py`](check-codes.py), which gives ALL PASS ([`check-codes-output.txt`](check-codes-output.txt)).
FHIR R4 and AU Core 2.0.0 claims were checked against the published pages (cited inline). The
clinical thresholds were reasoned from the cited sources but not confirmed with Metro North. Nothing
was written to Meld.

Deliverables:

| File | What |
|---|---|
| `README.md` | (1) A row-by-row critique of the draft mapping. (2) The **consistency table**: every place the solutions disagree with each other or with the mapping, each with one recommended answer and the files to change. (3) What `data/generate.py` would need to change. (4) The decisions for the track leads. |
| [`FHIR-Mapping-PROPOSED.md`](FHIR-Mapping-PROPOSED.md) | The revised mapping, in the draft's format, with these recommendations applied. |
| `check-codes.py`, `check-codes-output.txt` | The terminology evidence. Re-run it with `python3 check-codes.py`. |

**Inputs.** I read the draft mapping, `Scenarios.md`, `data/generate.py` and the generated bundle,
`questionnaires/build.py` (root variables and the starter rules), `apps/pam-dashboard`, and every
solution README: A5–A9, A11 and B1–B9. A1–A4 had **no README** when I reviewed them, so I inspected
their Questionnaire JSON directly (templates, value sets, queries) and included what was relevant.
A `C1-closed-loop/` folder appeared during the review. I did not review it, but it uses TSAT 2502-3
(see K19).

---

## 1. Headline findings

1. **The anaemia rule contradicts itself.** The draft says "Hb *below* the threshold (*≤*130 / *≤*120)".
   A6 and the starter module use ≤, while B1, B2, B6 and B9 use <. WHO defines anaemia as Hb < 130 g/L
   (men) and < 120 g/L (non-pregnant women), so use **<**. The synthetic data is never within 3 g/L of
   a threshold, which is why nobody noticed.
2. **The TSAT LOINC code is not the Australian one.** The data, the starter forms and every solution
   use 2502-3 *Iron saturation [Mass Fraction]*. That code is **not** in the RCPA SPIA reporting
   value set, which AU Core Pathology Result binds `code` to (extensible). SPIA has **14801-5**
   *Iron saturation [Molar fraction] in Serum or Plasma*. Write 14801-5, and read both.
3. **The Task due date is in the wrong element in the draft.** R4 `Task.executionPeriod` records when
   work was actually done. `Task.restriction.period` is "over what time-period fulfillment is sought",
   and R4 comments that "period.high is the due date". The data, A9, B1 and B2 already use
   `restriction.period.end`, so only the mapping is wrong.
4. **"Initial vs post-treatment" has four definitions.** A5 anchors on the most recent IV iron order,
   B6 on the earliest. B1, B9 and the dashboard use earliest vs latest result. Pick one (§3, K4).
5. **Iron deficiency in the SNOMED hierarchy.** `35240004 |Iron deficiency|` has **no descendants**
   in SNOMED CT-AU. *Iron deficiency anaemia* (87522002) and *Iron deficiency without anaemia*
   (234340006) are not under it. A6's "Other diagnosis" ECL `<< 271737000 OR << 35240004` therefore
   cannot offer 234340006. The data codes "iron deficiency without anaemia" as the vaguer 35240004.
6. **MedicationRequest dosage has two shapes.** The data puts the whole Ganzoni dose in one
   `dosageInstruction`: 15 of the 21 ferric carboxymaltose orders exceed the 1000 mg per-infusion
   maximum. A7 writes one `dosageInstruction` per infusion. B1 and B9 read `dosageInstruction[0]`, so
   for A7's orders they would report only the first infusion.
7. **The pathway logic differs between A6 and B1.** When ferritin is 100–300, TSAT < 20% and CRP > 10,
   A6 says *anaemia of chronic disease* (matching all 40 recorded diagnoses), but B1 says *iron
   deficiency anaemia* (`pam-008` is shown inconsistently). The draft defines the three findings but
   not the pathway that combines them. The proposal adds A6's table.
8. **Directorate has no home.** It is not in the data. B8 hard-codes a made-up lookup. The data also
   puts the surgical units `partOf` the *blood management service*, which is wrong. Model directorates
   as Organizations, with units `partOf` them. B8 already showed that the chained search
   `performer:Organization.partof` works on Meld.
9. **Blood-product refusal is coded two ways.** A6 lists *declined* products as product concepts
   (126242007 …). A11 lists *accepted* products as **procedure** concepts (116863004 *Transfusion of
   red blood cells* …), with different local consent and reason code systems. Use one shared value
   set.
10. **The interpreter extension differs.** A1 uses the core `patient-interpreterRequired`, which is
    what AU Core 2.0.0 uses. A11 uses the older AU Base `interpreter-required`. A11 should change.

Smaller items: A4 uses an **inactive** concept, 103693007 *Diagnostic procedure* (inactivated
2023-04-30). A7's value set URL omits the SNOMED CT-AU edition. B4, B1 and B9 treat every Condition
as a PAM diagnosis, so A4's history Conditions would leak in. The recommended treatment (PAM 14) is
only "an IV iron order exists", because A7 doesn't write the rest of the treatment plan. Write-backs
are not idempotent (A5, A6). AU Core's `MedicationRequest.requester` is 1..1, but A7 fills it only
when the response has an author.

---

## 2. Row-by-row critique of the draft

Evidence key: **[R4]** FHIR R4 spec; **[AUC]** AU Core 2.0.0 (hl7.org.au/fhir/core); **[TX]** checked on
Ontoserver by `check-codes.py`; **[S]** solution README / JSON; **[D]** `data/generate.py`.

### Resources table

**Patient details → Patient**
* *Right:* Patient, with Indigenous status, interpreter and Medicare number. AU Core Patient has
  `indigenous-status` (Must Support, required binding to `australian-indigenous-status-1`) and a
  Medicare identifier slice (type MC, system `http://ns.electronichealth.net.au/id/medicare-number`)
  [AUC]. The data's identifier matches [D].
* *Ambiguous:* "Interpreter needed … per AU Base". AU Core 2.0.0 uses the **core** extension
  `http://hl7.org/fhir/StructureDefinition/patient-interpreterRequired` [AUC]. A1 uses it, but A11
  reads the AU Base `http://hl7.org.au/fhir/StructureDefinition/interpreter-required` [S]. The
  mapping doesn't say where the preferred language goes. A1 and A11 both read `Patient.communication`
  (`common-languages-australia-2`).
* *Missing in the data:* Indigenous status, interpreter, language, telecom and `generalPractitioner`
  [D]. A1 and A11 pre-populate fields that no synthetic patient has.
* **Recommend:** name the URLs of all three extensions, and say that IHI is preferred over Medicare
  where known [AUC].

**GP → Practitioner / PractitionerRole via `Patient.generalPractitioner`**
* *Right:* the element. *Ambiguous:* Practitioner or PractitionerRole? A2 writes a **PractitionerRole**
  (with practice, Medicare provider number and SNOMED 62247001 *General practitioner*) and reads
  either [S]. **Recommend PractitionerRole**: the provider number and practice belong to the role.
* A2 also uses an admission `Encounter` (class IMP) as one GP source. The mapping doesn't mention
  Encounter, and the data has none.

**Surgical waitlist entry → ServiceRequest**
* *Right:* ServiceRequest with a SNOMED procedure, `occurrenceDateTime` for the booked date,
  `performer` for the unit and `requester` for the surgeon. All of A3, A8, B2, B4, B5, B7, B8 and B9
  read it that way [S].
* *Open question answered:* **"Elective category: `priority` or an extension?"** Neither.
  `ServiceRequest.priority` has a *required* binding (routine | urgent | asap | stat) [R4] and can't
  hold Category 1/2/3. An extension has no search parameter, which breaks B8's server-side filters.
  Every solution already uses **`ServiceRequest.category`** with a local code system
  (`…/CodeSystem/elective-category` 1/2/3), and the presence of that system is how apps tell a
  waitlist entry from other ServiceRequests [S]. **Recommend keeping `category`.** Document the codes
  as the national *elective surgery clinical urgency category* (METeOR); there is no FHIR code system
  for it on Ontoserver. I searched and found none.
* *Gap:* directorate. See K11.

**Referral to blood management → ServiceRequest (`basedOn` / `supportingInfo` → waitlist entry)**
* *Wrong (half of it):* `basedOn` means "this request fulfils that plan or order" [R4]. The referral
  doesn't fulfil the surgery. **`supportingInfo` is right**, and every solution and the data use it
  [S][D]. Remove `basedOn`.
* *Open question answered:* **"Referral source as `requester` or a coded extension?"** Both, for
  different jobs. `requester` should be the actual referrer, a Practitioner or PractitionerRole. The
  source *kind* (surgeon / pre-admission clinic / anaesthetist / GP) goes in `category` with the local
  `referral-source` system. That is searchable, and B5, B8 and B9 use it [S]. In the data,
  `requester` is **always the surgeon**, including the 19 referrals whose source is something else.
  The data should change.
* *Missing:* the code. Everyone uses SNOMED `3457005 |Patient referral|` [TX]. Write it in, together
  with `performer` = the blood management service, because 3457005 on its own would also match
  unrelated referrals.
* *Status:* the data has every referral `completed`, including the 8 whose episode is still active.
  A3 writes `active`. Recommend `active` while the episode is open and `completed` when it's
  finished.

**"Being managed" / "cleared" → EpisodeOfCare (`status`, `period`)**
* *Right:* `active` = being managed, `finished` = cleared, and days with the team = period length.
* *Ambiguous:* which other statuses count as "being managed". B2 counts only `active`; B3 also counts
  `planned`, `waitlist` and `onhold` [S]. Days for an open episode are counted to *today*, in B1, B3
  and A9. The mapping doesn't say how to identify a PAM episode: everyone uses `type` with local
  `episode-type#pam`. Write that in.
* *Missing:* `EpisodeOfCare.diagnosis` → the PAM Condition. B4 has to guess the diagnosis by patient
  and date [S]. `referralRequest` → the referral is in the data but not in the mapping.

**Follow-up → Task (`for`, `executionPeriod`, `focus` → EpisodeOfCare)**
* *Wrong:* `executionPeriod` for the due date. See finding 3: use **`restriction.period.end`** [R4].
* *Right:* `for` and `focus` → EpisodeOfCare. *Add:* `owner` (the care manager), `code` (local
  `task-type#follow-up`), `note` (previous notes, which A9 reads), and the open statuses (requested,
  received, accepted, ready, in-progress, on-hold).

**Pathology results → Observation (LOINC)**
* *Right:* LOINC, `category` laboratory. *Add:* AU Core Pathology Result (`au-core-diagnosticresult-path`)
  requires `category` laboratory, `effective[x]` to at least day precision, and `code` from **RCPA SPIA**
  (extensible); `performer` (the lab) is Must Support [AUC]. The data has no `performer`. A5 writes
  the lab as `performer.display` [S].
* Units: UCUM g/L, ug/L, %, mg/L, fL, pmol/L, nmol/L, mL/min/{1.73_m2}. The data and A5 agree.

**Height, weight → Observation (vital signs)**
* *Right.* LOINC 8302-2 and 29463-7, category `vital-signs`, UCUM cm and kg, as in the data and A1
  [TX][D][S]. That satisfies the R4 vital signs profile and AU Core body height / weight. BMI
  (39156-5) is calculated, not stored. Say so.

**Diagnosis → Condition (SNOMED CT-AU), "value set to be defined on Ontoserver"**
* *Right:* Condition with SNOMED CT-AU codes. All the codes in use are in AU Core's
  `clinical-condition-1` [TX].
* *Wrong or missing:* the value set. A6's ECL misses 234340006 (finding 5) [TX]. **Recommend** the
  ECL `<< 271737000 |Anaemia| OR 35240004 |Iron deficiency| OR << 234340006 |Iron deficiency without
  anaemia|`, and use 234340006 for the "iron deficiency, no anaemia" pathway.
* *Ambiguous:* category. Data and A6 use `encounter-diagnosis`; A4 uses `problem-list-item` for
  history [S]. Both are allowed by AU Core [AUC]. Make it the rule: PAM diagnoses are
  `encounter-diagnosis`, and history is `problem-list-item`. Apps should select PAM diagnoses by that
  rule and the value set (or `EpisodeOfCare.diagnosis`), not "any Condition" as B1, B4 and B9 do now.

**Past medical / surgical history → Condition, Procedure**
* *Right.* A4 also reads MedicationStatement and AllergyIntolerance (from the scenario), which the
  mapping doesn't list. Add them. A4's endoscopy template uses the **inactive** 103693007 as
  `Procedure.category` [TX]: drop it or use an active concept.

**IV iron treatment → MedicationRequest (AMT); infusion booking: ServiceRequest or Appointment**
* *Right:* MedicationRequest with an AMT code. Both data codes are in `australian-medication-1`, the
  required binding of AU Core `coding:amt` [TX][AUC].
* *Open question answered:* **ServiceRequest** for the booking. The nurse requests it; the day unit
  books an Appointment `basedOn` that ServiceRequest. Use SNOMED 718520009 *Intravenous iron
  infusion*, with `basedOn` → the MedicationRequest. A7 does exactly this [S].
* *Missing:* the dosage shape (K8), the status lifecycle (K9), the requester, which AU Core makes
  1..1 [AUC], the infusion date (MedicationAdministration, when it is given), and a value set for "IV
  iron" that apps can share (K5).

**Limited consent / refusal of blood products → Flag "Or Consent?"**
* *Answer:* **Flag** (category `safety`) for the alert. That's what A6 does. A Consent resource can
  come later, if per-product consent becomes a record and not just an alert.
* *Missing:* the codes. A6: 699054003 *Administration of blood product declined*, or 708129006 for a
  religious reason [TX]. Product codes: K16.

**Requested target Hb → Goal**
* *Right.* A6: target `measure` LOINC 718-7, `detailQuantity` `>=` in g/L, `dueDate` = surgery date [S].
* *Ambiguous:* this is **not** the Ganzoni target Hb, which A7 fixes at 150 g/L as a formula
  constant. Say so, so nobody wires the Goal into the dose. Add `Goal.addresses` → the Condition.

**Patient education → Communication or Procedure**
* *Ambiguous:* "or" means apps can't count it. **Recommend Procedure**: `code` 311401005 *Patient
  education*, `category` 409073007 *Education* (311401005 is a descendant of it [TX]),
  `performedDateTime`, one `usedCode` per material. A Communication (`partOf` → the Procedure) is
  optional and carries the delivery method (`medium`) and materials. That's A8's design, and B3
  counts it once [S].

**Form answers → QuestionnaireResponse**
* *Right.* *Add:* Smart Forms stores `questionnaire` as `url|version`, so search by subject and status
  and filter in FHIRPath, because Meld matches `questionnaire=` only on the exact string (A11 [S]).

### Codes table

| Test | Draft | Verdict |
|---|---|---|
| Haemoglobin | 718-7 | ✔ in SPIA [TX] |
| Ferritin | 2276-4 | ✔ in SPIA |
| Transferrin saturation | *to confirm* | **14801-5** (molar fraction, SPIA). 2502-3, used by all the data and solutions, is not in SPIA [TX] |
| CRP | *to confirm* | 1988-5 ✔ SPIA. Also accept 30522-7 (hs-CRP, SPIA) when reading |
| MCV | *to confirm* | 787-2 ✔ SPIA |
| Vitamin B12 | *to confirm* | 14685-2 (pmol/L) ✔ SPIA. A5's choice is right |
| Folate | *to confirm* | 14732-2 serum (nmol/L) ✔ SPIA. 2284-8 (mass) is not in SPIA |
| eGFR | *to confirm* | 62238-1 (CKD-EPI) ✔ SPIA; read 98979-8 (CKD-EPI 2021, also SPIA) too |

"Medications: AMT" is right. Since AMT is now inside SNOMED CT-AU, the system is
`http://snomed.info/sct`, and the data and A7 do that. Say so explicitly, because people look for an
AMT system URI. Value set URLs should name the edition:
`http://snomed.info/sct/32506021000036107?fhir_vs=ecl/…`. A3, A4 and A6 do; A7 doesn't [S].

### Decision rules

| Rule | Draft | Verdict |
|---|---|---|
| Anaemia | "below the threshold (≤130 M, ≤120 F)" | **Self-contradictory.** Use **< 130 / < 120 g/L**, as WHO does; B1, B2, B6 and B9 already use <. When sex isn't male or female, don't classify: say "sex needed". Note for Metro North: the 2017 international peri-operative consensus (Muñoz et al., *Anaesthesia* 72:233) suggests Hb < 130 g/L for **both** sexes before major surgery. That is a policy choice. |
| Iron deficiency | ferritin < 100, or TSAT < 20% with ferritin 100–300 | OK and consistent with the peri-operative consensus. **But** the starter module adds "and CRP > 10" to the TSAT branch, while A6 and B1 don't [S]. Keep the draft's rule for the *finding*, and put inflammation in the *pathway* (next row). |
| Inflammation | CRP > 10 mg/L | OK. All agree. |
| *Pathway (missing)* | — | Add A6's table: IDA = anaemia and (ferritin < 100, or ferritin 100–300 with TSAT < 20 and CRP ≤ 10); ACD = anaemia, ferritin 100–300, TSAT < 20, CRP > 10; ID = iron deficiency without anaemia; anaemia, other = anaemia without iron deficiency; none. This reproduces all 40 recorded diagnoses [S]. |
| Ganzoni | weight × (target − Hb) × 0.24 + stores | Specify the *weight*. A7 (and the NBA guide) uses the dosing weight = the lower of actual and ideal (Devine) weight, while the generator uses actual weight. Apply the 35 kg threshold to *actual* body weight; the root 0.1.0 tests the dosing weight. Use stores alone when Hb ≥ target, round to 100 mg, and split per product maximum (FCM ≤ 1000 mg and ≤ 20 mg/kg per infusion). |

### Shared conventions

* "Variables: list to be agreed". The solutions now define it (A6 `root-variables.json`, A7 §2).
  The proposal lists the agreed names.
* *Add:* root-level `sdc-questionnaire-extractAllocateId` (`ivIronOrderId`, A7; `eduProcedureId`, A8),
  because `$assemble` drops module-level extensions.
* *Add:* Smart Forms extracts each contained template only once, so use one template per target
  resource (A6 found this).
* *Add:* EpisodeOfCare status changes use FHIRPath Patch via the Smart Forms *non-standard*
  `TemplateExtractExtensionPatchRequestUrl` (A9), or a full PUT.
* *Add:* the author/requester. Templates use `%resource.author`, which is empty in the playground,
  so provide an "ordered by" / "given by" item as a fallback, because AU Core requires
  `MedicationRequest.requester`.
* *Add:* idempotent write-back. Put an `identifier` on extracted resources (for example the
  QuestionnaireResponse id plus linkId) so a second write-back can be a conditional create
  (`ifNoneExist`). A9 found that Smart Forms 1.0.16 drops `ifNoneExist`, so for now this is
  documentation only.

---

## 3. Consistency table

"Files to change" paths are relative to `T/` (`2026-10-29/1-FHIR-For-Users/`). ✔ means already
compliant. I changed none of these files.

| # | Topic | Where they disagree | Recommended single answer | Files to change |
|---|---|---|---|---|
| K1 | **Anaemia threshold < vs ≤** | Mapping says "below" but writes ≤. `questionnaires/build.py` pam-anaemia: `%hb <= %hbThreshold`. A6: ≤. B1, B2, B6, B9: <. | **Hb < 130 (M) / < 120 (F) g/L** | Mapping; `questionnaires/build.py` (+ regenerate modules and assembled form); `solutions/A6-diagnosis/build.py` and its JSON, plus its verify boundary cases; `decks/examples/*` if they show ≤ |
| K2 | **Sex other / unknown** | Root `hbThreshold` falls back to 120 for anything not male; B9 `kpis.sql` and the anaemia-corrected measure fall back to 130 for anything not female; A6 (proposed) and B1 give no classification. | **No threshold**: anaemia unknown ("sex needed") | `questionnaires/build.py` (A6's proposed `hbThreshold`); `solutions/B9-analytics/kpis.sql`, `measures/anaemia-corrected.json` |
| K3 | **Pathway when ferritin is 100–300, TSAT < 20 and CRP > 10** | Starter: iron deficiency only if CRP > 10. A6: the finding is iron deficiency, and the pathway is **ACD** (matches 40/40 recorded diagnoses). B1: **IDA**, so `pam-008` shows IDA next to a recorded ACD. B6: ferritin only (fine for its purpose). | **A6's pathway table** goes into the mapping | Mapping; `solutions/B1-patient-summary/logic.js` (+ verify); `questionnaires/build.py` (pam-iron-deficiency text and expression) |
| K4 | **Initial vs post-treatment anchor** | A5: the *most recent* IV iron order. B6: the *earliest* IV iron order. B1, B9 and `apps/pam-dashboard`: the earliest vs latest result. | **Anchor = the earliest IV iron in the current PAM episode** (MedicationAdministration `effective` if present, else MedicationRequest `authoredOn`). Initial = latest result on or before the anchor; post = latest result after it (and on or before surgery, if booked). No IV iron: earliest vs latest within the episode (needs ≥ 2). Earliest, because a top-up order must not turn a post-dose result into "initial". | `solutions/A5-pathology/build.py` (`pathIvIron` selection, first not last); `solutions/B1-patient-summary/app.js`/`logic.js`; `solutions/B9-analytics/kpis.sql`, `measures/anaemia-corrected.json`; `apps/pam-dashboard/index.html`. B6 ✔ (add the episode window). On the synthetic data every method agrees, because there is one order per patient. |
| K5 | **What counts as IV iron** | A5: product *name* regex plus IV route. B6: IV route **or** the two data codes. B1, B5 and B9 `iv_iron`: **every** MedicationRequest. | **One value set, "PAM IV iron products"**: ECL `(< 763158003 : 762949000 = (430077004 OR 1172494003 OR 129497004 OR 708805001)) AND (< 763158003 : 411116001 = << 129011000036109)` (33 concepts, incl. branded [TX]). Fallback: route 47625008. A7's *order* value set stays narrower (FCM and FDI unbranded, 7 concepts). | Mapping; A5 (code list in place of the regex); B1, B5; `solutions/B9-analytics/views/iv_iron.json` (`where`); B6 (code list) |
| K6 | **Task due date** | Mapping: `executionPeriod`. Data, A9, B1, B2: `restriction.period.end`. | **`Task.restriction.period.end`** (R4 comment: "period.high is the due date") | Mapping only. B1 and B2 may drop their `executionPeriod` fallback. |
| K7 | **Education coding** | Mapping: "Communication or Procedure". A8: Procedure (category 409073007, code 311401005) **plus** Communication (category HL7 `instruction`, topic 311401005, `partOf` the Procedure). B3: counts Procedures by code or category, **and** Communications with a SNOMED *category*, which A8 never writes. B9: PAM 8 has no data. | **Procedure is the countable record** (A8's shape). The Communication is optional detail and is never counted. | Mapping; `solutions/B3-kpi-tiles/calc.js`, `index.html` (drop the Communication search); B9 (add an education view); generator (add education Procedures) |
| K8 | **MedicationRequest dosage shape** | Data: one `dosageInstruction` holding the whole Ganzoni dose (15/21 FCM orders > 1000 mg). A7: one `dosageInstruction` per infusion (`sequence`, IV route, mg). B1: `dosageInstruction[0]`. B9 `iv_iron.dose_mg`: `dosageInstruction.first()`. B5: reads no dose. | **A7's shape: one per infusion.** Total = `dosageInstruction.doseAndRate.dose.ofType(Quantity).value.sum()`. Ganzoni workings go in `note`. | `data/generate.py`; `solutions/B1-patient-summary/app.js`; `solutions/B9-analytics/views/iv_iron.json` (sum, or a per-infusion view) |
| K9 | **MedicationRequest status** | Data: `completed`. A7: `active`. B6 excludes `draft`; B1 and B5 don't. | Both statuses are valid lifecycle states. **Apps exclude `cancelled`, `entered-in-error` and `draft`**; everything else counts as ordered. | `solutions/B1-patient-summary/app.js`, `solutions/B5-referral-profile/calc.js` (add `draft`) |
| K10 | **"Recommended treatment" (PAM 14)** | B5: the latest MedicationRequest, else the episode outcome. B9: IV iron orders only. A7: writes **only** the IV iron order; the plan (oral iron, ESA, transfusion) isn't written. | **Recommended treatment = the A7 treatment plan.** IV iron: MedicationRequest `intent=order`. Oral iron and ESA: MedicationRequest `intent=plan`. Red cell transfusion: ServiceRequest `intent=plan` (116863004). None: episode finished without any. PAM 14 counts per referral, by category. | Mapping; `solutions/A7-treatment/build.py` (templates for the plan items); `solutions/B5-referral-profile/calc.js` (+ ServiceRequest, intent); B9 view; generator (optional: some oral-iron plans) |
| K11 | **Directorate** | Absent from the data. B8 hard-codes `DIRECTORATES` (made up); B7 uses it. In the data, units are `partOf` the blood management service. | **Organization hierarchy**: hospital ← directorate (Organization, `type` dept) ← surgical unit (`partOf` the directorate). Filter with `ServiceRequest?performer:Organization.partof=Organization/<dir>` (tested on Meld by B8). The blood management service is a separate department. | `data/generate.py`; `solutions/B8-filters/pam-filters.js` (replace the lookup with the chained search); mapping |
| K12 | **Referral status and requester** | Data: every referral `completed`; `requester` is the surgeon even when the source is GP, anaesthetist or pre-admission (19/40). A3: `active`, requester = the surgeon. | Status `active` while the episode is open, `completed` when cleared. `requester` = the actual referrer; source kind in `category`. | `data/generate.py`; `solutions/A3-proposed-surgery/build.py` (requester from a "referred by" item); A9 could set the referral to `completed` when clearing |
| K13 | **Timeframe date** | B3: `EpisodeOfCare.period.start`. B4, B5, B7, B8, B9: referral `authoredOn`. B6: the treatment (anchor) date. | **Referral `authoredOn`**, with the convention `EpisodeOfCare.period.start` = referral date (true in the data). B6 may offer the treatment date as an extra option, labelled. | `solutions/B3-kpi-tiles/calc.js` (or document it as equivalent); `solutions/B6-outcomes/index.html` (default) |
| K14 | **Which statuses are "being managed"** | B2: `active`. B3: `active`, `planned`, `waitlist`, `onhold`. A9 writes `active` or `finished` only. | **Being managed = `active`; cleared = `finished`**. Other statuses are shown separately, not counted in either. | `solutions/B3-kpi-tiles/calc.js` |
| K15 | **Interpreter extension** | A1: core `patient-interpreterRequired` (= AU Core 2.0.0). A11: AU Base `interpreter-required`. | **Core extension**. Readers may also accept the AU Base one. | `solutions/A11-pre-admission/build.py` (+ test data) |
| K16 | **Blood-product codes and consent codes** | A6: *declined* products as SNOMED product concepts (126242007, 256395009, 346447007, 256401009, 789265003, 714569001); consent `…/blood-product-consent` full/limited/refused; reasons `…/blood-product-refusal-reason`. A11: *accepted* products as **procedure** concepts (116863004, 180208003, 13569004, 116795008, 116788004, 233568002); `…/transfusion-preference` accept/some/refuse/unsure; `…/transfusion-reason`. | **One ValueSet "PAM blood products"** = A6's product concepts plus 233568002 *Intraoperative blood salvage*. One consent CodeSystem (accept / limited / refuse / unsure) and one reason CodeSystem. Patients say what they **accept**, and the nurse's Flag lists what is **declined**; the A11 nurse import computes the complement. | `solutions/A11-pre-admission/build.py`; `solutions/A6-diagnosis/build.py` (shared code systems); mapping |
| K17 | **Which Condition is "the PAM diagnosis"** | B4: the patient's Condition with the earliest `recordedDate` on or after the referral (any Condition). B1, B9: all Conditions. A4 writes `problem-list-item` history Conditions that would be picked up. | **`category` = `encounter-diagnosis` AND code in the PAM diagnosis value set**, linked from `EpisodeOfCare.diagnosis` when present | `solutions/B4-referrals/index.html`; `solutions/B9-analytics/views/pam_diagnosis.json` (`where`); B1 (label); generator (`EpisodeOfCare.diagnosis`) |
| K18 | **Diagnosis value set and the "iron deficiency" code** | Data and A3 reason codes: 35240004. A6 suggests 35240004; its ECL `<< 271737000 OR << 35240004` excludes 234340006. B4 groups by exact code. | **234340006 *Iron deficiency without anaemia*** for the ID pathway. Value set `<< 271737000 OR 35240004 OR << 234340006`. Apps group by subsumption (`<< 87522002` etc.) where they can. | `data/generate.py`; `solutions/A6-diagnosis/build.py`; `solutions/A3-proposed-surgery/build.py`; `solutions/B4-referrals/index.html` (accept both codes); `solutions/B9-analytics` (labels) |
| K19 | **TSAT LOINC** | Data, starter, A5, A6, B1, C1 and `decks/examples`: 2502-3. | **Write 14801-5, read 14801-5 and 2502-3** | `data/generate.py`; `questionnaires/build.py`; `solutions/A5-pathology/build.py`, `test_data.py`; `solutions/A6-diagnosis/build.py`, `test_data.py`; `solutions/B1-patient-summary/logic.js`/`app.js`; `solutions/C1-closed-loop/test_data.py`; `decks/examples/expressions.json`, `pathology-walkthrough.json` |
| K20 | **SNOMED edition in value-set URLs** | A3, A4, A6: `http://snomed.info/sct/32506021000036107?fhir_vs=…`. A7: `http://snomed.info/sct?fhir_vs=…` (relies on Ontoserver's default edition). | **Edition URI everywhere** | `solutions/A7-treatment/build.py` |
| K21 | **Inactive concept** | A4: `Procedure.category` 103693007 (inactive since 2023-04-30 [TX]) | Drop the category (not required by AU Core) | `solutions/A4-history/build.py` |
| K22 | **Ganzoni inputs** | Generator: actual weight, clamp 500–2000, no split. A7: dosing weight = min(actual, Devine IBW), 35 kg threshold on actual weight, round to 100, split per product. Root 0.1.0: 35 kg threshold on dosing weight; no dose without height. Generator doses differ from A7's by −12 to +606 mg. | **A7's rule** | `data/generate.py`; `questionnaires/build.py` (A7's proposed `weight`, `targetHb`, `ironStores`) |
| K23 | **Target Hb** | A6 Goal: the requested pre-op target (e.g. 130). A7: Ganzoni target 150 (formula constant). | **They are different things.** The mapping says so, and A7 does not read the Goal. | Mapping only |
| K24 | **PAM numbering** | B4: PAM 9 = by category, 10 = vs waitlisted, 11 = by diagnosis. B9: "PAM 10 diagnoses". | **Use B4's numbering** (it follows the scenario row) | `solutions/B9-analytics/README.md`, `kpis.sql` comments |
| K25 | **Cohort (who is a PAM patient)** | B3: has a PAM EpisodeOfCare. B5, B4: has a referral ServiceRequest. B6: IV iron or a PAM episode. B7, B8, B9: referral **and** waitlist entry (referrals without one are dropped). | **One referral (3457005, `performer` = the PAM service) = one PAM case**, with exactly one EpisodeOfCare (`referralRequest`). A missing waitlist entry shows as "Unknown" category or unit rather than excluding the case. | `solutions/B8-filters/pam-filters.js` (`cohort()` left join when no waitlist filter is set); `solutions/B7-demographics`; `solutions/B9-analytics/kpis.sql`; `solutions/B6-outcomes/index.html` |
| K26 | **Requester / performer on write-back** | A7 `requester` and A8 `performer`/`sender` come only from `QuestionnaireResponse.author`, which is empty in the playground. AU Core `MedicationRequest.requester` is 1..1. | A **"ordered by" / "given by" item** pre-populated from `%user` and used when there is no author | `solutions/A7-treatment/build.py`, `solutions/A8-education/build.py` |
| K27 | **Root-level extensions** | A7 needs `extractAllocateId ivIronOrderId` on the root; A8 needs `eduProcedureId`; A6 needs 7 new root variables. They're only in the solutions' own standalone forms. | Add them to the root | `questionnaires/build.py` (`SHARED_VARIABLES`, root `extension`) |
| K28 | **Elective category element** | Mapping: "priority or extension?". Every solution and the data: `ServiceRequest.category` (local `elective-category`). | **`category`** ✔ | Mapping only |
| K29 | **Referral → waitlist link** | Mapping: "`basedOn` / `supportingInfo`". Data and all solutions: `supportingInfo`. | **`supportingInfo`** ✔ | Mapping only |
| K30 | **Infusion booking** | Mapping: "ServiceRequest or Appointment". A7: ServiceRequest 718520009 `basedOn` the MedicationRequest. | **ServiceRequest** ✔ | Mapping only |

---

## 4. `data/generate.py` against the proposed mapping

What the generator would need to change. **M** = needed for consistency, and some app or form
already depends on it. **N** = nice to have, filling empty charts or pre-population.

| # | Change | Why | |
|---|---|---|---|
| G1 | TSAT LOINC `2502-3` → **`14801-5`** (`LABS["tsat"]`) | K19, AU Core / SPIA | M |
| G2 | "id" profile diagnosis `35240004` → **`234340006` Iron deficiency without anaemia** (`DIAGNOSES["id"]`) | K18 | M |
| G3 | IV iron dose: Ganzoni on the **dosing weight** (min(actual, Devine IBW)), 35 kg threshold on actual weight, stores only when Hb ≥ 150, round to 100 mg; **one `dosageInstruction` per infusion** (`sequence`, route, `doseQuantity`; FCM ≤ min(1000 mg, 20 mg/kg); FDI ≤ min(1500 mg, 20 mg/kg)); Ganzoni workings in `note`. Today 15/21 FCM orders exceed 1000 mg in one dose. | K8, K22 | M |
| G4 | Referral `status`: `active` for patients still being managed, `completed` when the episode is finished | K12 | M |
| G5 | Referral `requester` = the actual referrer by source (GP Practitioner or PractitionerRole for `gp`; an anaesthetist; a pre-admission clinic PractitionerRole), not always the surgeon. Add `performer` = blood management service (already there). | K12 | M |
| G6 | Organizations: add a hospital and 2–3 **directorate** Organizations; units `partOf` their directorate, **not** the blood management service. The blood management service is `partOf` the hospital or its own directorate. | K11 | M |
| G7 | `EpisodeOfCare.diagnosis` → `Condition/{pid}-diagnosis` (role SNOMED/`diagnosis-role` `CC` or `AD`) for patients with a diagnosis | K17 | M |
| G8 | **Education**: one or two Procedures per PAM patient (`code` 311401005, `category` 409073007, `performedDateTime` between referral and treatment, `performer` nurse, `usedCode` local materials), with an optional Communication `partOf` it. B3 PAM 8 / 8a is empty today. | K7 | M |
| G9 | Patient: `indigenous-status` extension (all patients, incl. some "9 not stated"), core `patient-interpreterRequired` + `communication.language` (a few), `telecom`, `generalPractitioner` → PractitionerRole (new GP Practitioners, a practice Organization, Medicare provider number identifier) | A1, A2, A11 pre-population | N |
| G10 | Observations: `performer` → a pathology lab Organization (AU Core Must Support); add initial **MCV, B12, folate, eGFR** results (A5 and A6 read them; A6's text hints use MCV and eGFR) | AU Core, A5, A6 | N |
| G11 | Task: add `note` (dated text) to some follow-ups (A9 "previous notes"), and a `description` | A9 | N |
| G12 | Optional extras so every module and app has something to show: an admission `Encounter` (class IMP) with the GP as participant (A2), a `Flag` (blood products declined) and a `Goal` (target Hb) for one or two patients (A6), an infusion `ServiceRequest` 718520009 `basedOn` each IV iron order, `MedicationAdministration` per infusion (a better outcome anchor, K4), and oral-iron `MedicationRequest intent=plan` for a few "acd" or "none" patients (PAM 14, K10) | A2, A6, A7, B5, B6 | N |
| G13 | `MedicationRequest.requester`: keep it, since AU Core requires it. Consider a PAM **medical officer** Practitioner as prescriber rather than the nurse. In Queensland, IV iron is usually prescribed by a doctor or nurse practitioner, which is a question for Metro North. | realism | N |
| G14 | Keep as is, since it already matches the proposal: `restriction.period.end` for the Task due date, `supportingInfo` for referral → waitlist, `category` for elective category and referral source, `encounter-diagnosis`, vital-signs coding, `EpisodeOfCare.period.start` = referral `authoredOn` | — | ✔ |

The rule changes in K1 (< vs ≤) and K3 (pathway) need **no** data change. Every synthetic Hb is at
least 3 g/L from its threshold, and the "acd" profile (ferritin 110–280, TSAT 10–19, CRP 14–60)
already follows A6's pathway. G2 changes the expected diagnosis code in A6's and B4's checks, and G1
changes the TSAT code in every pathology query, so do G1 and G2 together with K18 and K19.

---

## 5. Decisions the track leads must make

These are the ones I can't settle from the spec. Each has my recommendation; the rest of the
consistency table follows from the spec or from what most solutions already do.

1. **Anaemia threshold:** < (WHO), or ≤ (draft)? And sex-specific, or the peri-operative 130 g/L for
   everyone? *Recommend: < 130 M / < 120 F, to confirm with Metro North.*
2. **Pathway for ferritin 100–300, TSAT < 20, CRP > 10:** ACD (A6) or IDA (B1)? *Recommend: ACD (A6).*
3. **Initial vs post anchor:** the earliest IV iron in the episode (B6), the most recent (A5), or
   earliest vs latest (dashboard)? *Recommend: earliest IV iron in the episode.*
4. **TSAT code:** move to 14801-5 (SPIA) before the event, or after it (read both either way)?
   *Recommend: before. It is one constant in the generator and in each solution.*
5. **Recommended treatment (PAM 14):** "ordered IV iron" (as now) or "the treatment plan" (A7
   writes plan items)? *Recommend: the treatment plan; until A7 writes it, label the chart
   "Treatment ordered".*
6. **Directorates:** get Metro North's real directorate → unit grouping and put it in the data as
   Organizations, or keep B8's made-up lookup for the event? *Recommend: Organizations, even with
   made-up names.*
7. **Education:** Procedure as the countable record (A8 and B3), with Communication optional?
   *Recommend: yes.*
8. **Being managed:** `active` only (B2), or also `planned`, `waitlist` and `onhold` (B3)?
   *Recommend: `active` only.*
9. **Blood products:** one shared value set and consent code system for A6 and A11, and the polarity
   (patient says accepted, nurse's Flag says declined)? *Recommend: as in K16.*
10. **Regenerate the synthetic data** (G1–G8) before day 1? Changing ids isn't needed: only codes,
    dosages, statuses, organisations and new resources change, and the bundle PUTs in place. The new
    education Procedures, Organizations and GP resources would need new ids (`pam-…`).
    *Recommend: yes, then re-run each solution's verify script; several assert today's codes.*

---

## 6. How this was checked

* `python3 check-codes.py` (read-only `$lookup`, `$validate-code` and `$expand` on
  `https://r4.ontoserver.csiro.au/fhir`): **ALL PASS**. It covers 38 SNOMED CT-AU concepts active plus
  1 confirmed inactive, 13 LOINC codes, SPIA membership (9 in, 2502-3 and 2284-8 not in), AU Clinical
  Condition membership, Australian Medication membership, the hierarchy facts (IDA, ACD and anaemia
  in CKD are under Anaemia; 35240004 has no descendants; 234340006 is under neither), A7's 7-concept
  order ECL, and the 33-concept IV iron detection ECL.
* FHIR R4: Task element definitions (`hl7.org/fhir/R4/task-definitions.html`, quoted above);
  ServiceRequest `priority` and `basedOn` / `supportingInfo` definitions.
* AU Core 2.0.0 profiles: Patient, Pathology Result Observation, Condition and MedicationRequest
  (`hl7.org.au/fhir/core/StructureDefinition-au-core-*.html`).
* Synthetic-data figures (19 non-surgeon referrals with a surgeon requester, 15 FCM orders > 1000 mg,
  generator vs A7 dose differences, units `partOf` the blood management service) were computed from
  `data/pam-synthetic-bundle.json`.
* **Not checked:** whether Meld (HAPI 6.0.0) supports the `:below` modifier against Ontoserver. B3 says
  it doesn't, so apps must list codes explicitly. Clinical thresholds were not confirmed with
  Metro North. A1–A4 have no README, so their designers' intent is inferred from their JSON.
