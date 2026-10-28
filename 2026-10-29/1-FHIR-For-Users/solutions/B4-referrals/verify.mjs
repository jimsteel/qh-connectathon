// Verifies the B4 referrals app against the Meld open endpoint:
// serves this folder, opens index.html?server=<open endpoint> headless, screenshots,
// and compares every quarter count with an independent computation from plain FHIR reads. Prints PASS/FAIL.
// Run: node solutions/B4-referrals/verify.mjs   (from the track folder)
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
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);


// --- Independent expectation: all ServiceRequests and Conditions, joined in memory ---------
const [srs, conds] = await Promise.all([all('ServiceRequest?_count=500'), all('Condition?_count=500')]);
const byId = Object.fromEntries(srs.map((s) => [s.id, s]));
const quarter = (d) => { // months since Jul 2000 / 3 -> FY quarter label
  const n = Math.floor(((+d.slice(0, 4) - 2000) * 12 + (+d.slice(5, 7) - 7)) / 3), fyStart = 2000 + Math.floor(n / 4);
  return `${fyStart}–${String(fyStart + 1).slice(2)} Q${(n % 4) + 1}`;
};
const isWait = (s) => JSON.stringify(s.category || []).includes('elective-category') && s.status !== 'entered-in-error';
const refs = srs.filter((s) => s.code?.coding?.some((c) => c.code === '3457005') && !['entered-in-error', 'revoked', 'draft'].includes(s.status));
const waits = srs.filter(isWait);
const exp = { referrals: {}, waitlisted: {}, cat: {}, dx: {} };
const inc = (o, k, q) => { o[k] ??= {}; o[k][q] = (o[k][q] || 0) + 1; };
for (const r of refs) {
  const q = quarter(r.authoredOn);
  inc(exp, 'referrals', q);
  const w = byId[r.supportingInfo?.[0]?.reference.split('/')[1]];
  inc(exp.cat, w ? `Category ${w.category[0].coding[0].code}` : 'Unknown', q);
  const pc = conds.filter((c) => c.subject.reference === r.subject.reference).map((c) => [(c.recordedDate || '').slice(0, 10), c]).sort((a, b) => a[0].localeCompare(b[0]));
  const c = (pc.find(([d]) => d >= r.authoredOn.slice(0, 10)) || pc.at(-1))?.[1];
  inc(exp.dx, !c ? 'No anaemia diagnosis' : c.code?.coding?.[0]?.display || 'Uncoded', q);
}
for (const w of waits) inc(exp, 'waitlisted', quarter(w.authoredOn));

const srv = await serve(here);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(`http://localhost:${srv.address().port}/index.html?server=${encodeURIComponent(BASE)}`);
await page.waitForFunction(() => window.B4_RESULT, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(here, 'screenshot-referrals.png'), fullPage: true });
const app = await page.evaluate(() => window.B4_RESULT);
await page.selectOption('#fy', '2025–26');
await page.waitForTimeout(500);
const fy = await page.evaluate(() => window.B4_RESULT);
await browser.close(); srv.close();

let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: app ${JSON.stringify(got)}, FHIR ${JSON.stringify(want)}`); };
const asMap = (ys) => Object.fromEntries(app.quarters.map((q, i) => [q, ys[i]]).filter(([, v]) => v));
const sorted = (o) => Object.fromEntries(Object.entries(o || {}).sort());
check('referrals per quarter', sorted(asMap(app.referrals)), sorted(exp.referrals));
check('waitlisted cases per quarter (quarters with referrals)', sorted(asMap(app.waitlisted)), sorted(Object.fromEntries(Object.entries(exp.waitlisted).filter(([q]) => app.quarters.includes(q)))));
for (const [k, ys] of Object.entries(app.byCategory)) check(`referrals by ${k}`, sorted(asMap(ys)), sorted(exp.cat[k]));
for (const [k, ys] of Object.entries(app.byDiagnosis)) check(`referrals by diagnosis: ${k}`, sorted(asMap(ys)), sorted(exp.dx[k]));
check('FY 2025–26 filter shows exactly Q1–Q4', fy.quarters, ['2025–26 Q1', '2025–26 Q2', '2025–26 Q3', '2025–26 Q4']);
check('FY 2025–26 referral total', fy.referrals.reduce((a, b) => a + b, 0), Object.entries(exp.referrals).filter(([q]) => q.startsWith('2025–26')).reduce((a, [, v]) => a + v, 0));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
