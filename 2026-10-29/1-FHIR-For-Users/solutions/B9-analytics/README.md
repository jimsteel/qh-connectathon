# B9 Analytics without a BI tool

**Status: verified** for SQL on FHIR and Measure/MeasureReport (run locally on data read from the Meld open
endpoint; results cross-checked three ways). Bulk `$export`: kick-off accepted by Meld but no export completed (see below).

The dashboard KPIs computed three ways, without a BI tool:

1. **SQL on FHIR v2 ViewDefinitions** ([`views/`](views/)) run by **Pathling 10** (CSIRO's open-source
   implementation, Python + Spark, installed locally), then plain SQL ([`kpis.sql`](kpis.sql)) over the flat views.
2. **Measure / MeasureReport** for three KPIs ([`measures/`](measures/)), FHIRPath criteria evaluated by
   [`evaluate-measures.mjs`](evaluate-measures.mjs) with fhirpath.js → summary MeasureReports
   ([`results/measure-reports/`](results/measure-reports/)).
3. **Bulk Data `$export`** on Meld: the kick-off is accepted (202), but test jobs stayed `SUBMITTED` for 23 minutes; see the note.

Nothing is written to Meld: data is read with plain searches into `data/*.ndjson` (git-ignored cache).

## Pipeline

```sh
cd solutions/B9-analytics
python3 fetch-data.py                 # read-only searches -> data/<Type>.ndjson (skips soln-* test patients; --all keeps them)

# Pathling in a throwaway venv (Python 3.9+, Java 17+; tested: Python 3.12 via uv, Temurin 21)
uv venv --python 3.12 /tmp/pathling-venv && VIRTUAL_ENV=/tmp/pathling-venv uv pip install pathling==10.0.0
PATHLING_IVY_DIR=/tmp/pathling-ivy /tmp/pathling-venv/bin/python run-views.py [2025-07-01 2026-06-30]
#   -> results/views/<view>.csv and results/kpis/<kpi>.csv (Spark downloads ~140 MB of jars into PATHLING_IVY_DIR,
#      default .cache/ivy here, git-ignored)

node evaluate-measures.mjs [2025-07-01 2026-06-30]   # -> results/measure-reports/*.json (fhirpath.js from decks/node_modules)
node verify.mjs                                       # cross-checks, PASS/FAIL
```

(`node` scripts resolve `fhirpath` from `../../decks/node_modules`; run them from anywhere.)

## 1. SQL on FHIR ViewDefinitions

Real `ViewDefinition` resources (SQL on FHIR v2: `resource`, `select.column` with FHIRPath `path` and `type`,
`where`, `getResourceKey()` / `getReferenceKey()`), ids `soln-B9-…`, canonical
`https://aehrc.github.io/qh-connectathon/track1/solutions/ViewDefinition/<name>`:

| View | Resource | One row per | Columns |
|---|---|---|---|
| `patient_demographics` | Patient | patient | patient_id, gender, birth_date, postcode, suburb, state |
| `pam_referral` | ServiceRequest (code 3457005) | referral to blood management | referral_id, patient_id, authored_on, referral_source, status, reason |
| `pam_waitlist` | ServiceRequest (elective-category) | surgical waitlist entry | waitlist_id, patient_id, category, unit_id, procedure_code, procedure, surgery_date, authored_on, status |
| `pam_episode` | EpisodeOfCare (type pam) | episode with the team | episode_id, patient_id, status, period_start, period_end, care_manager_id |
| `lab_result` | Observation (laboratory, Quantity) | result | observation_id, patient_id, loinc, effective, value, unit |
| `pam_diagnosis` | Condition | diagnosis | condition_id, patient_id, code, display, recorded_date |
| `iv_iron` | MedicationRequest | IV iron order | request_id, patient_id, product_code, product, authored_on, dose_mg, status |

`kpis.sql` (Spark SQL; `${period_start}`/`${period_end}` substituted) then gives, for referrals in
**FY 2025–26** (output in [`results/kpis/`](results/kpis/), log in [`results/run-views-output.txt`](results/run-views-output.txt)):

| KPI | Result |
|---|---|
| PAM 6 being managed now (active episodes) | 8 |
| PAM 7 days with the team (finished episodes started in FY) | 27 episodes, median 34 days (1–49); 21 within 42 days |
| PAM 9 referrals per FY quarter × waitlist category | Q1 5/2/2, Q2 3/2/3, Q3 3/6/0, Q4 0/1/0 (cat 1/2/3) |
| PAM 10 diagnoses | IDA 11, iron deficiency 6, anaemia of chronic disease 3 |
| PAM 12 by unit | Urology 9, Cardiothoracic 5, Colorectal 5, Gynaecology 4, Orthopaedics 4 |
| PAM 13 by referral source | surgeon 15, pre-admission 9, anaesthetist 2, GP 1 |
| PAM 14 IV iron | ferric carboxymaltose 12 (median 1036.5 mg), ferric derisomaltose 5 (1188 mg) |
| PAM 15 Hb first → latest, by sex | female 109 → 116 g/L (11 pts, 8 with post), male 132.5 → 141.5 (16, 12) |
| PAM 17/18 age bands × sex, PAM 19 postcodes | see CSVs |

## 2. Measure / MeasureReport

Three Measures, ids `soln-B9-measure-…`, canonical `https://aehrc.github.io/qh-connectathon/track1/solutions/Measure/pam-<key>`, version 0.1.0:

| Measure | Scoring | Populations | Stratifiers | FY 2025–26 |
|---|---|---|---|---|
| [`referrals`](measures/referrals.json) — PAM 9, 12 | cohort | referred in period (with a waitlist entry) | waitlist category, unit, referral source | 27 (cat 11/11/5) |
| [`anaemia-corrected`](measures/anaemia-corrected.json) — PAM 15 | proportion | denominator: anaemic at first Hb (<130 male, <120 female) with a later Hb; numerator: latest Hb ≥ threshold | sex | 6/14 = 0.429 (F 2/7, M 4/7) |
| [`cleared-6-weeks`](measures/cleared-6-weeks.json) — PAM 7 | proportion | denominator: episodes started in period and finished; numerator: finished within 42 days | sex | 21/27 = 0.778 |

**Evaluation context (a decision to review):** criteria use `text/fhirpath`, evaluated once per patient with the
context set to a **Bundle of that patient's resources** (what `Patient/$everything` returns) and
`%periodStart` / `%periodEnd` set (documented in each `Measure.usage`). They use `defineVariable()` and `sort()`
from FHIRPath 3.0 (fhirpath.js has both). This is not a standard Measure evaluation profile: the interoperable
route is CQL libraries evaluated by a clinical-reasoning server (`$evaluate-measure`), which **Meld does not
offer** (no `$evaluate-measure` in its CapabilityStatement; HAPI 6.0.0 without CR). FHIRPath has no date
difference, so "median days with the team" can't be a continuous-variable measure here — it stays in SQL (PAM 7
row above) and the measure is the "within 42 days" proportion instead.

MeasureReports (`type: summary`, ids `soln-B9-report-…`, with population counts, `measureScore`, strata) are in
[`results/measure-reports/`](results/measure-reports/); they are **not** loaded on Meld.

## 3. Bulk Data `$export` on Meld (read-only check)

Meld's CapabilityStatement (HAPI FHIR 6.0.0) lists system-level `$export` / `$export-poll-status` and
`Patient/$export`, `Group/$export` (there are no Group resources in the sandbox). Tested on the **open** endpoint,
28 Oct 2026, 23:00 AEST (kick-off is a GET; it starts a server-side job but changes no resources):

```
GET https://gw.interop.community/QHConnectathon2026/open/$export?_type=Patient
Accept: application/fhir+json
Prefer: respond-async
→ 202 Accepted, Content-Location: …/open/$export-poll-status?_jobId=841b46f9-…
(Patient/$export?_type=Patient: the same, job 825e81c5-…)

GET …/open/$export-poll-status?_jobId=…   (every 2 minutes, 23 minutes)
→ 202, X-Progress: "Build in progress - Status set to SUBMITTED at 2026-10-28T13:00:43", Retry-After: 120
```

**So: the Bulk Data kick-off is supported, but neither job left `SUBMITTED` in 23 minutes** — Meld's batch job
scheduler appears not to run exports (or is very slow). No NDJSON was produced, so `fetch-data.py` uses paged
searches instead, which is fine at this size. Other points:

* On the secured endpoint a real Bulk client would use SMART Backend Services (`system/*.read`); Meld only offers
  the SMART v1 scopes listed in `Demo-Environment.md` (no `system/` scopes), so standalone/back-end analytics
  against the secured endpoint isn't possible as configured.
* If `$export` worked, its NDJSON output drops straight into this pipeline: `data/<Type>.ndjson` is the Bulk
  output layout, and Pathling can also run the export itself (`pc.read.bulk(...)`, not tested).
* Worth retrying on the day; if it completes, the poll returns 200 with an `output[]` list of NDJSON URLs.

## Verified (28 Oct 2026)

`node verify.mjs` — **ALL PASS** ([`results/verify-output.txt`](results/verify-output.txt)):

* all 7 ViewDefinitions and 3 Measures well-formed; Pathling ran every view (rows: Patient 42, referrals 40,
  waitlist 40, episodes 40, lab results 266, diagnoses 35, IV iron 31);
* every Measure criterion compiles and evaluates on all 42 patient bundles (boolean per population);
* **SQL on FHIR (Pathling/Spark SQL) = MeasureReports (fhirpath.js)** for every population and stratum of all
  three measures — two independent implementations of the same KPIs;
* **SQL = direct FHIR searches on Meld**: active episodes (`EpisodeOfCare?status=active&type=…|pam`: 8),
  referrals per source in FY 2025–26 (`ServiceRequest?code=3457005&category=…&authored=ge…&authored=le…`),
  Hb rows (`Observation?code=…|718-7`: 69). Also matches B8's `timeframe FY2025-26` cohort (27).

## Gaps and decisions for the track leads

* **Runner:** Pathling 10.0.0 (Python, needs Java 17+ and ~600 MB of pyspark + jars, so not installed globally:
  venv and Ivy cache in a scratch directory). The ViewDefinitions are portable; any SQL on FHIR v2 runner
  (e.g. the reference `sof-js`) should run them, but only Pathling was tested. `kpis.sql` uses Spark SQL
  functions (`percentile`, `datediff`, `months_between`); DuckDB/Postgres need small changes.
* `getResourceKey()` in Pathling returns `Patient/pam-001`-style keys (fine for joins).
* Anaemia threshold: the mapping says "≤130 male, ≤120 female"; the measure and SQL use **< threshold = anaemic,
  ≥ threshold = corrected**. Confirm with Metro North.
* "Initial vs post-treatment" = first vs latest Hb (as the PAM dashboard does), not anchored to the IV iron date.
* `fetch-data.py` skips resources of `soln-*` test patients other teams add to the shared sandbox (`--all` keeps them);
  `pam-demo` / `pam-spike-1` are kept but drop out of every KPI (no referral).
* PAM 8 (education sessions per month) has no data yet (A8 would add Communication/Procedure).
* Measures and MeasureReports were not validated against the R4 StructureDefinitions (no `$validate` call, to stay
  read-only on Meld); they follow the R4 element names.
