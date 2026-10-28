// Snapshot of the B4 (referrals) and B6 (outcomes) apps in no-login mode against the Meld open endpoint:
// serves ../B4-referrals and ../B6-outcomes unchanged from a local static server, opens them in headless
// Chromium (fresh context), reads the numbers the apps computed (window.B4_RESULT / window.B6_RESULT and
// the apps' own build functions) and takes screenshots. Nothing in those folders is modified.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFromDecks, OPEN } from '../A5-pathology/playground-lib.mjs';

const { chromium } = requireFromDecks('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLUTIONS = path.resolve(HERE, '..');
export const PID = 'soln-C1-patient-1';
export const QUARTER = '2026–27 Q2'; // the referral (14 Oct 2026) falls in this Australian FY quarter

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

// Returns { b4, b6 } for this moment; screenshots go to screenshots/<label>-B4.png, -B6.png, -B6-patient.png
export async function snapshot(label, shotsDir = path.join(HERE, 'screenshots')) {
  fs.mkdirSync(shotsDir, { recursive: true });
  const srv = await serve(SOLUTIONS);
  const port = srv.address().port;
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

    // --- B4 ---------------------------------------------------------------------------------
    await page.goto(`http://localhost:${port}/B4-referrals/index.html?server=${encodeURIComponent(OPEN)}`);
    await page.waitForFunction(() => window.B4_RESULT, null, { timeout: 90000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shotsDir, `${label}-B4.png`), fullPage: true });
    const b4 = await page.evaluate(([pid, quarter]) => {
      const r = window.B4_RESULT, i = r.quarters.indexOf(quarter);
      const at = (o) => Object.fromEntries(Object.entries(o).map(([k, ys]) => [k, i < 0 ? 0 : ys[i]]));
      // build() and cache are top-level declarations of the app's script: the app's own per-referral rows
      const mine = build(cache).referrals.filter((x) => x.pid === pid); // eslint-disable-line no-undef
      return { quarter, referrals: i < 0 ? 0 : r.referrals[i], waitlisted: i < 0 ? 0 : r.waitlisted[i],
        byCategory: at(r.byCategory), byDiagnosis: at(r.byDiagnosis), status: document.getElementById('status').textContent,
        patientReferrals: mine.map(({ id, date, label, category, dx, dxLabel }) => ({ id, date, quarter: label, category, dx, dxLabel })) };
    }, [PID, QUARTER]);

    // --- B6 ---------------------------------------------------------------------------------
    await page.goto(`http://localhost:${port}/B6-outcomes/index.html?server=${encodeURIComponent(OPEN)}`);
    await page.waitForFunction(() => window.B6_RESULT, null, { timeout: 90000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shotsDir, `${label}-B6.png`), fullPage: true });
    const tiles = await page.evaluate(() => Object.fromEntries(['t-cohort', 't-paired', 't-awaiting', 't-hb-rise', 't-anaemic', 't-lowferr']
      .map((id) => [id, document.getElementById(id).textContent])));
    const ivSummary = await page.evaluate(() => {
      const s = window.B6_RESULT.summary, pick = (x) => ({ withInitial: x.withInitial, paired: x.paired, awaiting: x.awaiting, medianChange: x.medianChange, belowInitial: x.belowInitial, belowPost: x.belowPost });
      return { hb: pick(s['718-7'].all), hbFemale: pick(s['718-7'].female), ferritin: pick(s['2276-4'].all) };
    });
    // The test patient's row, whichever group it is in ("All in the PAM cohort")
    await page.selectOption('#group', 'all');
    await page.waitForTimeout(600);
    const row = await page.evaluate((pid) => {
      const r = window.B6_RESULT.rows.find((x) => x.id === pid);
      if (!r) return null;
      const v = (x) => (x ? `${x.value} (${x.date})` : null);
      return { group: r.group, anchor: r.anchor, anchorSource: r.anchorSource, episode: r.episodeStatus,
        hbInitial: v(r['718-7'].initial), hbPost: v(r['718-7'].post), hbChange: r['718-7'].change,
        ferritinInitial: v(r['2276-4'].initial), ferritinPost: v(r['2276-4'].post), ferritinChange: r['2276-4'].change };
    }, PID);
    if (row) { // per-patient table, only the test patient's row shown (for the screenshot)
      await page.evaluate((pid) => {
        const d = document.querySelectorAll('details')[0]; d.open = true;
        document.querySelectorAll('#patients tr').forEach((tr, i) => { if (i && !tr.textContent.includes(pid)) tr.style.display = 'none'; });
      }, PID);
      await page.waitForTimeout(300);
      await page.locator('#patients').screenshot({ path: path.join(shotsDir, `${label}-B6-patient.png`) });
    } else if (fs.existsSync(path.join(shotsDir, `${label}-B6-patient.png`))) fs.unlinkSync(path.join(shotsDir, `${label}-B6-patient.png`));
    return { b4, b6: { defaultView: 'Given IV iron, all dates, IV iron anchor', tiles, summary: ivSummary, patientRow: row } };
  } finally {
    await browser.close();
    srv.close();
  }
}
