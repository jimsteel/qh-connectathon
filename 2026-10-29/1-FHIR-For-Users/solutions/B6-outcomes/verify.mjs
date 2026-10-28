// Verifies the B6 outcomes app against the Meld open endpoint:
// 1. serves this folder locally, opens index.html?server=<open endpoint> in headless Chromium, takes screenshots;
// 2. recomputes the headline numbers with separate, plain FHIR searches (no _include, system-less codes);
// 3. prints PASS/FAIL per number.
// Run: node solutions/B6-outcomes/verify.mjs   (from the track folder; playwright is resolved from decks/node_modules)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../decks/package.json'));
const { chromium } = require('playwright');
const BASE = process.env.FHIR_BASE || 'https://gw.interop.community/QHConnectathon2026/open';

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

async function all(q) {
  let url = `${BASE}/${q}${q.includes('?') ? '&' : '?'}_format=json`, out = [];
  while (url) {
    const b = await (await fetch(url)).json();
    out.push(...(b.entry || []).map((e) => e.resource));
    url = (b.link || []).find((l) => l.relation === 'next')?.url;
  }
  return out;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// --- Independent expectation -------------------------------------------------------------
const [hb, fer, pats, meds, eps] = await Promise.all([
  all('Observation?code=718-7&_count=500'), all('Observation?code=2276-4&_count=500'),
  all('Patient?_count=500'), all('MedicationRequest?_count=500'), all('EpisodeOfCare?_count=500'),
]);
const sex = Object.fromEntries(pats.map((p) => [p.id, p.gender]));
const iv = {};
for (const m of meds) {
  if (['cancelled', 'entered-in-error', 'draft'].includes(m.status)) continue;
  const isIv = JSON.stringify(m.dosageInstruction || []).includes('"47625008"') || ['1312141000168105', '1086251000168104'].includes(m.medicationCodeableConcept?.coding?.[0]?.code);
  if (!isIv) continue;
  const pid = m.subject.reference.replace('Patient/', ''), d = m.authoredOn.slice(0, 10);
  if (!iv[pid] || d < iv[pid]) iv[pid] = d;
}
const pamEp = new Set(eps.filter((e) => JSON.stringify(e.type || []).includes('"pam"')).map((e) => e.patient.reference.replace('Patient/', '')));
function expect(obs, thr) {
  const byP = {};
  for (const o of obs) if (o.valueQuantity) (byP[o.subject.reference.replace('Patient/', '')] ??= []).push([o.effectiveDateTime.slice(0, 10), o.valueQuantity.value]);
  const pairs = [];
  let awaiting = 0;
  for (const [pid, xs] of Object.entries(byP)) {
    if (!iv[pid]) continue;
    const before = xs.filter(([d]) => d <= iv[pid]).sort(), after = xs.filter(([d]) => d > iv[pid]).sort();
    if (!before.length) continue;
    if (!after.length) { awaiting++; continue; }
    pairs.push({ pid, a: before.at(-1)[1], b: after.at(-1)[1], t: thr(sex[pid]) });
  }
  return { paired: pairs.length, awaiting, medianChange: median(pairs.map((p) => p.b - p.a)),
    belowInitial: pairs.filter((p) => p.a < p.t).length, belowPost: pairs.filter((p) => p.b < p.t).length };
}
const expHb = expect(hb, (s) => (s === 'male' ? 130 : 120));
const expFer = expect(fer, () => 100);
const expCohort = new Set([...Object.keys(iv)].filter((p) => hb.concat(fer).some((o) => o.subject.reference === `Patient/${p}`))).size;
// The starter dashboard method: earliest vs latest Hb for anyone with >1 result
const spanPaired = Object.values(hb.reduce((a, o) => ((a[o.subject.reference] ??= []).push(o), a), {}))
  .filter((xs) => xs.length > 1 && xs.some((o) => { const p = o.subject.reference.replace('Patient/', ''); return iv[p] || pamEp.has(p); })).length;

// --- App ----------------------------------------------------------------------------------
const srv = await serve(here);
const url = `http://localhost:${srv.address().port}/index.html?server=${encodeURIComponent(BASE)}`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(url);
await page.waitForFunction(() => window.B6_RESULT, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(here, 'screenshot-outcomes.png'), fullPage: true });
const app = await page.evaluate(() => window.B6_RESULT.summary);
const appCohort = await page.evaluate(() => window.B6_RESULT.rows.length);
await page.selectOption('#method', 'span'); await page.selectOption('#group', 'all');
await page.waitForTimeout(500);
const appSpan = await page.evaluate(() => window.B6_RESULT.summary['718-7'].all.paired);
await page.screenshot({ path: path.join(here, 'screenshot-earliest-latest.png'), fullPage: false });
await browser.close(); srv.close();

let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: app ${got}, FHIR ${want}`); };
check('IV-iron patients with results', appCohort, expCohort);
for (const [name, a, e] of [['Hb', app['718-7'].all, expHb], ['Ferritin', app['2276-4'].all, expFer]]) {
  for (const k of ['paired', 'awaiting', 'medianChange', 'belowInitial', 'belowPost']) check(`${name} ${k}`, a[k], e[k]);
}
check('Earliest-vs-latest Hb pairs (dashboard method, PAM cohort)', appSpan, spanPaired);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
