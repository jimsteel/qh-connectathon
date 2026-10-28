// Verifies the B8 demo page (two views sharing pam-filters.js) against the Meld open endpoint (read-only):
// opens B8-filters/?server=<open endpoint>&<filters> in headless Chromium for several filter sets, screenshots,
// and checks each view's numbers against plain FHIR searches written out here (no shared code with the page).
// Run from the track folder: node solutions/B8-filters/verify-views.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../decks/package.json'));
const { chromium } = require('playwright');
const BASE = process.env.FHIR_BASE || 'https://gw.interop.community/QHConnectathon2026/open';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const L = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
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
const pid = (r) => (r.subject || r.patient).reference.split('/').pop();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// Expectations, hand-written per filter set as direct searches
const sets = [
  { name: 'none', qs: '', referral: 'ServiceRequest?code=3457005', waitlist: `ServiceRequest?category=${L}/elective-category%7C` },
  { name: 'surgical directorate, category 2', qs: 'directorate=surgical&category=2', referral: 'ServiceRequest?code=3457005',
    waitlist: `ServiceRequest?category=${L}/elective-category%7C2&performer=Organization/pam-unit-orthopaedics,Organization/pam-unit-colorectal,Organization/pam-unit-urology` },
  { name: 'referred by surgeon in FY 2025-26', qs: 'source=surgeon&from=2025-07-01&to=2026-06-30',
    referral: `ServiceRequest?code=3457005&category=${L}/referral-source%7Csurgeon&authored=ge2025-07-01&authored=le2026-06-30`, waitlist: `ServiceRequest?category=${L}/elective-category%7C` },
  { name: 'Gynaecology unit', qs: 'unit=pam-unit-gynaecology', referral: 'ServiceRequest?code=3457005', waitlist: `ServiceRequest?performer=Organization/pam-unit-gynaecology` },
];

const srv = await serve(path.join(here, '..'));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: page ${JSON.stringify(got)} / FHIR ${JSON.stringify(want)}`);
};

for (const s of sets) {
  const refs = await all(s.referral + '&_count=200');
  const wl = await all(s.waitlist + '&_count=200');
  // Most recent entry per patient (by authoredOn), as the page shows
  const latest = (list) => new Map([...list].sort((a, b) => (a.authoredOn || '').localeCompare(b.authoredOn || '')).map((r) => [pid(r), r]));
  const wlBy = latest(wl);
  const cohort = [...new Set(refs.map(pid).filter((id) => wlBy.has(id)))].sort();
  const units = {}, sources = {};
  const refBy = latest(refs);
  cohort.forEach((id) => {
    const u = wlBy.get(id).performer[0].reference.split('/').pop(); units[u] = (units[u] || 0) + 1;
    const src = refBy.get(id).category[0].coding[0].code; sources[src] = (sources[src] || 0) + 1;
  });
  const hb = (await all('Observation?code=718-7&_count=500')).filter((o) => cohort.includes(pid(o)));
  const byP = {};
  hb.forEach((o) => (byP[pid(o)] ??= []).push(o));
  const rises = Object.values(byP).filter((l) => l.length > 1).map((l) => { l.sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime)); return l.at(-1).valueQuantity.value - l[0].valueQuantity.value; });

  await page.goto(`http://localhost:${srv.address().port}/B8-filters/?server=${encodeURIComponent(BASE)}${s.qs ? '&' + s.qs : ''}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => window.__result);
  await page.evaluate(() => { delete window.__result; });
  await page.screenshot({ path: path.join(here, `screenshot-${s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), fullPage: true });

  console.log(`-- ${s.name}`);
  check('cohort', r.cohort, cohort);
  check('view 1 referrals by unit', Object.fromEntries(Object.entries(r.v1.units).sort()), Object.fromEntries(Object.entries(units).sort()));
  check('view 1 referrals by source', Object.fromEntries(Object.entries(r.v1.sources).sort()), Object.fromEntries(Object.entries(sources).sort()));
  check('view 2 Hb observations / patients with Hb / with post / median rise', [r.v2.observations, r.v2.withHb, r.v2.withPost, r.v2.medianRise], [hb.length, Object.keys(byP).length, rises.length, median(rises)]);
}
check('no page errors', errors, []);
await browser.close();
srv.close();
console.log(`\n${fails ? 'FAILED' : 'ALL PASS'}`);
process.exit(fails ? 1 : 0);
