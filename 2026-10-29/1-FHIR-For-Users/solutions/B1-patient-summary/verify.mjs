// B1 verification: unit tests of logic.js, then the app run headless in no-login mode against the Meld
// open endpoint for several patients, its numbers checked against direct FHIR queries. Read-only.
//   cd T/decks && node ../solutions/B1-patient-summary/verify.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = require(path.join(here, '../../decks/node_modules/playwright'));
const L = require('./logic.js');

const BASE = 'https://gw.interop.community/QHConnectathon2026/open';
const TODAY = '2026-10-28';
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// --- 1. Decision rules
const c = (o) => L.classify(o);
check('IDA: F Hb 104 ferritin 18', c({ sex: 'female', hb: 104, ferritin: 18 }).pathway.startsWith('Iron deficiency anaemia'));
check('Threshold is sex-specific: M Hb 125 anaemic, F Hb 125 not', c({ sex: 'male', hb: 125, ferritin: 50 }).anaemia === true && c({ sex: 'female', hb: 125, ferritin: 50 }).anaemia === false);
check('At threshold is not anaemic (Hb 120 F)', c({ sex: 'female', hb: 120, ferritin: 50 }).anaemia === false);
check('ID without anaemia', c({ sex: 'male', hb: 140, ferritin: 60 }).pathway.startsWith('Iron deficiency without anaemia'));
check('Ferritin 150 + TSAT 15 = iron deficient', c({ sex: 'male', hb: 140, ferritin: 150, tsat: 15 }).ironDeficiency === true);
check('Ferritin 150 without TSAT = unknown', c({ sex: 'male', hb: 140, ferritin: 150 }).ironDeficiency === null);
check('Ferritin 350 = not iron deficient', c({ sex: 'male', hb: 140, ferritin: 350, tsat: 10 }).ironDeficiency === false);
check('ACD: anaemia, ferritin 200 TSAT 25, CRP 30', c({ sex: 'female', hb: 100, ferritin: 200, tsat: 25, crp: 30 }).pathway.includes('chronic disease'));
check('Anaemia, no ID, no inflammation', c({ sex: 'female', hb: 100, ferritin: 200, tsat: 25, crp: 3 }).pathway.includes('other causes'));
check('Normal = cleared', c({ sex: 'female', hb: 130, ferritin: 200, tsat: 30, crp: 2 }).tone === 'good');
check('No sex: Hb unclassified', c({ hb: 100, ferritin: 20 }).anaemia === null);
check('daysBetween', L.daysBetween('2026-10-28', '2026-11-06') === 9 && L.daysBetween('2026-10-28', '2026-10-28') === 0);

// --- 2. The app, headless, against Meld
const root = path.resolve(here, '..');
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(f)] || 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const fhir = async (q) => {
  const r = await fetch(`${BASE}/${q}${q.includes('?') ? '&' : '?'}_format=json`);
  const j = await r.json();
  return j.resourceType === 'Bundle' ? (j.entry || []).map((e) => e.resource) : j;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
for (const pid of ['pam-demo', 'pam-034', 'pam-012', 'pam-008', 'pam-004']) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/B1-patient-summary/?fhirServiceUrl=${encodeURIComponent(BASE)}&patientId=${pid}&today=${TODAY}`);
  await page.waitForFunction(() => document.getElementById('t-treat').textContent !== '–' || document.querySelector('.error'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(here, `screenshot-${pid}.png`), fullPage: true });
  const ui = await page.evaluate(() => Object.fromEntries(['who', 't-pathway', 't-days', 't-episode', 't-treat'].map((id) => [id, document.getElementById(id).textContent.trim()])));
  check(`${pid}: no page errors`, errors.length === 0 && !(await page.$('.error')), errors.join('; '));

  // Independent figures from direct queries
  const pat = await fhir(`Patient/${pid}`);
  const obs = await fhir(`Observation?patient=${pid}&_count=200`);
  const hb = obs.filter((o) => o.code.coding.some((x) => x.code === '718-7')).sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime));
  const fer = obs.filter((o) => o.code.coding.some((x) => x.code === '2276-4')).sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime));
  const tsat = obs.filter((o) => o.code.coding.some((x) => x.code === '2502-3')).sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime));
  const crp = obs.filter((o) => o.code.coding.some((x) => x.code === '1988-5')).sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime));
  const last = (xs) => xs.at(-1)?.valueQuantity.value;
  const expected = L.classify({ sex: pat.gender, hb: last(hb), ferritin: last(fer), tsat: last(tsat), crp: last(crp) }).pathway;
  check(`${pid}: pathway`, ui['t-pathway'] === expected, `"${ui['t-pathway']}" (Hb ${last(hb)}, ferritin ${last(fer)}, TSAT ${last(tsat)}, CRP ${last(crp)}, ${pat.gender})`);

  const srs = await fhir(`ServiceRequest?patient=${pid}`);
  const surg = srs.filter((s) => s.category?.[0]?.coding?.[0]?.system?.endsWith('/elective-category'));
  const expDays = surg.length ? L.daysBetween(TODAY, surg[0].occurrenceDateTime.substring(0, 10)) : null;
  check(`${pid}: days to surgery`, expDays == null ? ui['t-days'] === '–' : ui['t-days'] === (expDays >= 0 ? String(expDays) : `${-expDays} days ago`), `ui ${ui['t-days']}, expected ${expDays} (surgery ${surg[0]?.occurrenceDateTime ?? 'none'})`);

  const mrs = await fhir(`MedicationRequest?patient=${pid}`);
  check(`${pid}: treatments`, ui['t-treat'] === String(mrs.length), `ui ${ui['t-treat']}, FHIR ${mrs.length}`);

  const eps = await fhir(`EpisodeOfCare?patient=${pid}`);
  const ep = eps[0];
  const expEp = ep ? L.daysBetween(ep.period.start, ep.period.end || TODAY) + ' days' : '–';
  check(`${pid}: days with the team`, ui['t-episode'] === expEp, `ui ${ui['t-episode']}, expected ${expEp} (${ep?.status ?? 'no episode'})`);
  await page.close();
}
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
