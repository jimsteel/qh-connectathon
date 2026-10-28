#!/usr/bin/env node
// The A5 + A6 modules inside the whole assembled PAM form (soln-A6-pam-assembled, from
// assemble-check.mjs): pre-populate for soln-A6-patient-1 and check that the pathology answers
// (A5 tab) and sex (Patient details tab) feed the diagnosis rules (A6 tab) through the root variables.
//
//   python3 meld.py forms && python3 meld.py data && node playground-assembled.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, setPatient, buildForm, prepopulate, advancedJson, shot, qrAnswers } from '../A5-pathology/playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const expect = (id, ok, msg = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); };
const { browser, page } = await start();
await page.setViewportSize({ width: 1600, height: 1300 });
try {
  await setPatient(page, 'Arlo Diagtest', 'soln-A6-patient-1');
  await buildForm(page, 'soln-A6-pam-assembled');
  await prepopulate(page);
  await page.waitForTimeout(3000);
  await page.getByText('Diagnosis', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, path.join(HERE, 'screenshots'), '08-assembled-form-diagnosis-tab.png', { clip: { x: 0, y: 0, width: 645, height: 1300 } });
  const qr = await advancedJson(page);
  fs.writeFileSync(path.join(HERE, 'playground-results/qr-assembled.json'), JSON.stringify(qr, null, 2) + '\n');
  const a = qrAnswers(qr);
  expect('assembled: sex from Patient details', a['pam-sex']?.[0]?.code === 'male');
  expect('assembled: Hb from Pathology', a['pam-hb']?.[0] === 118, String(a['pam-hb']));
  expect('assembled: pathway', String(a['pam-pathway']?.[0]).startsWith('Anaemia with inflammation'), String(a['pam-pathway']));
  expect('assembled: suggested ACD', String(a['pam-diagnosis-suggested']?.[0]).includes('234347009'), String(a['pam-diagnosis-suggested']));
  expect('assembled: target due date', a['pam-target-hb-due']?.[0] === '2026-12-03', String(a['pam-target-hb-due']));
} catch (e) {
  failures++; console.log('FAIL', e.message);
  await shot(page, path.join(HERE, 'screenshots'), 'error.png');
} finally { await browser.close(); }
process.exit(failures ? 1 : 0);
