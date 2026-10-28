# B5 Referral profile: PAM 12, 13, 14

**Status: partly verified.** No-login mode against the Meld open endpoint was tested headless. For
all three timeframes, every chart matches a separate calculation from direct FHIR reads, and the unit
and source of all 40 synthetic referrals match the generator's bundle. The SMART launch from Meld is
untested because it needs a client ID.

This population app follows the `apps/pam-dashboard` pattern: plain HTML/JS, fhirclient.js 2.6.3 and
Plotly, with no build step. It has a timeframe filter on the referral date and three horizontal bar
charts of referrals, each bar showing its count and share:

* **PAM 12 Surgical unit**
* **PAM 13 Referral source**
* **PAM 14 Recommended treatment**

There is also a per-referral table and the list of FHIR queries.

Files: `index.html`, `launch.html`, `calc.js` (no DOM, so it can be tested in Node), `verify.mjs`,
`screenshot-meld-all.png`.

## Try it

```sh
cd T/solutions && python3 -m http.server 8000
```

`http://localhost:8000/B5-referral-profile/?server=https://gw.interop.community/QHConnectathon2026/open`

## Meld registration

* Launch URI: `<site>/B5-referral-profile/launch.html`
* Redirect URI: `<site>/B5-referral-profile/`
* Scopes: `launch openid fhirUser profile online_access user/*.read` (SMART v1)

Put the client ID in `launch.html` (`CLIENT_ID`) and launch with a patient selected. The app ignores
the patient.

## How each figure comes from FHIR

The page runs four searches (`|` is sent as `%7C`); `calc.js` joins the results:

```
GET ServiceRequest?code=http://snomed.info/sct|3457005
GET ServiceRequest?category=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/elective-category|&_include=ServiceRequest:performer
GET MedicationRequest
GET EpisodeOfCare?type=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/episode-type|pam
```

| Figure | Derivation |
|---|---|
| Unit of counting | One **referral**: a ServiceRequest coded SNOMED CT 3457005 \|Patient referral\|, not `entered-in-error`, `revoked` or `cancelled`, with `authoredOn` in the timeframe |
| **Surgical unit** (PAM 12) | `referral.supportingInfo` → the waitlist ServiceRequest (the one with an `elective-category` category) → `performer[0]` → `Organization.name` (with " (synthetic)" removed). If `supportingInfo` is missing, the app uses the patient's latest waitlist entry; otherwise "Not recorded". The search for any elective category uses a system-only token (`category=<system>\|`), which Meld supports. |
| **Referral source** (PAM 13) | `referral.category` coding in `…/CodeSystem/referral-source` (Surgeon, Pre-admission clinic, Anaesthetist, General practitioner): its display, else "Not recorded" |
| **Recommended treatment** (PAM 14) | The patient's latest MedicationRequest (not `entered-in-error` or `cancelled`) with `authoredOn` on or after the referral date. Its AMT code is shown as "IV iron: ferric carboxymaltose" (1312141000168105) or "IV iron: ferric derisomaltose" (1086251000168104); any other product shows its own text. If there is no MedicationRequest, the app checks the EpisodeOfCare for this referral (`referralRequest`, else the patient's latest episode): `finished` → "No iron: cleared without it"; still open → "None yet: still being managed"; no episode → "Not recorded". |

## Verified

`cd T/decks && node ../solutions/B5-referral-profile/verify.mjs`: **17 checks pass**.

* **6 unit tests on a fixture:**
  * unit via `supportingInfo`
  * name clean-up
  * missing source
  * the latest MedicationRequest after the referral (an earlier one is ignored)
  * cleared without iron
  * the timeframe filter and the sort order
* **Headless against Meld, no-login, for All, FY 2025–26 and FY 2026–27.** The data plotted in each
  chart (read from the Plotly traces) equals a separate calculation from unfiltered reads of every
  ServiceRequest, Organization, MedicationRequest and EpisodeOfCare.
* **Against the generator's bundle:** the unit and source of all 40 `pam-0xx-referral`s match.
* On 28 Oct, All showed 43 referrals:
  * Gynaecology 10, Urology 10, Cardiothoracic 7, Colorectal 7, Orthopaedics 7, Not recorded 2
  * Surgeon 22, Pre-admission clinic 13, Anaesthetist 5, GP 3
  * Ferric carboxymaltose 21, cleared without iron 11, ferric derisomaltose 7, still being managed 2,
    Not recorded 2
* Screenshot: `screenshot-meld-all.png`.

Nothing was written to Meld.

## Decisions and known gaps (for the track leads)

* **"Recommended treatment" means the treatment ordered.** The data only has MedicationRequests (IV
  iron), so PAM 14 shows the latest order, or the episode outcome when there is none. If PAM records a
  recommendation separately from an order, it would need its own resource. Options are a
  MedicationRequest with `intent` = `proposal` / `plan`, or a CarePlan. A6/A7 should agree on this.
  Oral iron, ESA and transfusion aren't in the data. They would appear under their own text.
* **Counts are per referral, not per patient.** In the synthetic data that's the same thing.
* **Other teams' test referrals count too.** On 28 Oct there were `soln-A9-referral-1`,
  `soln-A2-patient-1-referral` and `739` (someone's write-back). These account for the "Not recorded"
  units and treatments, because they have no linked waitlist entry or episode. `pam-034` has extra
  test MedicationRequests (`3`, `5`, `7`), so its latest treatment is ferric derisomaltose rather
  than the synthetic carboxymaltose order.
* **Referral source** uses the draft mapping's local `category` code, not `requester`. The mapping
  leaves this open ("requester or a coded extension?").
* The timeframe filter is client-side on `authoredOn`. B8 (shared filters) would push it into the
  search (`authored=ge…&authored=le…`).
