// Verifies the B7 demographics app against the Meld open endpoint (read-only):
// 1. serves solutions/ locally (the app loads ../B8-filters/pam-filters.js), opens
//    B7-demographics/?server=<open endpoint> in headless Chromium (no filters, then two filter sets), screenshots;
// 2. recomputes the numbers with separate, plain FHIR searches (no shared code with the app);
// 3. prints PASS/FAIL per number.
// Run from the track folder: node solutions/B7-demographics/verify.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../decks/package.json'));
const { chromium } = require('playwright');
const BASE = process.env.FHIR_BASE || 'https://gw.interop.community/QHConnectathon2026/open';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

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
async function count(q) {
  const b = await (await fetch(`${BASE}/${q}&_summary=count&_format=json`)).json();
  return b.total;
}

// --- Independent expectation: every patient with a blood-management referral AND a waitlist entry ----
// (the app's cohort definition; test patients other teams add to Meld count too when they have both)
const refs = await all('ServiceRequest?code=3457005&_count=200');
const wl = new Set((await all('ServiceRequest?category=https://aehrc.github.io/qh-connectathon/track1/CodeSystem/elective-category%7C&_count=200'))
  .map((r) => r.subject.reference.split('/').pop()));
const refDate = Object.fromEntries(refs.map((r) => [r.subject.reference.split('/').pop(), r.authoredOn])
  .filter(([id]) => wl.has(id)));
const patients = (await all('Patient?_count=200')).filter((p) => refDate[p.id]);
const age = (b, d) => { const [by, bm, bd] = b.split('-').map(Number), [y, m, dd] = d.split('-').map(Number); return y - by - ((m < bm || (m === bm && dd < bd)) ? 1 : 0); };
const band = (a) => (a < 50 ? 0 : a < 60 ? 1 : a < 70 ? 2 : a < 80 ? 3 : 4);
const exp = { n: patients.length, sex: { female: 0, male: 0 }, bands: { female: [0, 0, 0, 0, 0], male: [0, 0, 0, 0, 0] }, postcodes: {} };
for (const p of patients) {
  exp.sex[p.gender]++;
  exp.bands[p.gender][band(age(p.birthDate, refDate[p.id]))]++;
  const pc = p.address?.[0]?.postalCode || 'unknown'; exp.postcodes[pc] = (exp.postcodes[pc] || 0) + 1;
}
// Filtered expectations straight from _has + gender counts on the server
const SURG = 'Organization/pam-unit-orthopaedics,Organization/pam-unit-colorectal,Organization/pam-unit-urology&_has:ServiceRequest:subject:code=3457005';
const filtered = {
  'directorate=surgical': { qs: 'directorate=surgical', female: await count(`Patient?gender=female&_has:ServiceRequest:subject:performer=${SURG}`), male: await count(`Patient?gender=male&_has:ServiceRequest:subject:performer=${SURG}`) },
  'category=1&source=surgeon': {
    qs: 'category=1&source=surgeon',
    female: await count('Patient?gender=female&_has:ServiceRequest:subject:category=1&_has:ServiceRequest:subject:category=surgeon'),
    male: await count('Patient?gender=male&_has:ServiceRequest:subject:category=1&_has:ServiceRequest:subject:category=surgeon'),
  },
};

// --- Run the app -----------------------------------------------------------------------------------
const srv = await serve(path.join(here, '..'));
const port = srv.address().port;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1300 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

async function run(qs, shot) {
  await page.goto(`http://localhost:${port}/B7-demographics/?server=${encodeURIComponent(BASE)}${qs ? '&' + qs : ''}`);
  await page.waitForFunction(() => window.__summary, null, { timeout: 60000 });
  await page.waitForTimeout(4000); // map tiles
  await page.screenshot({ path: path.join(here, shot), fullPage: true });
  const s = await page.evaluate(() => window.__summary);
  await page.evaluate(() => { delete window.__summary; });
  return s;
}

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: app ${JSON.stringify(got)} / FHIR ${JSON.stringify(want)}`);
};

const s = await run('', 'screenshot-all.png');
check('patients referred', s.n, exp.n);
check('sex', { female: s.sex.female, male: s.sex.male }, exp.sex);
check('age bands female', s.bands.female, exp.bands.female);
check('age bands male', s.bands.male, exp.bands.male);
check('patients per postcode', Object.fromEntries(Object.entries(s.postcodes).sort()), Object.fromEntries(Object.entries(exp.postcodes).sort()));
const mapped = await page.evaluate(() => Object.keys(window.QLD_POSTCODE_CENTROIDS).length);
const missing = Object.keys(exp.postcodes).filter((pc) => pc !== 'unknown' && !JSON.parse(fs.readFileSync(path.join(here, 'qld-postcode-centroids.js'), 'utf8').match(/= (\{.*\});/)[1])[pc]);
check(`every postcode in the data has a centroid (${mapped} QLD postal areas bundled)`, missing, []);

for (const [name, f] of Object.entries(filtered)) {
  const t = await run(f.qs, `screenshot-${f.qs.replace(/[=&]/g, '-')}.png`);
  check(`filter ${name}: sex`, { female: t.sex.female, male: t.sex.male }, { female: f.female, male: f.male });
}
check('no page errors', errors, []);

await browser.close();
srv.close();
console.log(`\n${fails ? 'FAILED' : 'ALL PASS'}`);
process.exit(fails ? 1 : 0);
