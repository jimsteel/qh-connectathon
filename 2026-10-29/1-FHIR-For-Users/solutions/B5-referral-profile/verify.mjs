// B5 verification (read-only): the app headless against the Meld open endpoint for each timeframe; its
// tallies checked against (a) an independent computation from direct, unfiltered FHIR reads and (b) the
// generator's bundle (data/pam-synthetic-bundle.json) for the pam-0xx patients. Plus unit tests of calc.js.
//   cd T/decks && node ../solutions/B5-referral-profile/verify.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = require(path.join(here, '../../decks/node_modules/playwright'));
const P = require('./calc.js');

const BASE = 'https://gw.interop.community/QHConnectathon2026/open';
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';

// --- 1. Unit tests on a tiny fixture
const fx = [
  { resourceType: 'Organization', id: 'u1', name: 'Orthopaedics (synthetic)' },
  { resourceType: 'ServiceRequest', id: 'w1', status: 'active', subject: { reference: 'Patient/a' }, category: [{ coding: [{ system: `${LOCAL}/elective-category`, code: '2' }] }], performer: [{ reference: 'Organization/u1' }] },
  { resourceType: 'ServiceRequest', id: 'r1', status: 'completed', subject: { reference: 'Patient/a' }, authoredOn: '2026-01-10', code: { coding: [{ system: 'http://snomed.info/sct', code: '3457005' }] }, category: [{ coding: [{ system: `${LOCAL}/referral-source`, code: 'gp', display: 'General practitioner' }] }], supportingInfo: [{ reference: 'ServiceRequest/w1' }] },
  { resourceType: 'ServiceRequest', id: 'r2', status: 'completed', subject: { reference: 'Patient/b' }, authoredOn: '2026-08-10', code: { coding: [{ system: 'http://snomed.info/sct', code: '3457005' }] } },
  { resourceType: 'MedicationRequest', id: 'm0', status: 'completed', subject: { reference: 'Patient/a' }, authoredOn: '2025-12-01', medicationCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '1312141000168105' }] } },
  { resourceType: 'MedicationRequest', id: 'm1', status: 'completed', subject: { reference: 'Patient/a' }, authoredOn: '2026-01-20', medicationCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '1086251000168104' }] } },
  { resourceType: 'EpisodeOfCare', id: 'e2', status: 'finished', patient: { reference: 'Patient/b' }, period: { start: '2026-08-10' }, referralRequest: [{ reference: 'ServiceRequest/r2' }] },
];
const p1 = P.profile(fx, '', '');
const row = (id) => p1.rows.find((r) => r.referral === id);
check('unit via supportingInfo, name cleaned', row('r1').unit === 'Orthopaedics');
check('source from category display', row('r1').source === 'General practitioner' && row('r2').source === P.NOT_RECORDED);
check('treatment: latest MR after the referral (not the earlier one)', row('r1').treatment === 'IV iron: ferric derisomaltose');
check('treatment: none + finished episode = cleared without iron', row('r2').treatment === P.NO_IRON_CLEARED);
check('timeframe filter on authoredOn', P.profile(fx, '2026-07-01', '').rows.length === 1);
check('"Not recorded" sorts last', p1.source.at(-1)[0] === P.NOT_RECORDED);

// --- 2. Independent computation from direct reads
const all = async (type) => { const j = await (await fetch(`${BASE}/${type}?_count=500&_format=json`)).json(); return (j.entry || []).map((e) => e.resource); };
const [srs, orgs, mrs, eps] = await Promise.all(['ServiceRequest', 'Organization', 'MedicationRequest', 'EpisodeOfCare'].map(all));
const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name.replace(' (synthetic)', '')]));
const srMap = Object.fromEntries(srs.map((s) => [s.id, s]));
const id = (ref) => ref?.reference?.split('/').pop();
function expected(from, to) {
  const t = { unit: {}, source: {}, treatment: {} };
  const inc = (k, v) => { t[k][v] = (t[k][v] || 0) + 1; };
  for (const r of srs.filter((s) => s.code?.coding?.some((c) => c.code === '3457005') && s.status !== 'entered-in-error')) {
    const d = r.authoredOn.substring(0, 10);
    if ((from && d < from) || (to && d > to)) continue;
    const w = srMap[id(r.supportingInfo?.[0])] ?? srs.find((s) => id(s.subject) === id(r.subject) && s.category?.[0]?.coding?.[0]?.system?.endsWith('elective-category'));
    inc('unit', w?.performer ? orgName[id(w.performer[0])] : 'Not recorded');
    inc('source', r.category?.find((c) => c.coding?.[0]?.system?.endsWith('referral-source'))?.coding[0].display ?? 'Not recorded');
    const m = mrs.filter((x) => id(x.subject) === id(r.subject) && x.authoredOn.substring(0, 10) >= d && !['entered-in-error', 'cancelled'].includes(x.status)).sort((a, b) => b.authoredOn.localeCompare(a.authoredOn))[0];
    const ep = eps.find((e) => e.referralRequest?.some((x) => id(x) === r.id)) ?? eps.find((e) => id(e.patient) === id(r.subject));
    inc('treatment', m ? P.PRODUCTS[m.medicationCodeableConcept.coding[0].code] ?? m.medicationCodeableConcept.text : ep?.status === 'finished' ? P.NO_IRON_CLEARED : ep ? P.UNDECIDED : 'Not recorded');
  }
  return t;
}

// --- 3. The app, headless
const root = path.resolve(here, '..');
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(f)] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${server.address().port}/B5-referral-profile/?server=${encodeURIComponent(BASE)}`);
await page.waitForFunction(() => /referrals ·/.test(document.getElementById('status').textContent) || document.querySelector('#status.error'), null, { timeout: 60000 });
// The chart data as plotted: {label: count}
const plotted = () => page.evaluate(() => Object.fromEntries(['unit', 'source-chart', 'treatment'].map((el) => {
  const tr = document.getElementById(el).data[0];
  return [el === 'source-chart' ? 'source' : el, Object.fromEntries(tr.y.map((y, i) => [y, tr.x[i]]))];
})));
const sortObj = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
for (const [value, name] of [['|', 'All'], ['2025-07-01|2026-06-30', 'FY 2025-26'], ['2026-07-01|', 'FY 2026-27']]) {
  await page.selectOption('#timeframe', value);
  await page.waitForTimeout(400);
  const ui = await plotted();
  const exp = expected(...value.split('|'));
  for (const k of ['unit', 'source', 'treatment']) check(`${name}: ${k} matches direct reads`, sortObj(ui[k]) === sortObj(exp[k]), sortObj(ui[k]));
  if (value === '|') await page.screenshot({ path: path.join(here, 'screenshot-meld-all.png'), fullPage: true });
}

// --- 4. Against the generator's bundle (pam-0xx only): unit and source per referral
await page.selectOption('#timeframe', '|');
const rows = await page.evaluate(() => P.profile(resources, '', '').rows);
const bundle = JSON.parse(fs.readFileSync(path.join(here, '../../data/pam-synthetic-bundle.json'), 'utf8')).entry.map((e) => e.resource);
const bsr = Object.fromEntries(bundle.filter((r) => r.resourceType === 'ServiceRequest').map((r) => [r.id, r]));
let matched = 0, mismatched = [];
for (let n = 1; n <= 40; n++) {
  const pid = `pam-${String(n).padStart(3, '0')}`;
  const r = rows.find((x) => x.referral === `${pid}-referral`);
  const unitExp = bsr[`${pid}-surgery`].performer[0].reference.replace('Organization/pam-unit-', '');
  const srcExp = bsr[`${pid}-referral`].category[0].coding[0].display;
  if (r && r.unit.toLowerCase() === unitExp && r.source === srcExp) matched++; else mismatched.push(pid);
}
check('generator bundle: unit and source of all 40 pam referrals', matched === 40, mismatched.join(','));
const extra = rows.filter((r) => !/^pam-0\d\d-referral$/.test(r.referral)).map((r) => r.referral);
console.log(`      (referrals on Meld beyond the 40 synthetic ones: ${extra.length ? extra.join(', ') : 'none'})`);
check('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
