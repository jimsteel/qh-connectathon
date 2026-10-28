#!/usr/bin/env node
// End-to-end test of the A6 standalone form in the patched Smart Forms playground (headless Chromium):
// pre-populate for soln-A6-patient-1, check the calculated findings (and that they follow an edited
// input), confirm a diagnosis, add an "other" diagnosis from Ontoserver, limited consent to blood
// products and a target Hb; template-extract; write back to Meld; read the resources back; reset.
//
//   python3 meld.py forms && python3 meld.py data && node playground.mjs
//
// Writes screenshots/*.png and playground-results/*.json (checked by verify.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, setPatient, buildForm, prepopulate, advancedJson, shot, scrollTo, extract, writeBack, OPEN }
  from '../A5-pathology/playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const RESULTS = path.join(HERE, 'playground-results');
fs.mkdirSync(RESULTS, { recursive: true });
const save = (f, j) => fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(j, null, 2) + '\n');
const FORM = { clip: { x: 0, y: 0, width: 645, height: 1300 } };
let failures = 0;
const expect = (id, ok, msg = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); };
const val = (sel) => page.locator(sel).inputValue();

const { browser, page } = await start();
await page.setViewportSize({ width: 1600, height: 1300 });
try {
  await setPatient(page, 'Arlo Diagtest', 'soln-A6-patient-1');
  await buildForm(page, 'soln-A6-standalone');
  await prepopulate(page, '#decimal-pam-hb');
  await page.waitForTimeout(1500);
  await shot(page, SHOTS, '01-inputs.png', FORM);
  await scrollTo(page, '#label-pam-findings-intro');
  await shot(page, SHOTS, '02-findings-acd.png', FORM);
  expect('suggested ACD', (await val('#string-pam-diagnosis-suggested')).includes('234347009'));

  // What-if: ferritin 40 -> iron deficiency anaemia; then back to 160
  await page.locator('#decimal-pam-ferritin').fill('40');
  await page.locator('#decimal-pam-ferritin').press('Tab');
  await page.waitForTimeout(1500);
  await scrollTo(page, '#label-pam-findings-intro');
  await shot(page, SHOTS, '03-findings-what-if-ferritin-40.png', FORM);
  expect('what-if ferritin 40 -> IDA', (await val('#string-pam-diagnosis-suggested')).includes('87522002'));
  await page.locator('#decimal-pam-ferritin').fill('160');
  await page.locator('#decimal-pam-ferritin').press('Tab');
  await page.waitForTimeout(1500);
  expect('back to ACD', (await val('#string-pam-diagnosis-suggested')).includes('234347009'));

  // Choose IDA first: the "differs" warning shows; then confirm ACD
  await page.locator('#choice-pam-diagnosis').getByRole('radio', { name: 'Iron deficiency anaemia' }).check();
  await page.waitForTimeout(800);
  expect('differs warning shown', (await page.getByText('The diagnosis differs').count()) === 1);
  await scrollTo(page, '#label-pam-pathway');
  await shot(page, SHOTS, '04-diagnosis-differs.png', FORM);
  await page.locator('#choice-pam-diagnosis').getByRole('radio', { name: 'Anaemia of chronic disease' }).check();
  await page.waitForTimeout(800);
  expect('differs warning hidden', (await page.getByText('The diagnosis differs').count()) === 0);

  // Other diagnosis: SNOMED CT-AU search (Ontoserver, ECL)
  const other = page.locator('#choice-pam-diagnosis-other');
  await other.click(); await other.pressSequentially('blood loss', { delay: 40 });
  await page.getByRole('option', { name: 'Iron deficiency anaemia due to blood loss' }).first().click();

  // Blood products: limited consent, religious reason
  await page.locator('#choice-pam-blood-consent').getByRole('radio', { name: /^Limited consent/ }).check();
  await page.waitForTimeout(600);
  await page.locator('input[type=checkbox][value="126242007"]').check();
  await page.locator('input[type=checkbox][value="256395009"]').check();
  await page.getByRole('radio', { name: /^Religious belief/ }).check();
  await page.locator('#text-pam-blood-details').fill('Accepts albumin and cell salvage; advance health directive on file');
  // Target Hb
  await page.locator('#decimal-pam-target-hb').fill('130');
  await page.locator('#choice-pam-target-hb-by').getByRole('radio', { name: 'Surgeon' }).check();
  await page.waitForTimeout(1200);
  await scrollTo(page, '#label-pam-diagnosis');
  await shot(page, SHOTS, '05-diagnosis-blood-products-target.png', FORM);
  expect('target gap 12', (await val('#decimal-pam-target-hb-gap')) === '12');
  expect('target due = surgery date', (await val('#date-pam-target-hb-due')) === '03/12/2026');
  save('qr-filled.json', await advancedJson(page));

  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'templateExtractResult');
  save('extract-bundle.json', bundle);
  await shot(page, SHOTS, '06-extracted-bundle.png');
  const types = bundle.entry.map((e) => e.resource.resourceType).join(',');
  expect('extract: Condition, Condition, Flag, Goal', types === 'Condition,Condition,Flag,Goal', types);

  const label = await writeBack(page);
  await shot(page, SHOTS, '07-written-back.png');
  expect('write back 4 entries', /4 entr/i.test(label), label);

  // Read back from Meld
  for (const [t, want] of [['Condition', 2], ['Flag', 1], ['Goal', 1]]) {
    const r = await (await fetch(`${OPEN}/${t}?subject=Patient/soln-A6-patient-1&_format=json`)).json();
    const got = r.entry?.length ?? 0;
    save(`meld-${t}.json`, r.entry?.map((e) => { delete e.resource.meta; return e.resource; }) ?? []);
    expect(`on Meld: ${t} x${want}`, got === want, `got ${got}`);
  }
} catch (e) {
  failures++;
  console.log('FAIL', e.message);
  await shot(page, SHOTS, 'error.png');
} finally {
  await browser.close();
  execFileSync('python3', [path.join(HERE, 'meld.py'), 'clean'], { stdio: 'inherit' });
  execFileSync('python3', [path.join(HERE, 'meld.py'), 'data'], { stdio: 'inherit' });
}
process.exit(failures ? 1 : 0);
