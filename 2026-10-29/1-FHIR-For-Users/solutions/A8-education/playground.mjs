#!/usr/bin/env node
// Drive the patched Smart Forms playground headless with the A8 standalone form and the test
// patient soln-A8-patient-1 (load test-data.json first): pre-populate, tick several delivery
// methods and materials (the multiple-answers case), extract, and optionally write back
// (`--write-back`; then delete what it wrote: see README). Screenshots go to screenshots/.
//
//   node playground.mjs [--write-back]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advancedJson, buildForm, extract, prepopulate, qrAnswers, setPatient, shot, start } from './playground-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'screenshots');
let failures = 0;
const check = (id, ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${msg}`); };
const today = new Date().toLocaleDateString('en-CA');

const { browser, page } = await start();
try {
  await setPatient(page, 'Evan Edutest', 'soln-A8-patient-1');
  await buildForm(page, 'soln-A8-standalone');
  await prepopulate(page);
  let a = qrAnswers(await advancedJson(page));
  check('prepopulated', a['pam-edu-patient']?.[0] === 'Evan Edutest' && a['pam-edu-unit']?.[0] === 'Orthopaedics (A8 test unit)'
    && a['pam-edu-consultant']?.[0] === 'Dr Nora Testsurgeon' && a['pam-edu-date']?.[0] === today,
  `${a['pam-edu-patient']} | ${a['pam-edu-unit']} | ${a['pam-edu-consultant']} | ${a['pam-edu-procedure']} | ${a['pam-edu-date']} | ${a['pam-edu-surgery-ref']}`);
  for (const t of ['Face-to-face', 'Written information (printed)', 'Email']) await page.getByText(t, { exact: true }).click();
  for (const t of ['Anaemia and iron deficiency before surgery (patient information)', 'Intravenous (IV) iron infusion: what to expect',
    'Iron-rich foods (dietary advice)', 'Other']) await page.getByText(t, { exact: true }).click();
  await page.locator('#string-pam-edu-material-other').fill('Hospital PBM fact sheet');
  await page.locator('#text-pam-edu-notes').fill('Understood; will bring questions to the infusion.');
  await page.waitForTimeout(1500);
  a = qrAnswers(await advancedJson(page));
  check('multi-answers-in-qr', a['pam-edu-method']?.length === 3 && a['pam-edu-material']?.length === 4,
    `methods ${a['pam-edu-method']?.map((c) => c.code)}, materials ${a['pam-edu-material']?.map((c) => c.code)}`);
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
  await page.locator('#label-pam-edu-patient').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, SHOTS, '01-filled.png');

  await extract(page);
  const bundle = await advancedJson(page, 'Extract', 'TemplateExtractResult');
  const proc = bundle.entry.find((e) => e.resource.resourceType === 'Procedure');
  const comm = bundle.entry.find((e) => e.resource.resourceType === 'Communication');
  check('extract', bundle.entry.length === 2 && proc && comm, bundle.entry.map((e) => e.resource.resourceType).join(', '));
  const p = proc?.resource; const m = comm?.resource;
  check('procedure', p?.category.coding[0].code === '409073007' && p.code.coding[0].code === '311401005' && p.performedDateTime === today
    && p.usedCode.length === 4, `education ${p?.performedDateTime}; usedCode: ${p?.usedCode.map((u) => u.text).join(' | ')}`);
  check('communication-multiple', m?.medium.map((x) => x.coding[0].code).join() === 'FACE,WRITTEN,EMAILWRIT' && m.payload.length === 4
    && m.partOf[0].reference === proc.fullUrl && m.about[0].reference === 'ServiceRequest/soln-A8-patient-1-surgery',
  `medium ${m?.medium.map((x) => x.coding[0].code)}; payload ${m?.payload.map((x) => x.contentString).join(' | ')}; partOf ${m?.partOf?.[0].reference}`);
  await shot(page, SHOTS, '02-extracted-bundle.png');
  console.log(JSON.stringify(bundle, null, 1).slice(0, 5000));
  if (process.argv.includes('--write-back')) {
    await page.getByRole('button', { name: 'Review write back items' }).click();
    await page.waitForTimeout(3000);
    const btn = page.getByRole('button', { name: /Write back \(\d+ entr/i });
    const label = await btn.innerText();
    await btn.click();
    await page.getByText(/Write back to .* (successful|failed)/i).first().waitFor({ timeout: 60000 });
    const msg = await page.getByText(/Write back to .* (successful|failed)/i).first().innerText();
    check('write-back', /successful/.test(msg), `${label}: ${msg}`);
    await shot(page, SHOTS, '03-write-back.png');
  }
} catch (e) {
  failures++;
  console.log('FAIL error', e.message);
  console.log('snackbars:', await page.locator('.notistack-SnackbarContainer').innerText().catch(() => ''));
  await shot(page, SHOTS, 'error.png');
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
