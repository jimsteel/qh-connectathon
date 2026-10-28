#!/usr/bin/env node
// C1 Closed loop, automated: B4 and B6 before and after the A6 / A7 forms are filled in and written back.
//
//   node demo.mjs           # full run, deletes all test data from Meld at the end (and checks nothing is left)
//   node demo.mjs --keep    # leave the test patient and the written-back resources on Meld (clean: python3 meld.py clean)
//
// Stages (each followed by a B4 + B6 snapshot: numbers in results/<stage>.json, screenshots/<stage>-*.png):
//   0-empty      test patient not on Meld
//   1-baseline   testdata-baseline.json loaded: patient, waitlist entry, referral, PAM episode, initial bloods
//   2-forms      A6 standalone (diagnosis IDA + target Hb) and A7 standalone (IV iron order + infusion booking)
//                filled in the patched Smart Forms playground, template-extracted and WRITTEN BACK to Meld
//   3-recheck    testdata-recheck.json loaded: post-treatment Hb / ferritin (dated 25 Nov 2026)
// Uses playwright from ../../decks/node_modules (via ../A5-pathology/playground-lib.mjs) and python3.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, setPatient, buildForm, prepopulate, advancedJson, shot, scrollTo, extract, writeBack, qrAnswers, OPEN }
  from '../A5-pathology/playground-lib.mjs';
import { snapshot, PID } from './apps-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(RESULTS, { recursive: true });
const save = (f, j) => fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(j, null, 2) + '\n');
const meld = (...args) => execFileSync('python3', [path.join(HERE, 'meld.py'), ...args], { stdio: 'inherit' });
const FORM = { clip: { x: 0, y: 0, width: 645, height: 1300 } };
let failures = 0;
const expect = (id, ok, msg = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); };
const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, as now() in the forms
const snaps = {};
async function snap(label) {
  console.log(`\n=== snapshot ${label}`);
  snaps[label] = await snapshot(label);
  save(`${label}.json`, snaps[label]);
  const { b4, b6 } = snaps[label];
  console.log(`B4 ${b4.quarter}: referrals ${b4.referrals}, by diagnosis ${JSON.stringify(b4.byDiagnosis)}; test referral ${JSON.stringify(b4.patientReferrals)}`);
  console.log(`B6 tiles ${JSON.stringify(b6.tiles)}; test patient ${JSON.stringify(b6.patientRow)}`);
}
const meldGet = async (q) => ((await (await fetch(`${OPEN}/${q}&_format=json`)).json()).entry || []).map((e) => { delete e.resource.meta; return e.resource; });

async function runA6(page) {
  await setPatient(page, 'Clara Loopdemo', PID);
  await buildForm(page, 'soln-A6-standalone');
  await prepopulate(page, '#decimal-pam-hb');
  await page.waitForTimeout(1500);
  await shot(page, SHOTS, 'A6-1-inputs.png', FORM);
  await scrollTo(page, '#label-pam-findings-intro');
  const sugg = await page.locator('#string-pam-diagnosis-suggested').inputValue();
  expect('A6 suggests iron deficiency anaemia 87522002', sugg.includes('87522002'), sugg);
  await shot(page, SHOTS, 'A6-2-findings.png', FORM);
  await page.locator('#choice-pam-diagnosis').getByRole('radio', { name: 'Iron deficiency anaemia' }).check();
  await page.locator('#choice-pam-blood-consent').getByRole('radio', { name: 'Consents to all blood products' }).check();
  await page.locator('#decimal-pam-target-hb').fill('130');
  await page.locator('#choice-pam-target-hb-by').getByRole('radio', { name: 'Surgeon' }).check();
  await page.waitForTimeout(1200);
  expect('A6 target due = surgery date', (await page.locator('#date-pam-target-hb-due').inputValue()) === '10/12/2026');
  await scrollTo(page, '#label-pam-diagnosis');
  await shot(page, SHOTS, 'A6-3-diagnosis.png', FORM);
  save('A6-qr.json', await advancedJson(page));
  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'templateExtractResult');
  save('A6-extract-bundle.json', bundle);
  const types = bundle.entry.map((e) => e.resource.resourceType).join(',');
  expect('A6 extract: Condition, Goal (no Flag: full consent)', types === 'Condition,Goal', types);
  await shot(page, SHOTS, 'A6-4-extracted.png');
  const label = await writeBack(page);
  expect('A6 write back', /2 entr/i.test(label), label);
  await shot(page, SHOTS, 'A6-5-written-back.png');
}

async function runA7(page) {
  await setPatient(page, 'Clara Loopdemo', PID);
  await buildForm(page, 'soln-A7-standalone');
  await prepopulate(page);
  const a = qrAnswers(await advancedJson(page));
  const g = (k) => a[k]?.[0];
  expect('A7 prepopulated: 68 kg, 165 cm, Hb 98, female', g('pam-weight') === 68 && g('pam-height') === 165 && g('pam-hb') === 98 && g('pam-sex')?.code === 'female',
    `weight ${g('pam-weight')}, height ${g('pam-height')}, Hb ${g('pam-hb')}, sex ${g('pam-sex')?.code}`);
  expect('A7 Ganzoni: IBW 56.8, deficit 1209, suggested 1200', g('pam-ideal-weight') === 56.8 && g('pam-ganzoni') === 1209 && g('pam-ganzoni-rounded') === 1200,
    `IBW ${g('pam-ideal-weight')}, dosing ${g('pam-dosing-weight')}, deficit ${g('pam-ganzoni')}, suggested ${g('pam-ganzoni-rounded')}`);
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await scrollTo(page, '#label-pam-tx-height');
  await shot(page, SHOTS, 'A7-1-ganzoni.png', FORM);
  await page.getByText('Intravenous iron infusion', { exact: true }).click();
  await page.locator('#choice-pam-iron-product').click();
  await page.getByRole('option', { name: 'Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial' }).click();
  await page.locator('#choice-pam-iron-product').press('Escape');
  await page.locator('#date-pam-infusion-date').fill('05/11/2026');
  await page.locator('#text-pam-infusion-notes').fill('C1 closed-loop demo');
  await page.waitForTimeout(2000);
  const b = qrAnswers(await advancedJson(page));
  expect('A7 split: 2 infusions, 1000 + 200 mg', b['pam-iron-infusions']?.[0] === 2 && b['pam-iron-dose-1']?.[0] === 1000 && b['pam-iron-dose-2']?.[0] === 200,
    `${b['pam-iron-infusions']} infusions: ${b['pam-iron-dose-1']} + ${b['pam-iron-dose-2']}`);
  save('A7-qr.json', await advancedJson(page));
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await page.addStyleTag({ content: '.MuiAutocomplete-popper { display: none !important; }' });
  await scrollTo(page, '#label-pam-iron-product');
  await shot(page, SHOTS, 'A7-2-order.png', FORM);
  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'TemplateExtractResult');
  save('A7-extract-bundle.json', bundle);
  const types = bundle.entry.map((e) => e.resource.resourceType).join(',');
  expect('A7 extract: MedicationRequest, ServiceRequest', types === 'MedicationRequest,ServiceRequest', types);
  await shot(page, SHOTS, 'A7-3-extracted.png');
  const label = await writeBack(page);
  expect('A7 write back', /2 entr/i.test(label), label);
  await shot(page, SHOTS, 'A7-4-written-back.png');
}

try {
  meld('clean');
  await snap('0-empty');
  meld('load', 'baseline');
  await snap('1-baseline');

  for (const run of [runA6, runA7]) { // a fresh browser per form (the playground keeps its settings otherwise)
    const { browser, page } = await start();
    await page.setViewportSize({ width: 1600, height: 1300 });
    try {
      await run(page);
    } catch (e) {
      failures++;
      console.log(`FAIL ${run.name}`, e.message);
      await shot(page, SHOTS, `error-${run.name}.png`);
    } finally {
      await browser.close();
    }
  }
  // What the forms wrote, as stored on Meld (server-assigned ids)
  const written = {
    Condition: await meldGet(`Condition?subject=Patient/${PID}`),
    Goal: await meldGet(`Goal?subject=Patient/${PID}`),
    Flag: await meldGet(`Flag?subject=Patient/${PID}`),
    MedicationRequest: await meldGet(`MedicationRequest?subject=Patient/${PID}`),
    ServiceRequest: (await meldGet(`ServiceRequest?subject=Patient/${PID}`)).filter((s) => !s.id.startsWith('soln-C1-')),
  };
  save('written-back.json', written);
  console.log('\nWritten back:', Object.entries(written).map(([t, rs]) => `${t} ${rs.map((r) => r.id).join(' ') || '-'}`).join('; '));
  await snap('2-forms');

  meld('load', 'recheck');
  await snap('3-recheck');

  // --- Expected effect on B4 / B6 -----------------------------------------------------------
  const ref = (l) => snaps[l].b4.patientReferrals[0], row = (l) => snaps[l].b6.patientRow;
  expect('0-empty: patient in neither app', !ref('0-empty') && !row('0-empty'));
  expect('1-baseline B4: referral in 2026–27 Q2, category 2, no diagnosis', ref('1-baseline')?.quarter === '2026–27 Q2' && ref('1-baseline')?.category === '2' && ref('1-baseline')?.dx === 'none', JSON.stringify(ref('1-baseline')));
  expect('1-baseline B6: "not given IV iron", anchored on referral, Hb 98 initial, no post', row('1-baseline')?.group === 'noiv' && row('1-baseline')?.anchor === '2026-10-14' && row('1-baseline')?.hbInitial?.startsWith('98') && !row('1-baseline')?.hbPost, JSON.stringify(row('1-baseline')));
  expect('2-forms B4: diagnosis = A6 Condition 87522002', ref('2-forms')?.dx === '87522002', JSON.stringify(ref('2-forms')));
  expect(`2-forms B6: "given IV iron", anchored on the A7 order (${today}), awaiting post`, row('2-forms')?.group === 'iv' && row('2-forms')?.anchor === today && !row('2-forms')?.hbPost, JSON.stringify(row('2-forms')));
  expect('3-recheck B6: Hb 98 -> 121 (+23), ferritin 18 -> 385 (+367)', row('3-recheck')?.hbChange === 23 && row('3-recheck')?.ferritinChange === 367, JSON.stringify(row('3-recheck')));
  const d = (a, b, f) => `${f(snaps[a])} -> ${f(snaps[b])}`;
  console.log('\nB4 2026–27 Q2, IDA referrals:', d('1-baseline', '2-forms', (s) => s.b4.byDiagnosis['Iron deficiency anaemia']),
    '| No anaemia diagnosis:', d('1-baseline', '2-forms', (s) => s.b4.byDiagnosis['No anaemia diagnosis']));
  console.log('B6 (given IV iron) patients:', d('1-baseline', '2-forms', (s) => s.b6.tiles['t-cohort']), '| paired:', d('2-forms', '3-recheck', (s) => s.b6.tiles['t-paired']),
    '| awaiting:', d('1-baseline', '2-forms', (s) => s.b6.tiles['t-awaiting']), '->', snaps['3-recheck'].b6.tiles['t-awaiting'],
    '| anaemic initial -> post:', d('2-forms', '3-recheck', (s) => s.b6.tiles['t-anaemic']));
} catch (e) {
  failures++;
  console.log('FAIL', e.stack);
} finally {
  if (!process.argv.includes('--keep')) {
    console.log('\n=== clean up');
    meld('clean');
    try { meld('check'); expect('nothing left on Meld for the test patient', true); } catch { expect('nothing left on Meld for the test patient', false); }
  }
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
