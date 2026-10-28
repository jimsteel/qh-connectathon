// B1: patient summary for the blood management nurse. EHR launch from Meld (patient/*.read),
// or no login: ?fhirServiceUrl=https://gw.interop.community/QHConnectathon2026/open&patientId=pam-demo
// Optional ?today=YYYY-MM-DD fixes "today" (for days to surgery / with the team) for demos and tests.

const params = new URLSearchParams(location.search);
const cfg = window.SMART_CONFIG;
const L = window.PamLogic;
const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';
const TODAY = params.get('today') || new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const COLOURS = { series: '#00738F', threshold: '#B9531A', treatment: '#5B6B78', surgery: '#0A2033', grid: '#E6ECF0' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = (s) => (s ? new Date(s.substring(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const text = (cc) => cc?.text || cc?.coding?.[0]?.display || cc?.coding?.[0]?.code || '';
const localCode = (ccs, cs) => (ccs || []).flatMap((c) => c.coding || []).find((c) => c.system === `${LOCAL}/${cs}`);
const humanName = (r) => { const n = (r?.name || [])[0]; return n ? [(n.prefix || []).join(' '), (n.given || []).join(' '), n.family].filter(Boolean).join(' ') : ''; };

// A new launch from Meld (a new 'launch' code) starts a fresh login rather than reviving the previous
// session in this tab (same fix as apps/smart-starter).
if (params.get('launch') && params.get('launch') !== sessionStorage.getItem('lastLaunch')) {
  sessionStorage.clear();
  sessionStorage.setItem('lastLaunch', params.get('launch'));
}

const launching = params.has('iss') || params.has('code') || params.has('fhirServiceUrl');
if (!launching && !sessionStorage.getItem('SMART_KEY')) {
  $('who').textContent = 'Not launched';
  $('message').innerHTML = '<div class="card"><p>Launch this app from Meld with a patient selected.</p>' +
    '<p class="muted">Or try it without logging in: add <code>?fhirServiceUrl=https://gw.interop.community/QHConnectathon2026/open&amp;patientId=pam-demo</code> to this page\'s URL.</p></div>';
} else {
  FHIR.oauth2.init({ clientId: cfg.clientId, scope: cfg.scope })
    .then(load)
    .catch((err) => { $('who').textContent = 'Error'; $('message').innerHTML = '<div class="card error">' + esc(err) + '</div>'; });
}

async function load(client) {
  const pid = client.patient.id;
  $('source').textContent = 'FHIR server: ' + client.state.serverUrl + ' · today = ' + TODAY;
  // '|' as %7C: Meld rejects a raw '|'
  const loinc = Object.values(L.LOINC).map((c) => 'http://loinc.org%7C' + c).join(',');
  const queries = {
    patient: `Patient/${pid}`,
    obs: `Observation?patient=${pid}&code=${loinc}&_count=200`,
    sr: `ServiceRequest?patient=${pid}&_include=ServiceRequest:performer&_include=ServiceRequest:requester&_count=100`,
    meds: `MedicationRequest?patient=${pid}&_include=MedicationRequest:requester&_count=100`,
    episodes: `EpisodeOfCare?patient=${pid}&_include=EpisodeOfCare:care-manager&_count=50`,
    conditions: `Condition?patient=${pid}&_count=100`,
    tasks: `Task?patient=${pid}&_count=100`,
  };
  $('queries').textContent = Object.values(queries).map((q) => 'GET ' + client.state.serverUrl + '/' + q.replaceAll('%7C', '|')).join('\n');

  const get = (q) => client.request(q, { pageLimit: 0, flat: true }).catch((e) => { console.warn(q, e); return { error: e }; });
  const [patient, obs, sr, meds, episodes, conditions, tasks] = await Promise.all(Object.values(queries).map(get));
  if (patient.error) throw patient.error;

  // Included resources (Practitioner, Organization) by reference
  const byRef = {};
  for (const r of [sr, meds, episodes].flatMap((x) => (Array.isArray(x) ? x : []))) byRef[`${r.resourceType}/${r.id}`] = r;
  const refName = (ref) => {
    if (!ref) return '';
    const r = byRef[ref.reference];
    const name = r && (typeof r.name === 'string' ? r.name : humanName(r));  // Organization.name is a string
    return (name || ref.display || ref.reference || '').replace(' (synthetic)', '');
  };
  const only = (xs, type) => (Array.isArray(xs) ? xs.filter((r) => r.resourceType === type) : []);

  // --- Patient
  const sex = patient.gender;
  const age = patient.birthDate ? Math.floor(L.daysBetween(patient.birthDate, TODAY) / 365.25) : null;
  $('who').textContent = `${humanName(patient)} · ${sex || 'sex not recorded'}${age != null ? ', ' + age + ' years' : ''} · born ${fmtDate(patient.birthDate)} · id ${patient.id}`;

  // --- Pathology and classification
  const series = L.seriesByTest(only(obs, 'Observation'));
  const initial = L.initialValues(series), latest = L.valuesAt(series, null);
  const cInitial = L.classify({ sex, ...initial }), cLatest = L.classify({ sex, ...latest });
  $('t-pathway').innerHTML = `<span class="tone ${cLatest.tone}">${esc(cLatest.pathway)}</span>`;

  const units = { hb: 'g/L', ferritin: 'µg/L', tsat: '%', crp: 'mg/L' };
  const names = { hb: 'Haemoglobin', ferritin: 'Ferritin', tsat: 'Transferrin saturation', crp: 'CRP' };
  const abnormal = { hb: (v) => cLatest.hbThreshold != null && v < cLatest.hbThreshold, ferritin: (v) => v < L.FERRITIN_LOW, tsat: (v) => v < L.TSAT_LOW, crp: (v) => v > L.CRP_HIGH };
  const cell = (k, x) => (x ? `<span class="${abnormal[k](x.value) ? 'flag' : ''}">${esc(x.value)}</span> <span class="muted">${fmtDate(x.date)}</span>` : '<span class="muted">–</span>');
  $('labs').innerHTML = '<table><tr><th>Test</th><th>Earliest</th><th>Latest</th><th>n</th></tr>' +
    Object.keys(units).map((k) => { const xs = series[k]; return `<tr><td>${names[k]} <span class="muted">${units[k]}</span></td><td>${cell(k, xs[0])}</td><td>${xs.length > 1 ? cell(k, xs[xs.length - 1]) : '<span class="muted">–</span>'}</td><td>${xs.length}</td></tr>`; }).join('') +
    '</table><p class="muted">Red: outside the threshold (Hb &lt; ' + (cLatest.hbThreshold ?? '?') + ' for ' + esc(sex || 'unknown sex') +
    ', ferritin &lt; 100, TSAT &lt; 20, CRP &gt; 10).</p>';

  const yn = (b) => (b === null ? '<span class="muted">unknown</span>' : b ? 'yes' : 'no');
  $('classes').innerHTML = '<table><tr><th></th><th>At referral</th><th>Latest</th></tr>' +
    `<tr><td>Anaemia</td><td>${yn(cInitial.anaemia)}</td><td>${yn(cLatest.anaemia)}</td></tr>` +
    `<tr><td>Iron deficiency</td><td>${yn(cInitial.ironDeficiency)}</td><td>${yn(cLatest.ironDeficiency)}</td></tr>` +
    `<tr><td>Inflammation</td><td>${yn(cInitial.inflammation)}</td><td>${yn(cLatest.inflammation)}</td></tr>` +
    `<tr><td>Pathway</td><td><span class="tone ${cInitial.tone}">${esc(cInitial.pathway)}</span></td><td><span class="tone ${cLatest.tone}">${esc(cLatest.pathway)}</span></td></tr></table>` +
    '<p class="muted">Anaemia: Hb &lt; 130 g/L (male) / 120 g/L (female). Iron deficiency: ferritin &lt; 100 µg/L, or TSAT &lt; 20% with ferritin 100–300. Inflammation: CRP &gt; 10 mg/L. "At referral" uses each test\'s earliest result; "latest" its newest.</p>';

  // --- Surgery: the waitlist entry is the ServiceRequest with an elective category; the referral has a referral source
  const srs = only(sr, 'ServiceRequest').filter((s) => !['entered-in-error', 'revoked'].includes(s.status));
  const waitlist = srs.filter((s) => localCode(s.category, 'elective-category') || (s.occurrenceDateTime && !localCode(s.category, 'referral-source')))
    .sort((a, b) => (a.occurrenceDateTime || '').localeCompare(b.occurrenceDateTime || ''));
  // The next booked surgery from today, else the most recent one
  const surgery = waitlist.find((s) => (s.occurrenceDateTime || '').substring(0, 10) >= TODAY) || waitlist[waitlist.length - 1];
  const referral = srs.filter((s) => localCode(s.category, 'referral-source')).sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))[0];
  const surgeryDate = surgery?.occurrenceDateTime?.substring(0, 10);
  if (surgeryDate) {
    const d = L.daysBetween(TODAY, surgeryDate);
    $('t-days').textContent = d >= 0 ? d : `${-d} days ago`;
    $('t-surgery').innerHTML = `${esc(text(surgery.code))} on ${fmtDate(surgeryDate)}<br><span class="muted">${esc(refName(surgery.performer?.[0]))} · ${esc(localCode(surgery.category, 'elective-category')?.display || '')}</span>`;
  } else {
    $('t-days').textContent = '–';
    $('t-surgery').innerHTML = '<span class="muted">No booked surgery (waitlist ServiceRequest) found</span>';
  }

  // --- Episode with the blood management team (days with the team = EpisodeOfCare.period length)
  const eps = only(episodes, 'EpisodeOfCare').filter((e) => e.status !== 'entered-in-error').sort((a, b) => (b.period?.start || '').localeCompare(a.period?.start || ''));
  const ep = eps[0];
  if (ep?.period?.start) {
    const end = ep.period.end?.substring(0, 10) || TODAY;
    const label = { active: 'Being managed', finished: 'Cleared', planned: 'Planned', waitlist: 'Waitlist', onhold: 'On hold', cancelled: 'Cancelled' }[ep.status] || ep.status;
    $('t-episode').textContent = L.daysBetween(ep.period.start.substring(0, 10), end) + ' days';
    $('t-episode-d').innerHTML = `${esc(label)} · referred ${fmtDate(ep.period.start)}${ep.period.end ? ' · cleared ' + fmtDate(ep.period.end) : ''}` +
      (ep.careManager ? `<br><span class="muted">Nurse: ${esc(refName(ep.careManager))}</span>` : '');
  } else {
    $('t-episode').textContent = '–';
    $('t-episode-d').innerHTML = '<span class="muted">No EpisodeOfCare found</span>';
  }

  // --- Treatments
  const mrs = only(meds, 'MedicationRequest').filter((m) => !['entered-in-error', 'cancelled'].includes(m.status))
    .sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''));
  const dose = (m) => { const q = m.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity; return q ? `${q.value} ${q.unit || q.code || ''}` : (m.dosageInstruction?.[0]?.text || ''); };
  const medName = (m) => text(m.medicationCodeableConcept) || m.medicationReference?.display || m.medicationReference?.reference || '';
  $('t-treat').textContent = mrs.length;
  $('t-treat-d').innerHTML = mrs.length ? `Latest: ${esc(medName(mrs[0]).replace(/ injection.*$/, ''))}, ${fmtDate(mrs[0].authoredOn)}` : '<span class="muted">No MedicationRequest recorded</span>';
  $('treatments').innerHTML = mrs.length
    ? '<table><tr><th>Date</th><th>Medication</th><th>Dose</th><th>Status</th></tr>' + mrs.map((m) =>
      `<tr><td>${fmtDate(m.authoredOn)}</td><td>${esc(medName(m))}<br><span class="muted">${esc(refName(m.requester))}</span></td><td>${esc(dose(m))}</td><td>${esc(m.status)}</td></tr>`).join('') + '</table>'
    : '<p class="muted">No treatments recorded.</p>';

  // --- Surgery details, diagnosis, follow-up tasks
  const conds = only(conditions, 'Condition').filter((c) => text(c.verificationStatus) !== 'entered-in-error');
  const openTasks = only(tasks, 'Task').filter((t) => !['completed', 'cancelled', 'entered-in-error', 'rejected', 'failed'].includes(t.status));
  $('other').innerHTML = '<table>' +
    `<tr><th>Surgery</th><td>${surgery ? `${esc(text(surgery.code))}, ${fmtDate(surgeryDate)}<br><span class="muted">${esc(refName(surgery.performer?.[0]))} · ${esc(refName(surgery.requester))}</span>` : '<span class="muted">none found</span>'}</td></tr>` +
    `<tr><th>Referred by</th><td>${referral ? `${esc(localCode(referral.category, 'referral-source').display)}, ${fmtDate(referral.authoredOn)}` : '<span class="muted">no referral found</span>'}</td></tr>` +
    `<tr><th>Recorded diagnosis</th><td>${conds.length ? conds.map((c) => `${esc(text(c.code) || '(no code)')} <span class="muted">${fmtDate(c.recordedDate || c.onsetDateTime)}</span>`).join('<br>') : '<span class="muted">none</span>'}</td></tr>` +
    `<tr><th>Open follow-ups</th><td>${openTasks.length ? openTasks.map((t) => `${esc(text(t.code) || t.description)} <span class="muted">due ${fmtDate(t.restriction?.period?.end || t.executionPeriod?.end)}</span>`).join('<br>') : '<span class="muted">none</span>'}</td></tr>` +
    '</table>';

  // --- Charts: one test each (one y axis), threshold lines, IV iron dates and the surgery date as markers
  const events = [
    // One line per order; only the earliest is labelled, so several orders close together stay legible
    ...mrs.filter((m) => m.authoredOn).map((m) => m.authoredOn.substring(0, 10)).sort()
      .map((date, i, all) => ({ date, label: i === 0 ? (all.length > 1 ? `IV iron (${all.length})` : 'IV iron') : '', colour: COLOURS.treatment })),
    ...(surgeryDate ? [{ date: surgeryDate, label: 'Surgery', colour: COLOURS.surgery }] : []),
  ];
  const hbT = cLatest.hbThreshold;
  $('hb-sub').textContent = 'g/L · LOINC 718-7 · ' + (hbT ? `anaemia below ${hbT} (${sex})` : 'no sex recorded, so no threshold');
  trend('hb-chart', series.hb, 'Hb', 'g/L', hbT ? [{ y: hbT, label: `Anaemia < ${hbT} g/L` }] : [], events);
  trend('ferritin-chart', series.ferritin, 'Ferritin', 'µg/L', [{ y: L.FERRITIN_LOW, label: 'Iron deficiency < 100 µg/L' }], events);
}

function trend(el, points, name, unit, thresholds, events) {
  const x = points.map((p) => p.date), y = points.map((p) => p.value);
  const dates = [...x, ...events.map((e) => e.date)].sort();
  const pad = 7 * 86400000;
  const range = dates.length ? [new Date(new Date(dates[0]).getTime() - pad), new Date(new Date(dates[dates.length - 1]).getTime() + pad)] : undefined;
  const ys = [...y, ...thresholds.map((t) => t.y)];
  const yRange = ys.length ? [Math.max(0, Math.min(...ys) * 0.8), Math.max(...ys) * 1.15] : undefined;
  const shapes = [], annotations = [];
  for (const t of thresholds) {
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: t.y, y1: t.y, line: { color: COLOURS.threshold, width: 2, dash: 'dash' } });
    annotations.push({ xref: 'paper', x: 0, y: t.y, yanchor: 'bottom', xanchor: 'left', text: t.label, showarrow: false, font: { size: 11, color: COLOURS.threshold } });
  }
  for (const e of events) {
    shapes.push({ type: 'line', yref: 'paper', y0: 0, y1: 1, x0: e.date, x1: e.date, line: { color: e.colour, width: 1, dash: 'dot' } });
    if (e.label) annotations.push({ yref: 'paper', y: 1, x: e.date, yanchor: 'bottom', xanchor: 'left', text: e.label, showarrow: false, font: { size: 11, color: e.colour } });
  }
  const trace = { type: 'scatter', mode: 'lines+markers', name, x, y, line: { color: COLOURS.series, width: 2 }, marker: { color: COLOURS.series, size: 9 },
    hovertemplate: `%{x|%d %b %Y}<br>${name} <b>%{y}</b> ${unit}<extra></extra>` };
  Plotly.react(el, points.length ? [trace] : [], {
    margin: { t: 28, r: 16, b: 36, l: 48 }, showlegend: false, hovermode: 'closest',
    xaxis: { type: 'date', range, gridcolor: COLOURS.grid }, yaxis: { title: { text: unit }, range: yRange, gridcolor: COLOURS.grid, zeroline: false },
    shapes, annotations: points.length ? annotations : [{ xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, text: `No ${name} results`, showarrow: false }],
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif', size: 12, color: '#0A2033' },
  }, { displayModeBar: false, responsive: true });
}
