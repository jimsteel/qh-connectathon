# Smart Forms that opens the PAM full solution

A copy of the track's patched Smart Forms build (the one on
`https://aehrc.github.io/qh-connectathon/smart-forms/`), repointed to this folder, whose
`config.json` opens the assembled solution form at launch:
`https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/pam-root|0.2.0-assembled`
(`soln-pam-assembled` on Meld). The shared Smart Forms keeps opening the starter form.

Registered in the `QHConnectathon2026` Meld sandbox as its own app (client ID in `config.json`):

* Launch URI: `https://jimsteel.github.io/qh-connectathon/2026-10-29/1-FHIR-For-Users/solutions/smart-forms/launch`
* Redirect URI: `https://jimsteel.github.io/qh-connectathon/2026-10-29/1-FHIR-For-Users/solutions/smart-forms/`

How it was made: the aehrc `gh-pages` `smart-forms/` folder, with `/qh-connectathon/smart-forms`
replaced by this folder's path in `index.html` and the two `assets/index-*` files, and
`launch/index.html` a copy of `index.html` (this site has no SPA fallback; GitHub Pages
redirects `/launch` to `/launch/` keeping the query). Saving or writing back writes to Meld.
