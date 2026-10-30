# SMART on FHIR starter (GitHub Pages)

A starter SMART on FHIR app for the FHIR in Queensland Health Connectathon (Track 1, 29–30 Oct
2026). Plain HTML and JavaScript with [fhirclient.js](https://github.com/smart-on-fhir/client-js),
**no build step**: GitHub Pages serves the files exactly as you commit them.

| Folder | App | Scenarios |
|---|---|---|
| `/` (`index.html`, `app.js`) | **Patient app**: the launch patient and their Hb results | B1 |
| `population/` | **Population app**: the PAM outcomes dashboard (Hb and ferritin before and after treatment) | B2–B8 |

Settings for both are in **`config.js`**.

## Get it running (about 5 minutes)

1. **Use this template → Create a new repository.** Owner: you. **Public** (Pages on a free
   account needs a public repo).
2. In your new repo: **Settings → Pages → Build and deployment**: Source **Deploy from a branch**,
   branch **`main`**, folder **`/ (root)`**, **Save**.
3. After a minute or so, Settings → Pages shows your site: `https://<you>.github.io/<repo>/`.
   Try it without logging in:
   `https://<you>.github.io/<repo>/?fhirServiceUrl=https://gw.interop.community/QHConnectathon2026/open&patientId=pam-demo`
4. **Send Jim** your app's details for a client ID:

   ```
   Name / app:     B1 Hb viewer (your names)
   Launch URI:     https://<you>.github.io/<repo>/
   Redirect URI:   https://<you>.github.io/<repo>/
   Scopes:         launch openid fhirUser patient/*.read
   ```

   For the population app, a separate one:

   ```
   Launch URI:     https://<you>.github.io/<repo>/population/launch.html
   Redirect URI:   https://<you>.github.io/<repo>/population/
   Scopes:         launch openid fhirUser online_access user/*.read
   ```

5. Put the client ID(s) in **`config.js`** (pencil icon → edit → **Commit changes**). Pages
   republishes in about a minute (progress under **Actions**).
6. **Launch from Meld** (sandbox `QHConnectathon2026`) **with a patient selected**.

## Change it

Edit in the browser (pencil icon) or clone and push. Every commit to `main` republishes.

* Patient app: `app.js`. `client.patient.id` is the launch patient; `client.request(...)` adds the
  token. Need more access (e.g. `patient/*.write`)? Add it to `scope` in `config.js` **and** ask
  Jim to add it to your registration: you can only request scopes that are registered.
* Population app: `population/index.html`. It reads with `user/*.read` and ignores the launch
  patient.

## Gotchas on Meld

* Write `|` in searches as **`%7C`** (`code=http://loinc.org%7C718-7`). A raw `|` gets HTTP 400,
  which the browser reports as a CORS error. Testing through
  [launch.smarthealthit.org](https://launch.smarthealthit.org)? Its proxy also turns `//` into `/`,
  so encode the whole value: `'code=' + encodeURIComponent('http://loinc.org|718-7')`.
* **Launch with a patient selected**, or Meld's launcher stops on a blank page.
* **SMART v1 scopes only** (`patient/*.read`, not `patient/*.rs`).
* Redirect URIs must match **exactly**, trailing `/` included.
* **Relaunch in a new tab** in your own apps: fhirclient's `init()` revives the previous session in
  the same tab (*Patient is not available*). This template's `app.js` starts a fresh login whenever
  Meld sends a new launch code.
* Don't change the shared patients (`pam-001`..`pam-040`, `pam-demo`): other people use them.

More: the [Track 1 decks](https://aehrc.github.io/qh-connectathon/decks/) (SMART apps) and the
[scenarios](https://github.com/aehrc/qh-connectathon/blob/main/2026-10-29/1-FHIR-For-Users/Scenarios.md).
