// Verifies the B2 worklist app against the Meld open endpoint:
// serves this folder, opens index.html?server=<open endpoint>&today=<date> headless, screenshots,
// and compares the list with an independent computation from plain FHIR reads. Prints PASS/FAIL.
// Run: node solutions/B2-worklist/verify.mjs   (from the track folder)
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

// --- Independent expectation: read everything, join in memory ------------------------------
const [eps, tasks, srs] = await Promise.all([all('EpisodeOfCare?_count=500'), all('Task?_count=500'), all('ServiceRequest?_count=500')]);
const srById = Object.fromEntries(srs.map((s) => [s.id, s]));
const active = eps.filter((e) => e.status === 'active' && JSON.stringify(e.type || []).includes('"pam"'));
const OPEN = ['requested', 'received', 'accepted', 'ready', 'in-progress', 'on-hold'];
function expected(today) {
  const rows = active.map((e) => {
    const referral = srById[e.referralRequest?.[0]?.reference.split('/')[1]];
    const surgery = srById[referral?.supportingInfo?.[0]?.reference.split('/')[1]];
    const t = tasks.filter((t) => OPEN.includes(t.status) && t.focus?.reference === `EpisodeOfCare/${e.id}`)
      .map((t) => (t.restriction?.period?.end || t.executionPeriod?.end || '').slice(0, 10)).sort()[0];
    return { pid: e.patient.reference.split('/')[1], surgery: surgery?.occurrenceDateTime?.slice(0, 10) || '9999', due: t || null };
  }).sort((a, b) => a.surgery.localeCompare(b.surgery) || 0);
  return {
    managed: rows.length,
    order: rows.map((r) => r.pid),
    overdue: rows.filter((r) => r.due && days(today, r.due) < 0).length,
    soon: rows.filter((r) => r.due && days(today, r.due) >= 0 && days(today, r.due) <= 7).length,
    surgery14: rows.filter((r) => r.surgery !== '9999' && days(today, r.surgery) >= 0 && days(today, r.surgery) <= 14).length,
  };
}

const srv = await serve(here);
const browser = await chromium.launch();
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: app ${JSON.stringify(got)}, FHIR ${JSON.stringify(want)}`); };
for (const today of ['2026-10-06', '2026-10-28']) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto(`http://localhost:${srv.address().port}/index.html?server=${encodeURIComponent(BASE)}&today=${today}`);
  await page.waitForFunction(() => window.B2_RESULT, null, { timeout: 60000 });
  await page.screenshot({ path: path.join(here, `screenshot-worklist-${today}.png`), fullPage: true });
  const tiles = await page.evaluate(() => Object.fromEntries(['managed', 'overdue', 'soon', 'surgery'].map((k) => [k, +document.getElementById('t-' + k).textContent])));
  const order = await page.evaluate(() => window.B2_RESULT.view.map((r) => r.patientId));
  const e = expected(today);
  check(`[${today}] being managed`, tiles.managed, e.managed);
  check(`[${today}] overdue`, tiles.overdue, e.overdue);
  check(`[${today}] due within 7 days`, tiles.soon, e.soon);
  check(`[${today}] surgery within 14 days`, tiles.surgery, e.surgery14);
  check(`[${today}] rows sorted by surgery date`, order, e.order);
}
await browser.close(); srv.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
