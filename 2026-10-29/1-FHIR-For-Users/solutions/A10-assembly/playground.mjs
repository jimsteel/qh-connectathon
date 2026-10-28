#!/usr/bin/env node
// Headless run of the assembled PAM form (soln-pam-assembled) in the patched Smart Forms playground
// for the test patient soln-A10-patient-1 (Ada Assembletest):
//   1. pre-populate; check one or more values from every module, and the cross-module ones (root
//      variables: sex from A1 and results from A5 feed A6 and A7; surgery date from A3 feeds A6)
//   2. screenshot every tab
//   3. what-if: change Hb and ferritin on the Pathology tab -> Diagnosis (A6) and Ganzoni (A7) follow
//   4. edit three sections (weight in A1, diagnosis in A6, IV iron order + booking in A7), extract
//      ("modified only") and check the resources, incl. A7's reasonCode from A6's answer and the
//      basedOn link from the root-level extractAllocateId
//   5. --write-back: write the extracted resources to Meld and read them back
//
//   python3 meld.py forms && python3 meld.py data && node playground.mjs [--write-back]
//   python3 meld.py clean     # afterwards
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start, setPatient, buildForm, prepopulate, advancedJson, shot, scrollTo, extract, writeBack, qrAnswers, check, failed, showEditor, OPEN }
  from './playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const RESULTS = path.join(HERE, 'playground-results');
fs.mkdirSync(RESULTS, { recursive: true });
const save = (f, j) => fs.writeFileSync(path.join(RESULTS, f), JSON.stringify(j, null, 2) + '\n');
const FORM = { clip: { x: 0, y: 0, width: 645, height: 1300 } };
const P = 'soln-A10-patient-1';
const TABS = ['Patient details', 'GP details', 'Proposed surgery', 'History', 'Patient-reported (pre-admission form)',
  'Pathology', 'Diagnosis', 'Treatment', 'Patient education', 'Follow-up and status'];
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');

const { browser, page } = await start();
await page.setViewportSize({ width: 1600, height: 1300 });
const tab = async (name) => {
  await page.locator('.MuiList-root, nav, [role=tablist]').getByText(name, { exact: true }).first().click()
    .catch(() => page.getByText(name, { exact: true }).first().click());
  await page.waitForTimeout(1200);
};
const qr = async () => qrAnswers(await advancedJson(page, 'QR', 'updatableResponse'));
const code = (v) => v?.code ?? v;
try {
  await setPatient(page, 'Ada Assembletest', P);
  await buildForm(page, 'soln-pam-assembled');
  await prepopulate(page);
  await page.waitForTimeout(4000);
  const full = await advancedJson(page, 'QR', 'updatableResponse');
  save('qr-prepopulated.json', full);
  let a = qrAnswers(full);

  // 1. one or more values per module
  const show = (k) => JSON.stringify((a[k] || []).map((v) => v?.display ?? v));
  check('A1 patient details', a['pam-name']?.[0] === 'Ada Assembletest' && code(a['pam-sex']?.[0]) === 'female' && a['pam-weight']?.[0] === 68.4 && a['pam-bmi']?.[0] === 26.1,
    `name ${show('pam-name')}, sex ${code(a['pam-sex']?.[0])}, weight ${show('pam-weight')}, BMI ${show('pam-bmi')}`);
  check('A2 GP details', a['pam-gp-current-name']?.[0] === 'Dr Ruth Ambrose' && a['pam-gp-referring-name']?.[0] === 'Dr Lucy Tran', `${show('pam-gp-current-name')}, referring ${show('pam-gp-referring-name')}`);
  check('A3 proposed surgery', a['pam-surgery-procedure']?.[0]?.display === 'Total hip replacement' && a['pam-surgery-date']?.[0] === '2026-11-18' && Number.isInteger(a['pam-surgery-days']?.[0]),
    `${show('pam-surgery-procedure')} on ${show('pam-surgery-date')}, ${show('pam-surgery-days')} days`);
  check('A4 history', (a['pam-history-condition-code'] || []).length === 3 && (a['pam-history-allergy-code'] || []).length === 1, `conditions ${show('pam-history-condition-code')}`);
  check('A11 patient-reported', code(a['pam-pr-transfusion-accept']?.[0]) && (a['pam-pr-products'] || []).length === 2, `${show('pam-pr-transfusion-accept')} ${show('pam-pr-products')}`);
  check('A5 pathology', a['pam-hb']?.[0] === 121 && a['pam-ferritin']?.[0] === 310 && a['pam-hb-initial']?.[0] === 104, `Hb ${show('pam-hb')}, ferritin ${show('pam-ferritin')}, initial Hb ${show('pam-hb-initial')}`);
  check('A6 diagnosis (root variables from A1 sex + A5 results)', a['pam-anaemia']?.[0] === false && a['pam-iron-deficiency']?.[0] === false && String(a['pam-diagnosis-suggested']?.[0]).startsWith('None'),
    `anaemia ${show('pam-anaemia')}, ID ${show('pam-iron-deficiency')}, suggested ${show('pam-diagnosis-suggested')}`);
  check('A6 target-Hb due date = A6 surgery query', a['pam-target-hb-due']?.[0] === '2026-11-18', show('pam-target-hb-due'));
  check('A7 Ganzoni (root variables from A1 height/weight/sex + A5 Hb)', a['pam-ideal-weight']?.[0] === 54.1 && a['pam-ganzoni-target-hb']?.[0] === 150 && a['pam-ganzoni']?.[0] === 877 && a['pam-ganzoni-rounded']?.[0] === 900,
    `IBW ${show('pam-ideal-weight')}, target ${show('pam-ganzoni-target-hb')} (renamed linkId), deficit ${show('pam-ganzoni')}, rounded ${show('pam-ganzoni-rounded')}`);
  check('A8 education', a['pam-edu-procedure']?.[0] === 'Total hip replacement' && a['pam-edu-consultant']?.[0] === 'Dr Alan Pierce', `${show('pam-edu-procedure')}, ${show('pam-edu-consultant')}`);
  check('A9 follow-up', a['pam-fu-episode-id']?.[0] === 'soln-A10-a9-episode-1' && a['pam-fu-open-task-id']?.[0] === 'soln-A10-a9-task-2', `${show('pam-fu-episode-id')}, open task ${show('pam-fu-open-task-id')}`);
  check('no item answered twice by two modules (pam-target-hb only from A6)', !(a['pam-target-hb'] || []).length, show('pam-target-hb'));

  // 2. every tab
  await showEditor(page);
  for (const [i, t] of TABS.entries()) {
    await tab(t);
    await shot(page, SHOTS, `${String(i + 1).padStart(2, '0')}-${slug(t)}.png`, FORM);
  }

  // 3. what-if on the Pathology tab
  await tab('Pathology');
  await page.locator('#decimal-pam-hb').fill('104');
  await page.locator('#decimal-pam-hb').press('Tab');
  await page.waitForTimeout(4000); // let the calculations settle before the next edit
  await page.locator('#decimal-pam-ferritin').fill('15');
  await page.locator('#decimal-pam-ferritin').press('Tab');
  await page.waitForTimeout(4000);
  a = await qr();
  check('what-if: Hb 104, ferritin 15 -> A6 iron deficiency anaemia', a['pam-anaemia']?.[0] === true && String(a['pam-diagnosis-suggested']?.[0]).includes('87522002'), show('pam-diagnosis-suggested'));
  check('what-if: A7 Ganzoni follows', a['pam-ganzoni']?.[0] === 1098 && a['pam-ganzoni-rounded']?.[0] === 1100, `deficit ${show('pam-ganzoni')}, rounded ${show('pam-ganzoni-rounded')}`);
  await tab('Diagnosis');
  await shot(page, SHOTS, '11-what-if-diagnosis.png', FORM);

  // 4. edit three sections
  await page.locator('#choice-pam-diagnosis').getByRole('radio', { name: 'Iron deficiency anaemia' }).check();
  await page.waitForTimeout(800);
  await tab('Patient details');
  await page.locator('#decimal-pam-weight').fill('70');
  await page.locator('#decimal-pam-weight').press('Tab');
  await tab('Treatment');
  await page.getByText('Intravenous iron infusion', { exact: true }).click();
  await page.locator('#choice-pam-iron-product').click();
  await page.getByRole('option', { name: 'Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial' }).click();
  await page.locator('#choice-pam-iron-product').press('Escape');
  await page.locator('#date-pam-infusion-date').fill('05/11/2026');
  await page.locator('#text-pam-infusion-notes').fill('A10 assembled-form test');
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: '.MuiAutocomplete-popper { display: none !important; }' });
  await scrollTo(page, '#label-pam-tx-plan');
  await shot(page, SHOTS, '12-treatment-order.png', FORM);
  a = await qr();
  save('qr-filled.json', await advancedJson(page, 'QR', 'updatableResponse'));
  check('order: dose 1100 split 1000 + 100', a['pam-iron-dose']?.[0] === 1100 && a['pam-iron-dose-1']?.[0] === 1000 && a['pam-iron-dose-2']?.[0] === 100,
    `dose ${show('pam-iron-dose')}: ${show('pam-iron-dose-1')} + ${show('pam-iron-dose-2')}`);

  await extract(page, true);
  const bundle = await advancedJson(page, 'Extract', 'TemplateExtractResult');
  save('extract-bundle.json', bundle);
  await shot(page, SHOTS, '13-extracted-bundle.png');
  const res = (t) => bundle.entry?.filter((e) => e.resource.resourceType === t) ?? [];
  const types = (bundle.entry ?? []).map((e) => `${e.request?.method} ${e.resource?.resourceType ?? e.request?.url}`);
  console.log('extracted:', types.join(', '));
  const obs = res('Observation').find((e) => e.resource.code.coding[0].code === '29463-7');
  check('extract A1: weight Observation 70 kg', obs?.resource.valueQuantity.value === 70 && obs.resource.subject.reference === `Patient/${P}`, JSON.stringify(obs?.resource.valueQuantity));
  const cond = res('Condition').find((e) => e.resource.code.coding[0].code === '87522002');
  check('extract A6: Condition 87522002', !!cond, cond?.resource.code.coding[0].display);
  const mr = res('MedicationRequest')[0];
  const sr = res('ServiceRequest').find((e) => e.resource.code?.coding?.[0]?.code === '718520009');
  check('extract A7: MedicationRequest, reasonCode from the A6 module', mr?.resource.reasonCode?.[0]?.coding?.[0]?.code === '87522002', JSON.stringify(mr?.resource.reasonCode));
  check('extract A7: ServiceRequest basedOn the MedicationRequest (root-level extractAllocateId)', !!mr && sr?.resource.basedOn?.[0]?.reference === mr.fullUrl, `${sr?.resource.basedOn?.[0]?.reference} vs ${mr?.fullUrl}`);
  const notPatient = (bundle.entry ?? []).filter((e) => !JSON.stringify(e).includes(`Patient/${P}`));
  check('everything extracted is about the test patient', notPatient.length === 0, notPatient.map((e) => e.request?.url).join(', '));

  // 5. write back
  if (process.argv.includes('--write-back') && notPatient.length === 0) {
    const { label, msg } = await writeBack(page, SHOTS, '14-write-back-dialog.png');
    check('write back', /successful/i.test(msg), `${label}: ${msg}`);
    const back = {};
    for (const t of ['Observation', 'Condition', 'MedicationRequest', 'ServiceRequest']) {
      const r = await (await fetch(`${OPEN}/${t}?subject=Patient/${P}&_lastUpdated=gt${new Date(Date.now() - 600000).toISOString()}&_format=json`)).json();
      back[t] = (r.entry ?? []).map((e) => e.resource).filter((x) => !x.id.startsWith('soln-')); // written back (server ids), not the test data
    }
    save('meld-written-back.json', back);
    const msr = back.ServiceRequest.find((r) => r.code?.coding?.[0]?.code === '718520009');
    const mmr = back.MedicationRequest[0];
    check('on Meld: weight Observation, Condition, MedicationRequest, booking ServiceRequest',
      back.Observation.some((o) => o.valueQuantity?.value === 70) && back.Condition.some((c) => c.code.coding[0].code === '87522002') && mmr && msr,
      Object.entries(back).map(([k, v]) => `${k} ${v.length}`).join(', '));
    check('on Meld: ServiceRequest.basedOn resolved to the MedicationRequest', msr?.basedOn?.[0]?.reference === `MedicationRequest/${mmr?.id}`, msr?.basedOn?.[0]?.reference);
  }
} catch (e) {
  check('error', false, e.message);
  await shot(page, SHOTS, 'error.png');
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASS');
process.exit(failed() ? 1 : 0);
