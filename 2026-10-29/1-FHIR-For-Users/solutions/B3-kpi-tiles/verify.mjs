// B3 verification (read-only): unit tests of calc.js; the app headless against the Meld open endpoint,
// tiles checked against direct FHIR queries for each timeframe; then the education tiles and chart with
// in-browser fixture sessions (Playwright intercepts the education searches; nothing is written to Meld).
//   cd T/decks && node ../solutions/B3-kpi-tiles/verify.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = require(path.join(here, '../../decks/node_modules/playwright'));
const K = require('./calc.js');

const BASE = 'https://gw.interop.community/QHConnectathon2026/open';
const TODAY = '2026-10-28';
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// --- 1. Unit tests
check('median odd/even/empty', K.median([3, 1, 2]) === 2 && K.median([1, 2, 3, 4]) === 2.5 && K.median([]) === null);
check('months across a year end', K.months('2025-11', '2026-02').join() === '2025-11,2025-12,2026-01,2026-02');
const edu = (type, id, extra) => ({ resourceType: type, id, status: 'completed', subject: { reference: 'Patient/pam-034' }, ...extra });
const SCT = 'http://snomed.info/sct';
const fixtures = [
  edu('Procedure', 'f1', { code: { coding: [{ system: SCT, code: '311401005', display: 'Patient education' }] }, performedDateTime: '2026-09-21' }),
  edu('Procedure', 'f2', { code: { coding: [{ system: SCT, code: '1234' }] }, category: { coding: [{ system: SCT, code: '409073007' }] }, performedPeriod: { start: '2026-10-02T10:00:00+10:00' } }),
  edu('Communication', 'f3', { category: [{ coding: [{ system: SCT, code: '311401005' }] }], sent: '2026-10-05T09:00:00+10:00', subject: { reference: 'Patient/pam-035' } }),
  edu('Communication', 'f4', { category: [{ coding: [{ system: SCT, code: '311401005' }] }], sent: '2025-08-10', subject: { reference: 'Patient/pam-001' } }),
  edu('Communication', 'not-edu', { category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/communication-category', code: 'notification' }] }], sent: '2026-10-05' }),
  edu('Procedure', 'not-pam', { code: { coding: [{ system: SCT, code: '311401005' }] }, performedDateTime: '2026-10-01', subject: { reference: 'Patient/someone-else' } }),
  edu('Procedure', 'not-done', { status: 'not-done', code: { coding: [{ system: SCT, code: '311401005' }] }, performedDateTime: '2026-10-01' }),
];
const eps = [
  { resourceType: 'EpisodeOfCare', id: 'e1', status: 'finished', patient: { reference: 'Patient/pam-001' }, period: { start: '2025-08-01', end: '2025-08-31' } },
  { resourceType: 'EpisodeOfCare', id: 'e2', status: 'finished', patient: { reference: 'Patient/pam-002' }, period: { start: '2026-07-01', end: '2026-07-11' } },
  { resourceType: 'EpisodeOfCare', id: 'e3', status: 'active', patient: { reference: 'Patient/pam-034' }, period: { start: '2026-10-03' } },
  { resourceType: 'EpisodeOfCare', id: 'e4', status: 'active', patient: { reference: 'Patient/pam-035' }, period: { start: '2026-09-20' } },
];
const k1 = K.kpis([...eps, ...fixtures, fixtures[0]], '', '', TODAY);  // f1 twice: deduplicated
check('fixture: counts', k1.referred === 4 && k1.managed === 2 && k1.cleared === 2, JSON.stringify([k1.referred, k1.managed, k1.cleared]));
check('fixture: median days cleared (30, 10) = 20', k1.medianDaysCleared === 20);
check('fixture: median days so far (25, 38) = 31.5', k1.medianDaysManaged === 31.5);
check('fixture: 4 education sessions (non-education, non-PAM, not-done and duplicate excluded)', k1.education === 4, String(k1.education));
check('fixture: per month', k1.perMonth['2026-09'] === 1 && k1.perMonth['2026-10'] === 2 && k1.perMonth['2025-08'] === 1 && Object.keys(k1.perMonth)[0] === '2025-08');
const k2 = K.kpis([...eps, ...fixtures], '2026-07-01', '', TODAY);
check('fixture: FY26-27 timeframe', k2.referred === 3 && k2.education === 3 && Object.keys(k2.perMonth).length === 4, JSON.stringify(k2.perMonth));

// --- 2. The app against Meld, every timeframe, vs direct queries
const root = path.resolve(here, '..');
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(f)] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/B3-kpi-tiles/?server=${encodeURIComponent(BASE)}&today=${TODAY}`;

// Independent figures: every EpisodeOfCare on the server, filtered by its type coding here
const all = await (await fetch(`${BASE}/EpisodeOfCare?_count=500&_format=json`)).json();
const direct = (all.entry || []).map((e) => e.resource).filter((e) => e.type?.some((t) => t.coding?.some((c) => c.code === 'pam' && c.system.endsWith('/episode-type'))));
const days = (a, b) => (new Date(b.substring(0, 10)) - new Date(a.substring(0, 10))) / 86400000;
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const eduTotal = (await (await fetch(`${BASE}/Procedure?_summary=count&_format=json`)).json()).total + (await (await fetch(`${BASE}/Communication?_summary=count&_format=json`)).json()).total;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => /resources from/.test(document.getElementById('status').textContent) || document.querySelector('#status.error'), null, { timeout: 60000 });
const tiles = () => page.evaluate(() => Object.fromEntries(['t-referred', 't-managed', 't-cleared', 't-days', 't-days-active', 't-edu'].map((id) => [id, document.getElementById(id).textContent])));
for (const [value, name] of [['|', 'All'], ['2025-07-01|2026-06-30', 'FY 2025-26'], ['2026-07-01|', 'FY 2026-27']]) {
  await page.selectOption('#timeframe', value);
  await page.waitForTimeout(300);
  const ui = await tiles();
  const [from, to] = value.split('|');
  const eps = direct.filter((e) => (!from || e.period.start >= from) && (!to || e.period.start <= to));
  const fin = eps.filter((e) => e.status === 'finished'), act = eps.filter((e) => e.status === 'active');
  const exp = {
    't-referred': String(eps.length), 't-managed': String(act.length), 't-cleared': String(fin.length),
    't-days': med(fin.map((e) => days(e.period.start, e.period.end)))?.toFixed(0) ?? '–',
    't-days-active': med(act.map((e) => days(e.period.start, TODAY)))?.toFixed(0) ?? '–',
  };
  const ok = Object.keys(exp).every((k) => ui[k] === exp[k]);
  check(`Meld, ${name}: tiles match direct EpisodeOfCare query`, ok, `ui ${JSON.stringify(ui)} expected ${JSON.stringify(exp)}`);
  if (value === '|') await page.screenshot({ path: path.join(here, 'screenshot-meld-all.png'), fullPage: true });
}
check('Meld: education sessions = 0 and the "none recorded yet" note shows (server has ' + eduTotal + ' Procedure + Communication)',
  (await tiles())['t-edu'] === '0' && eduTotal === 0 && await page.isVisible('#edu-note'));
check('Meld: no page errors', errors.length === 0, errors.join('; '));

// --- 3. Education with fixtures, through the real UI (searches intercepted in the browser only)
const page2 = await ctx.newPage();
await page2.route(/\/(Procedure|Communication)\?/, (route) => {
  const type = route.request().url().includes('/Procedure?') ? 'Procedure' : 'Communication';
  const entry = fixtures.filter((r) => r.resourceType === type).map((resource) => ({ resource }));
  route.fulfill({ contentType: 'application/fhir+json', body: JSON.stringify({ resourceType: 'Bundle', type: 'searchset', total: entry.length, entry }) });
});
await page2.goto(url);
await page2.waitForFunction(() => /resources from/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
const ui2 = await page2.evaluate(() => [document.getElementById('t-edu').textContent, document.getElementById('t-edu-month').textContent]);
// Fixture sessions for PAM patients: f1, f2 (pam-034), f3 (pam-035), f4 (pam-001); months Jul 2025 (first episode) .. Oct 2026
const nMonths = K.months(direct.map((e) => e.period.start).sort()[0].substring(0, 7), TODAY.substring(0, 7)).length;
check('fixture education via UI: 4 sessions', ui2[0] === '4', ui2[0]);
check(`fixture education via UI: ${(4 / nMonths).toFixed(1)} per month over ${nMonths} months`, ui2[1] === (4 / nMonths).toFixed(1), ui2[1]);
await page2.screenshot({ path: path.join(here, 'screenshot-education-fixture.png'), fullPage: true });

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
