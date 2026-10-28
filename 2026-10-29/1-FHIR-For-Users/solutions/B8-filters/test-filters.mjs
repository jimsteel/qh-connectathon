// Tests every filter in pam-filters.js against the Meld open endpoint (read-only).
//   node test-filters.mjs [FHIR base]
// For each filter set it compares three answers:
//   truth   - computed here in JS from ALL ServiceRequests (no server-side filtering)
//   cohort  - PamFilters.cohort(): two filtered ServiceRequest searches, joined on the patient
//   _has    - one Patient search with PamFilters.hasParams() (informational where it is known to differ)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('./pam-filters.js');

const BASE = process.argv[2] || 'https://gw.interop.community/QHConnectathon2026/open';
let requests = 0;

async function search(q) {
  let url = `${BASE}/${q}${q.includes('?') ? '&' : '?'}_format=json`;
  const out = [];
  while (url) {
    requests++;
    const r = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const b = await r.json();
    (b.entry || []).forEach((e) => out.push(e.resource));
    url = (b.link || []).find((l) => l.relation === 'next')?.url;
  }
  return out;
}

// ---- Ground truth from the full data set -------------------------------------------------------
const all = await search('ServiceRequest?_count=200');
const pid = (r) => r.subject.reference.split('/').pop();
const refs = all.filter((r) => F.isReferral(r));
const wls = all.filter((r) => (r.category || []).some((c) => c.coding?.some((x) => x.system === F.SYS.category)));
const code = (r, sys) => r.category?.flatMap((c) => c.coding).find((x) => x.system === sys)?.code;

// A patient is in the cohort if ANY of their referrals and ANY of their waitlist entries match
function truth(f) {
  const perf = F.performerIds(f);
  const refOk = (r) => !(f.source && code(r, F.SYS.source) !== f.source) && !(f.from && r.authoredOn < f.from) && !(f.to && r.authoredOn > f.to);
  const wlOk = (w) => !(f.category && code(w, F.SYS.category) !== f.category) && !(perf && !perf.includes(w.performer?.[0]?.reference.split('/').pop()));
  const a = new Set(refs.filter(refOk).map(pid)), b = new Set(wls.filter(wlOk).map(pid));
  return new Set([...a].filter((id) => b.has(id)));
}

const cases = [
  ['no filters', {}],
  ...F.DIRECTORATES.map((d) => [`directorate=${d.id}`, { directorate: d.id }]),
  ...F.UNITS.map((u) => [`unit=${u.label}`, { unit: u.id }]),
  ...F.CATEGORIES.map((c) => [`category=${c.code}`, { category: c.code }]),
  ...F.SOURCES.map((s) => [`source=${s.code}`, { source: s.code }]),
  ['timeframe FY2025-26', { from: '2025-07-01', to: '2026-06-30' }],
  ['timeframe FY2025-26 Q2', { from: '2025-10-01', to: '2025-12-31' }],
  ['timeframe FY2026-27', { from: '2026-07-01', to: '2027-06-30' }],
  ['surgical + category 2', { directorate: 'surgical', category: '2' }],
  ['orthopaedics + surgeon + FY2025-26', { unit: 'pam-unit-orthopaedics', source: 'surgeon', from: '2025-07-01', to: '2026-06-30' }],
  ['womens directorate + urology unit (empty)', { directorate: 'womens', unit: 'pam-unit-urology' }],
];

const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
let fails = 0;
const rows = [];
for (const [name, f] of cases) {
  const t = truth(f);
  const c = await F.cohort(search, f);
  const okCohort = eq(t, c.patientIds);
  let hasN = '-', okHas = null;
  if (!c.queries.empty) {
    const pats = await search(`Patient?${F.hasParams(f)}&_elements=id&_count=200`);
    const h = new Set(pats.map((p) => p.id));
    hasN = h.size; okHas = eq(t, h);
  }
  if (!okCohort) fails++;
  rows.push([name, t.size, c.patientIds.size, hasN, okCohort ? 'PASS' : 'FAIL', okHas === null ? 'n/a' : okHas ? 'same' : 'DIFFERS']);
  console.log(`${okCohort ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} truth=${String(t.size).padStart(2)} cohort=${String(c.patientIds.size).padStart(2)} _has=${String(hasN).padStart(2)} ${okHas === false ? '(_has differs)' : ''}`);
}

// Views scoped to a cohort: Observation search with patient= chunks vs the patient:Patient._has chain
const f = { directorate: 'surgical', category: '2' };
const c = await F.cohort(search, f);
const obsScoped = await F.searchScoped(search, 'Observation?code=718-7', c.patientIds);
const obsHas = await search(`Observation?code=718-7&${F.hasParams(f, 'patient:Patient.')}&_count=200`);
const okObs = obsScoped.length === obsHas.length && obsScoped.every((o) => c.patientIds.has(pid(o)));
if (!okObs) fails++;
console.log(`${okObs ? 'PASS' : 'FAIL'}  Hb Observations for 'surgical + category 2': patient= chunks ${obsScoped.length}, patient:Patient._has ${obsHas.length}`);

console.log(`\n${fails ? 'FAILED' : 'ALL PASS'} (${cases.length + 1} checks, ${requests} HTTP requests to ${BASE})`);
if (process.env.MD) {
  console.log('\n| Filters | Truth | cohort() | `_has` | cohort() vs truth | `_has` vs truth |\n|---|---|---|---|---|---|');
  rows.forEach((r) => console.log(`| ${r.join(' | ')} |`));
}
process.exit(fails ? 1 : 0);
