# FHIR for Services — Track 2A

**2A: Provider Directory and Workflow Services · FHIR in Queensland Health Connectathon · 29–30 October 2026**

> **Scope note:** the Track 2A example (including the directory service replica) is a FHIR
> referral/workflow scenario. It is **unrelated to the radiology / HL7v2 example for the
> breakout** (`ris-hl7v2-tutorial`, "Caret"). The two share no infrastructure, namespaces, data or
> hostnames.

Led by Michael Osborne, this stream focuses on referral and workflow orchestration patterns
using FHIR services. Activities may include:

* Discovering services using the Qld Health Provider Directory on FHIR
* Creating and managing ServiceRequest, Task and Appointment workflows
* Exploring referral pathways and provider discovery
* Building workflow solutions that support referral routing and service coordination
* Developing FHIR profiles and implementation guide content to support workflow interoperability
* Testing end-to-end workflow scenarios using real-world Queensland Health use cases

## Flagship scenario

**Radiology Referral with Directory Discovery and Booking.** An end-to-end workflow where a
referrer discovers a suitable imaging service in the Qld Health Provider Directory on FHIR,
raises a FHIR referral (ServiceRequest + Task with supporting information), and books an
appointment against slots the imaging provider publishes — with the referral status tracked
through a Task until the appointment is confirmed.

The scenario exercises AU Core, AU eRequesting, the QH referrals IG, the Qld Health Provider Directory on FHIR
search, and FHIR R4 scheduling (Schedule/Slot/Appointment), split into a **browser core** path
and a **developer deep-dive** stream.

## Track leads

Daniel Foulkes (AEHRC) · Joern Guy Suess (AEHRC)

## Contents

| Document | Purpose |
|----------|---------|
| [`QH-Radiology-Referral-Scenario-DRAFT.md`](QH-Radiology-Referral-Scenario-DRAFT.md) | The flagship scenario proposal: systems, roles, standards, workflow steps, test cases, and open decisions. |
| [`Services-Track-Concrete-Time-Plan.md`](Services-Track-Concrete-Time-Plan.md) | Concrete two-day time plan mapping the scenario onto the official event program, with a session budget and integration notes. |
| [`Services-Track-Two-Day-Agenda.md`](Services-Track-Two-Day-Agenda.md) | The block-level two-day agenda (AM / Mid / PM / Close) extracted from the scenario proposal. |
| [`2026-09-28-Services-Track-Discussion-Recap.md`](2026-09-28-Services-Track-Discussion-Recap.md) | Recap, decisions, action items and ideas from the 28 Sep 2026 planning meeting. |
| [`Track2-KickOff-Deck.md`](Track2-KickOff-Deck.md) / `.pptx` | Kick-off slide deck (Marp source + rendered editable PowerPoint). |
| [`api/`](api/QH-Track2-API-Guide.md) | **API guide** for participants, with the downloadable Postman collection + environments and the fhir-frog TestScript library. Rebuild with `api/build.sh`. |
| [`slides/`](slides/) | Slide build: `Makefile`, PlantUML diagram sources, and build output. |
| [`ig/`](ig/) | The **Radiology Referral and Booking IG** ([aehrc/radiology-referral](https://github.com/aehrc/radiology-referral)) as a git submodule, tracking its `main` branch. |
| `Daniel Joern Guy Paul Michael O/` | Working materials: EOI insights, early thoughts, meeting notes, and the external-service-access investigation. |

## Building the slides

The kick-off deck is authored in [Marp](https://marp.app/) Markdown with PlantUML-rendered
diagrams. Build it from the `slides/` directory:

```bash
cd slides
make            # render diagrams + build the editable PPTX
make preview    # per-slide PNG previews in build/preview/
make pdf        # PDF export
make help       # list targets
```

Requires `marp`, `plantuml` (+ Java, Graphviz), Chromium, and LibreOffice — all present on the
CSIRO dev image. Edit `Track2-KickOff-Deck.md` (and the `slides/diagrams/*.puml`) and re-run `make`.

## Implementation Guide

The FHIR profiles for this scenario live in a separate repository,
[**aehrc/radiology-referral**](https://github.com/aehrc/radiology-referral) — the *Radiology
Referral and Booking IG* (Connected Test Scenario 1). It builds on **AU eRequesting 1.0.1**,
AU Core 2.0.0 and AU Base 6.0.0, and profiles the Referral ServiceRequest, Referral Task,
Booking Schedule/Slot, and Referral Appointment used throughout the scenario and slides.

It is included here as a **git submodule** at [`ig/`](ig/), tracking its `main` branch:

```bash
# first checkout
git submodule update --init --recursive

# pull the latest IG from its default branch
git submodule update --remote 2026-10-29/2-FHIR-For-Services/ig
```

## Reference client — Patient-Referral

The **Referrer** role in the scenario is implemented by **Patient-Referral**, a Flask app
built for **Sparked Connected Testing Scenario 1 (eRequest/eReferral)** — the same scenario
lineage as our IG. The live instance runs at **https://ui.efiq.hospservices.net/** and is
already pointed at the Qld Health Provider Directory on FHIR.

It covers most of our flow out of the box:

| Scenario step | Patient-Referral feature |
|---------------|--------------------------|
| Discover (search Qld Health Provider Directory on FHIR) | Provider Directory search (name / suburb / postcode / service type) |
| Create referral | AU eRequesting `ServiceRequest` bundle from search to submission; SNOMED CT indication via Ontoserver |
| Filler triage | Filler / Specialist view — Task inbox for the receiving specialist |
| Track this request | Task status lifecycle |

It gives the **browser-core stream** a real UI (discover → refer → track) while the developer
deep-dive drives the FHIR API directly. It also renders any FHIR bundle as a Mermaid diagram —
useful for teaching. See the open `track:services` issues for the integration gaps still to
close (booking/scheduling step, target FHIR server, IG conformance).

## Keeping SharePoint and GitHub in sync

`scripts/sync-sharepoint-github.sh` syncs this Track 2 content between the SharePoint document
library (via `shit`) and this repository (via `git`). The sync is directional:

- **pull** — SharePoint → GitHub: refresh shared working materials (the `Daniel Joern Guy Paul
  Michael O/` folder) into the repo and commit.
- **push** — GitHub → SharePoint: publish the human-readable deliverables (README, AGENTS,
  scenario, agenda, time plan, recap, and the kick-off deck `.md` + `.pptx`) back to the library
  so the wider team can see them. Source/build material (`slides/`, `scripts/`, the `ig/`
  submodule) stays in git only.

```bash
cd scripts
./sync-sharepoint-github.sh              # dry-run of both directions (no writes)
./sync-sharepoint-github.sh pull --apply # refresh repo from SharePoint & commit
./sync-sharepoint-github.sh push --apply -m "Publish Track 2 updates"
```

Because `shit push` writes versions to a **shared** SharePoint library, the script defaults to
**dry-run**; pass `--apply` to make changes. Paths are configurable via the `SHIT_REPO` and
`GIT_REPO` environment variables.

## Event schedule (Track 2 blocks)

Times are fixed by the official event program (DRAFT); Track 2 content fills the track sessions.

**Day 1 — Thu 29 Oct:** kick-off & environment (11:30–13:00) → discovery (14:00–15:00) →
referral creation (15:30–17:00).

**Day 2 — Fri 30 Oct:** filler triage & availability (9:30–10:30) → booking (11:00–12:30) →
status tracking + stretch (13:30–15:00) → Show and Tell demo (15:30–16:30).

See the concrete time plan for the full mapping including plenaries and breaks.

## Status & how to contribute

Work is tracked via [GitHub issues](https://github.com/aehrc/qh-connectathon/issues):

* **Planning tasks** (#1–#3) — scenario review, group feedback, stakeholder engagement.
* **Pre-event dependencies** (#8–#11) — Qld Health Provider Directory on FHIR access, directory↔referral-server linkage,
  QH referrals IG version, and 2026 FHIR server URLs. These must resolve before 29 Oct or the
  corresponding schedule blocks cannot run.

Draft content lives here in the repository; SharePoint is used for broader checkpoints and
visibility. Contributions and review via pull request and issues are welcome.
