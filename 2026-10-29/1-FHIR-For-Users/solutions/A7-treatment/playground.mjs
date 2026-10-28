#!/usr/bin/env node
// Drive the patched Smart Forms playground headless with the A7 standalone form and the test
// patient soln-A7-patient-1 (load test-data.json first): pre-populate, tick IV iron, pick the
// product from the AMT value set (expanded by Ontoserver), set the infusion date, extract, and
// optionally write back (`--write-back`; then delete what it wrote: see README).
// Screenshots go to screenshots/. Prints PASS/FAIL lines.
//
//   node playground.mjs [--write-back]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advancedJson, buildForm, extract, prepopulate, qrAnswers, setPatient, shot, start, writeBack } from './playground-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');
let failures = 0;
const check = (id, ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${msg}`); };
const scrollToItem = (page, linkId) => page.locator(`#label-${linkId}`).first()
  .evaluate((el) => el.scrollIntoView({ block: 'start' })).then(() => page.waitForTimeout(600));

const { browser, page } = await start();
try {
  await setPatient(page, 'Iris Ganzonitest', 'soln-A7-patient-1');
  await buildForm(page, 'soln-A7-standalone');
  await prepopulate(page);
  let a = qrAnswers(await advancedJson(page));
  check('prepopulated', a['pam-weight']?.[0] === 82 && a['pam-height']?.[0] === 160 && a['pam-hb']?.[0] === 98 && a['pam-sex']?.[0]?.code === 'female',
    `weight ${a['pam-weight']}, height ${a['pam-height']}, Hb ${a['pam-hb']}, sex ${a['pam-sex']?.[0]?.code}`);
  check('ganzoni', a['pam-ideal-weight']?.[0] === 52.3 && a['pam-dosing-weight']?.[0] === 52.3 && a['pam-target-hb']?.[0] === 150
    && a['pam-iron-stores']?.[0] === 500 && a['pam-ganzoni']?.[0] === 1153 && a['pam-ganzoni-rounded']?.[0] === 1200,
  `IBW ${a['pam-ideal-weight']}, dosing ${a['pam-dosing-weight']}, target ${a['pam-target-hb']}, stores ${a['pam-iron-stores']}, deficit ${a['pam-ganzoni']}, suggested ${a['pam-ganzoni-rounded']}`);
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await scrollToItem(page, 'pam-tx-height');
  await shot(page, SHOTS, '01-prepopulated-ganzoni.png');

  // Treatment plan: IV iron -> order and booking appear
  await page.getByText('Intravenous iron infusion', { exact: true }).click();
  await page.locator('#choice-pam-iron-product').click();
  const options = await page.getByRole('option').allInnerTexts();
  check('amt-valueset', options.length === 7 && options.every((o) => /ferric (carboxymaltose|derisomaltose)/.test(o)), `${options.length} options from Ontoserver: ${options.join(' | ')}`);
  await page.getByRole('option', { name: 'Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial' }).click();
  await page.locator('#date-pam-infusion-date').fill('03/11/2026');
  await page.locator('#text-pam-infusion-notes').fill('Prefers mornings');
  await page.waitForTimeout(2000);
  a = qrAnswers(await advancedJson(page));
  check('split', a['pam-iron-dose']?.[0] === 1200 && a['pam-iron-max-infusion']?.[0] === 1000 && a['pam-iron-infusions']?.[0] === 2
    && a['pam-iron-dose-1']?.[0] === 1000 && a['pam-iron-dose-2']?.[0] === 200,
  `dose ${a['pam-iron-dose']}, max/infusion ${a['pam-iron-max-infusion']}, infusions ${a['pam-iron-infusions']}: ${a['pam-iron-dose-1']} + ${a['pam-iron-dose-2']}`);
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await scrollToItem(page, 'pam-tx-plan');
  await page.locator('#choice-pam-iron-product').press('Escape'); // close the product list
  await page.locator('#text-pam-infusion-notes').click();
  // headless, the product list stays drawn after the choice; hide it for the screenshot
  await page.addStyleTag({ content: '.MuiAutocomplete-popper { display: none !important; }' });
  await page.waitForTimeout(500);
  await scrollToItem(page, 'pam-iron-product');
  await shot(page, SHOTS, '02-order-and-booking.png');

  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'TemplateExtractResult');
  const types = bundle.entry.map((e) => e.resource.resourceType);
  const mr = bundle.entry.find((e) => e.resource.resourceType === 'MedicationRequest');
  const sr = bundle.entry.find((e) => e.resource.resourceType === 'ServiceRequest');
  check('extract', types.join() === 'MedicationRequest,ServiceRequest', types.join(', '));
  const doses = mr?.resource.dosageInstruction.map((d) => d.doseAndRate[0].doseQuantity.value).join(' + ');
  check('medicationrequest', mr?.resource.medicationCodeableConcept.coding[0].code === '1312141000168105' && doses === '1000 + 200'
    && mr.resource.subject.reference === 'Patient/soln-A7-patient-1', `AMT ${mr?.resource.medicationCodeableConcept.coding[0].code}, doses ${doses}, ${mr?.resource.subject.reference}`);
  check('servicerequest', sr?.resource.code.coding[0].code === '718520009' && sr.resource.occurrenceDateTime === '2026-11-03'
    && sr.resource.quantityQuantity.value === 2 && sr.resource.basedOn?.[0].reference === mr?.fullUrl,
  `${sr?.resource.code.coding[0].display}, ${sr?.resource.occurrenceDateTime}, ${sr?.resource.quantityQuantity?.value} infusions, basedOn ${sr?.resource.basedOn?.[0].reference}`);
  await shot(page, SHOTS, '03-extracted-bundle.png');
  console.log(JSON.stringify(bundle, null, 1).slice(0, 6000));

  if (process.argv.includes('--write-back')) {
    const label = await writeBack(page);
    check('write-back', true, label);
    await shot(page, SHOTS, '04-write-back.png');
  }
} catch (e) {
  failures++;
  console.log('FAIL error', e.message);
  await shot(page, SHOTS, 'error.png');
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
