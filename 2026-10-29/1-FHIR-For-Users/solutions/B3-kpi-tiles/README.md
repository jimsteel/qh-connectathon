# B3 Headline numbers (KPI tiles): PAM 6, 7, 8 / 8a

**Status: partly verified.** In no-login mode against the Meld open endpoint, every tile matches
direct FHIR queries for all three timeframes. Meld has no education data, so the education tiles and
chart were checked only with fixture data, which was intercepted in the browser and never written to
Meld. The SMART launch from Meld is untested because it needs a client ID.

This population app follows the `apps/pam-dashboard` pattern: plain HTML/JS, fhirclient.js 2.6.3 and
Plotly, with no build step. It has a timeframe filter (FY 2025–26, FY 2026–27 to date, All) and shows
these figures:

* **PAM 6, patients:**
  * referred
  * being managed
  * cleared
* **PAM 7, time with the team:**
  * median days with the team for cleared patients
  * median days so far for patients still being managed
* **PAM 8 / 8a, education:**
  * education sessions in total, and the number of patients educated
  * the average number of sessions per month
  * a bar chart of sessions per month

The page also lists its FHIR queries and has a table view of the monthly figures.

Files: `index.html`, `launch.html`, `calc.js` (all the numbers; no DOM, so it can be tested in
Node), `verify.mjs`, `screenshot-meld-all.png`, `screenshot-education-fixture.png`.

## Try it

```sh
cd T/solutions && python3 -m http.server 8000
```

`http://localhost:8000/B3-kpi-tiles/?server=https://gw.interop.community/QHConnectathon2026/open`

You can add `&today=2026-10-28` to fix "today" for "median days so far". The same query string works
on any URL the folder is published to (e.g. `/qh-connectathon/solutions/B3-kpi-tiles/`).

## Meld registration

Same as the dashboard:

* Launch URI: `<site>/B3-kpi-tiles/launch.html`
* Redirect URI: `<site>/B3-kpi-tiles/`
* Scopes: `launch openid fhirUser profile online_access user/*.read` (SMART v1)

Put the client ID in `launch.html` (`CLIENT_ID`). Launch from Meld **with a patient selected**. The
app ignores that patient and reads the whole population.

## How each number comes from FHIR

The page runs four searches (`|` is sent as `%7C`) and does the rest client-side in `calc.js`:

```
GET EpisodeOfCare?type=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/episode-type|pam
GET Procedure?code=http://snomed.info/sct|409073007,http://snomed.info/sct|311401005
GET Procedure?category=http://snomed.info/sct|409073007,http://snomed.info/sct|311401005
GET Communication?category=http://snomed.info/sct|409073007,http://snomed.info/sct|311401005
```

| Figure | Derivation |
|---|---|
| Timeframe | An EpisodeOfCare is in the timeframe if `period.start` (the referral date) falls in it. Filtering is client-side: Meld's `EpisodeOfCare?date=` matches on period overlap, which is not "referred in". |
| **Referred** (PAM 6) | EpisodeOfCare of type `pam` in the timeframe, excluding `entered-in-error` and `cancelled`. There is one episode per referral. |
| **Being managed** | Those with `status` = `active`, `planned`, `waitlist` or `onhold` |
| **Cleared** | Those with `status` = `finished` |
| **Median days with the team** (PAM 7) | Median of `period.end − period.start` in days, over cleared episodes |
| **Median days so far** | Median of `today − period.start`, over episodes still being managed |
| **Education sessions** (PAM 8) | A completed (not `entered-in-error`, `not-done` or `preparation`) **Procedure** whose `code` or `category`, or **Communication** whose `category`, has SNOMED CT **409073007 \|Education\|** or **311401005 \|Patient education\|**. The subject must be a patient with a PAM episode, and the date must fall in the timeframe: `Procedure.performedDateTime` / `performedPeriod.start`, or `Communication.sent` / `received`. The two Procedure searches are deduplicated. |
| **Per month** (PAM 8a) | Sessions grouped by the calendar month of that date. The months run from the timeframe start (for "All", the first referral or session) to the timeframe end or this month, whichever is earlier. Months with no sessions count as 0. The average is the total ÷ the number of months. |

## Verified

`cd T/decks && node ../solutions/B3-kpi-tiles/verify.mjs`: **15 checks pass**.

* **Unit tests of `calc.js` on a fixture:**
  * counts
  * both medians, including an even count
  * months across a year end
  * the education filter, which excludes non-education, non-PAM, `not-done` and duplicate resources
  * per-month counts
  * a timeframe filter
* **Against Meld (headless, no-login, `today=2026-10-28`):** for All, FY 2025–26 and FY 2026–27, the
  five patient and time tiles equal the values worked out separately. That calculation uses an
  unfiltered `EpisodeOfCare?_count=500` read with its own type filter and medians. On 28 Oct, All
  showed:
  * 41 referred, 8 being managed, 33 cleared
  * median 36 days with the team, 38 days so far
* **Education:** Meld has 0 Procedure and 0 Communication resources. The app shows 0 and a note
  saying why.
* **Education with fixtures.** Playwright replaced the education search responses in the browser with
  4 valid and 3 invalid sessions. The UI showed 4 sessions and 0.3 per month over 16 months, as
  expected. See `screenshot-education-fixture.png`. Nothing was written to Meld.

## Decisions and known gaps (for the track leads)

* **Education coding is a proposal.** No education data exists yet, and the A8 module is a TODO. The
  app expects a Procedure (preferred: "education given" is an act) or a Communication, coded with
  SNOMED CT 409073007 / 311401005. A8's write-back should agree on this, or the `EDUCATION` list in
  `calc.js` should change. The app doesn't use `:below` subsumption because it isn't available on
  Meld. If A8 uses a descendant of 409073007, add it to the list.
* **The PAM 6/7/8/8a definitions are inferred** from the scenario row ("counts, median days with the
  team, education sessions per month"), not from the real dashboard's specification. They're worth
  checking with Metro North. For example: is PAM 7 over cleared patients only? Is 8a a monthly chart
  or a rate?
* **Counts include other teams' test data.** On 28 Oct there were 41 episodes: the 40 synthetic ones
  plus `soln-A9-episode-1` (status `finished`). Any episode of type `pam` counts.
* **Population scope.** The app reads with `user/*.read`, as the dashboard does. The usual Meld caveats
  apply (launch with a patient selected; standalone launch doesn't work), as described in
  `apps/pam-dashboard/README.md`.
* Up to 200 resources per page are read, and fhirclient follows `next` links (`pageLimit: 0`), so
  larger populations work. They are slower.
