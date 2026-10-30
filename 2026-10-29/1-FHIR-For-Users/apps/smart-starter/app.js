// A minimal SMART on FHIR app: EHR launch from Meld, then the launch patient and their Hb results.
// No build step: edit, commit, and GitHub Pages serves it as is.

const params = new URLSearchParams(location.search);
const cfg = window.SMART_CONFIG;

function show(id, html) { document.getElementById(id).innerHTML = html; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// A new launch from Meld (a new 'launch' code) must start a fresh login: otherwise fhirclient's init()
// revives the previous session in this tab, which has no token or patient ("Patient is not available").
// Only on a new code, so a bounce back with the same code shows the error instead of looping.
if (params.get('launch') && params.get('launch') !== sessionStorage.getItem('lastLaunch')) {
  sessionStorage.clear();
  sessionStorage.setItem('lastLaunch', params.get('launch'));
}

// Opened without a launch from Meld, and not in no-login mode: say what to do instead of failing.
// (fhirclient revives an earlier session from sessionStorage, so only check on a fresh visit.)
const launching = params.has('iss') || params.has('code') || params.has('fhirServiceUrl');
if (!launching && !sessionStorage.getItem('SMART_KEY')) {
  show('patient', '<p>Launch this app from Meld with a patient selected.</p>' +
    '<p class="muted">Or try it without logging in: add <code>?fhirServiceUrl=https://gw.interop.community/QHConnectathon2026/open&amp;patientId=pam-demo</code> to this page\'s URL.</p>');
  show('hb', '');
} else {
  // init() does both halves of the launch: sends the browser to authorize on the first visit,
  // and swaps the code for a token when it comes back. With ?fhirServiceUrl= it skips OAuth.
  FHIR.oauth2.init({ clientId: cfg.clientId, scope: cfg.scope })
    .then(client => {
      show('source', 'FHIR server: ' + esc(client.state.serverUrl));
      return Promise.all([showPatient(client), showHb(client)]);
    })
    .catch(err => show('patient', '<p class="error">' + esc(err) + '</p>'));
}

async function showPatient(client) {
  const p = await client.patient.read();
  const name = (p.name || [])[0] || {};
  show('patient', '<strong>' + esc([(name.given || []).join(' '), name.family].join(' ')) + '</strong>' +
    ' <span class="muted">' + esc(p.gender) + ', born ' + esc(p.birthDate) + ' (id ' + esc(p.id) + ')</span>');
}

async function showHb(client) {
  // Encode the system|code value: Meld rejects a raw '|' (HTTP 400), and the
  // launch.smarthealthit.org proxy collapses an unencoded '//'.
  const hb = await client.request(
    'Observation?code=' + encodeURIComponent('http://loinc.org|718-7') + '&patient=' + client.patient.id + '&_sort=-date',
    { flat: true });
  if (!hb.length) { show('hb', 'No Hb results.'); return; }
  show('hb', '<table><tr><th>Date</th><th>Hb</th><th>Id</th></tr>' + hb.map(o =>
    '<tr><td>' + esc((o.effectiveDateTime || '').substring(0, 10)) + '</td>' +
    '<td>' + esc(o.valueQuantity?.value) + ' ' + esc(o.valueQuantity?.unit) + '</td>' +
    '<td class="muted">' + esc(o.id) + '</td></tr>').join('') + '</table>');
}
