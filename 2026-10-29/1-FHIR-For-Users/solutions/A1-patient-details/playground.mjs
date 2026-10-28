#!/usr/bin/env node
// A1 end-to-end in the patched Smart Forms playground, headless:
// soln-A1-standalone + soln-A1-patient-1 -> pre-populate -> check answers -> change the weight ->
// template $extract (modified only) -> check the bundle -> write back -> check Meld -> clean up.
//   node playground.mjs            (writes screenshots/ and playground-*.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, shot, setPatient, buildForm, prepopulate, advancedJson, extract, writeBack, qrAnswers,
  check, failed, OPEN, showEditor } from './playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const PID = 'soln-A1-patient-1';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });

const { browser, page, requests } = await start();
try {
  await setPatient(page, 'Anna Testdetails', PID);
  await buildForm(page, 'soln-A1-standalone');
  await prepopulate(page);
  await page.getByRole('button', { name: 'Advanced props' }).click().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, SHOTS, '01-prepopulated.png', { fullPage: true });

  const qr = await advancedJson(page, 'QR', /updatableResponse/);
  fs.writeFileSync(path.join(HERE, 'playground-qr-prepopulated.json'), JSON.stringify(qr, null, 2));
  const a = qrAnswers(qr);
  const code = (l) => a[l]?.[0]?.code;
  check('name', a['pam-name']?.[0] === 'Anna Testdetails', a['pam-name']);
  check('dob', a['pam-dob']?.[0] === '1956-07-21', a['pam-dob']);
  check('age (calculated)', Number.isInteger(a['pam-age']?.[0]) && a['pam-age'][0] >= 70, a['pam-age']);
  check('sex', code('pam-sex') === 'female');
  check('medicare', a['pam-medicare']?.[0] === '0000099901');
  check('indigenous status', code('pam-indigenous') === '4', JSON.stringify(a['pam-indigenous']));
  check('interpreter', a['pam-interpreter']?.[0] === true);
  check('language', code('pam-language') === 'el', JSON.stringify(a['pam-language']));
  check('phone (mobile first)', a['pam-phone']?.[0] === '0400 000 111', a['pam-phone']);
  check('address line', a['pam-addr-line']?.[0] === '12 Example Street, Unit 3', a['pam-addr-line']);
  check('suburb', a['pam-addr-suburb']?.[0] === 'Chermside');
  check('state', code('pam-addr-state') === 'QLD', JSON.stringify(a['pam-addr-state']));
  check('postcode', a['pam-addr-postcode']?.[0] === '4032');
  check('nok name', a['pam-nok-name']?.[0] === 'Sofia Testdetails', a['pam-nok-name']);
  check('nok relationship', a['pam-nok-relationship']?.[0] === 'Daughter', a['pam-nok-relationship']);
  check('nok phone', a['pam-nok-phone']?.[0] === '0400 000 222');
  check('height (latest)', a['pam-height']?.[0] === 162, a['pam-height']);
  check('weight (latest)', a['pam-weight']?.[0] === 68.4, a['pam-weight']);
  check('on record summary', a['pam-hw-last']?.[0] === 'Latest on record: 162 cm (2026-09-15), 68.4 kg (2026-09-15)', a['pam-hw-last']);
  check('measured on = today', a['pam-hw-date']?.[0] === today, a['pam-hw-date']);
  check('BMI (calculated)', a['pam-bmi']?.[0] === 26.1, a['pam-bmi']);

  // Unchanged form: modified-only extraction must produce no Observations
  await extract(page, true);
  const none = await advancedJson(page, 'Extract', /^templateExtractResult$/).catch(() => null);
  const noneEntries = none?.entry?.length ?? 0;
  check('unchanged form -> modified-only extract has no entries', noneEntries === 0, none ? `bundle with ${noneEntries} entries` : 'no extract result shown');

  // Measured in clinic: weight 66.2 kg
  await showEditor(page);
  const w = page.locator('#decimal-pam-weight');
  await w.fill('66.2');
  await w.press('Tab');
  await page.waitForTimeout(1500);
  await extract(page, true);
  const bundle = await advancedJson(page, 'Extract', /^templateExtractResult$/);
  fs.writeFileSync(path.join(HERE, 'playground-extracted-bundle.json'), JSON.stringify(bundle, null, 2));
  await shot(page, SHOTS, '02-extracted-modified-only.png');
  const obs = (bundle.entry || []).map((e) => e.resource);
  check('modified-only extract: exactly one Observation (weight)', obs.length === 1 && obs[0].code.coding[0].code === '29463-7',
    JSON.stringify(obs.map((o) => o.code?.coding?.[0]?.code)));
  const o = obs[0] || {};
  check('weight Observation content', o.status === 'final' && o.category?.[0]?.coding?.[0]?.code === 'vital-signs'
    && o.subject?.reference === `Patient/${PID}` && o.valueQuantity?.value === 66.2 && o.valueQuantity?.code === 'kg'
    && o.effectiveDateTime === today && bundle.entry[0].request.method === 'POST', JSON.stringify(o));

  // Full (not modified-only) extraction gives both
  await extract(page, false);
  const both = await advancedJson(page, 'Extract', /^templateExtractResult$/);
  check('full extract: height + weight', both.entry?.length === 2, JSON.stringify(both.entry?.map((e) => e.resource.code.coding[0].code)));

  // Write back the modified-only bundle
  await extract(page, true);
  const wb = await writeBack(page, SHOTS, '03-write-back-dialog.png');
  console.log('write back:', wb);
  await shot(page, SHOTS, '04-written-back.png');
  const res = await (await fetch(`${OPEN}/Observation?patient=${PID}&code=29463-7&_sort=-date&_count=5`, { headers: { Accept: 'application/fhir+json' } })).json();
  const newObs = (res.entry || []).map((e) => e.resource).filter((r) => !r.id.startsWith(PID));
  check('written back to Meld', newObs.length === 1 && newObs[0].valueQuantity.value === 66.2, newObs.map((r) => `${r.id} ${r.valueQuantity.value}`).join(', '));

  // Close the loop: pre-populate again picks up 66.2
  await prepopulate(page);
  const qr2 = await advancedJson(page, 'QR', /updatableResponse/);
  check('close the loop: weight 66.2 pre-populated', qrAnswers(qr2)['pam-weight']?.[0] === 66.2, qrAnswers(qr2)['pam-weight']);

  // Clean up: delete the written-back Observation(s) (server-assigned ids)
  for (const r of newObs) {
    const d = await fetch(`${OPEN}/Observation/${r.id}`, { method: 'DELETE' });
    console.log(`cleanup DELETE Observation/${r.id} -> ${d.status}`);
  }
  fs.writeFileSync(path.join(HERE, 'playground-requests.log'), requests.join('\n') + '\n');
} finally {
  await browser.close();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASS');
process.exit(failed() ? 1 : 0);
