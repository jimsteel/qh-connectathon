#!/usr/bin/env node
// End-to-end test of the A5 standalone form in the patched Smart Forms playground (headless Chromium):
// pre-populate for soln-A5-patient-1, enter two external results, template-extract, write back to Meld,
// pre-populate again (closes the loop), then reset the test patient's data.
//
//   python3 meld.py forms && python3 meld.py data && node playground.mjs
//
// Writes screenshots/*.png and playground-results/*.json (checked by verify.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, setPatient, buildForm, prepopulate, advancedJson, shot, scrollTo, extract, writeBack, settle } from './playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const RESULTS = path.join(HERE, 'playground-results');
fs.mkdirSync(RESULTS, { recursive: true });
const save = (f, j) => fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(j, null, 2) + '\n');
const FORM = { clip: { x: 0, y: 0, width: 645, height: 1300 } };
let failures = 0;
const expect = (id, ok, msg = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); };

const { browser, page } = await start();
await page.setViewportSize({ width: 1600, height: 1300 });
async function fillRow(n, test, value, date, lab) {
  await page.locator('#choice-pam-ext-test').nth(n).click();
  await page.getByRole('option', { name: test }).click();
  await page.locator('#decimal-pam-ext-value').nth(n).fill(value);
  const d = page.locator('#date-pam-ext-date').nth(n);
  await d.click(); await d.pressSequentially(date); await d.press('Tab');
  if (lab) await page.locator('#string-pam-ext-lab').nth(n).fill(lab);
  await page.waitForTimeout(400);
}
try {
  await setPatient(page, 'Paula Pathtest', 'soln-A5-patient-1');
  await buildForm(page, 'soln-A5-standalone');
  await prepopulate(page, '#decimal-pam-hb');
  await shot(page, SHOTS, '01-latest-results.png', FORM);
  await scrollTo(page, '#label-pam-path-treatment-date');
  await shot(page, SHOTS, '02-initial-vs-post.png', FORM);
  await scrollTo(page, '#string-pam-hist-test');
  await shot(page, SHOTS, '03-history.png', FORM);
  const qr = await advancedJson(page);
  save('qr-prepopulated.json', qr);
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});

  await scrollTo(page, '#choice-pam-ext-test');
  await fillRow(0, /^Haemoglobin/, '98', '27/10/2026', 'Sunshine Pathology (synthetic)');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.waitForTimeout(400);
  await fillRow(1, /^Vitamin B12/, '180', '26/10/2026', null);
  await scrollTo(page, '#choice-pam-ext-test');
  await shot(page, SHOTS, '04-external-results.png', FORM);

  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'templateExtractResult');
  save('extract-bundle.json', bundle);
  await shot(page, SHOTS, '05-extracted-bundle.png');
  const obs = bundle.entry.map((e) => e.resource);
  expect('extract: 2 Observations', obs.length === 2 && obs.every((o) => o.resourceType === 'Observation'));
  expect('extract: Hb', obs[0].code.coding[0].code === '718-7' && obs[0].valueQuantity.value === 98
    && obs[0].valueQuantity.code === 'g/L' && obs[0].effectiveDateTime === '2026-10-27'
    && obs[0].performer?.[0]?.display === 'Sunshine Pathology (synthetic)' && obs[0].subject.reference === 'Patient/soln-A5-patient-1');
  expect('extract: B12', obs[1].code.coding[0].code === '14685-2' && obs[1].valueQuantity.code === 'pmol/L'
    && obs[1].valueQuantity.value === 180 && !obs[1].performer);

  const label = await writeBack(page);
  await shot(page, SHOTS, '06-written-back.png');
  expect('write back', /2 entr/i.test(label), label);

  // Close the loop: the new Hb (27/10/2026) is now the latest; history has 20 rows
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await prepopulate(page);
  await page.waitForFunction(() => document.querySelector('#decimal-pam-hb')?.value === '98');
  await settle(page);
  await page.locator('#decimal-pam-hb').scrollIntoViewIfNeeded();
  await shot(page, SHOTS, '07-close-the-loop.png', FORM);
  const qr2 = await advancedJson(page);
  save('qr-after-write-back.json', qr2);
  const rows = qr2.item[0].item.filter((i) => i.linkId === 'pam-path-history').length;
  expect('close the loop: latest Hb 98, history 20 rows', rows === 20, `rows=${rows}`);
} catch (e) {
  failures++;
  console.log('FAIL', e.message);
  await shot(page, SHOTS, 'error.png');
} finally {
  await browser.close();
  // Remove the written-back Observations: clean the test patient and reload its baseline
  execFileSync('python3', [path.join(HERE, 'meld.py'), 'clean'], { stdio: 'inherit' });
  execFileSync('python3', [path.join(HERE, 'meld.py'), 'data'], { stdio: 'inherit' });
}
process.exit(failures ? 1 : 0);
