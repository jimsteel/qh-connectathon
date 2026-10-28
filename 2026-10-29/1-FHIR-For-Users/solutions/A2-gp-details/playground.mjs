#!/usr/bin/env node
// A2 end-to-end in the patched Smart Forms playground, headless. Needs the test data (./load.sh).
//  1. soln-A2-patient-1: pre-populate (GP on record, referring doctor, admission GP); unchanged form
//     -> modified-only extract is empty; choose "GP from the latest admission" -> one PATCH
//     (replace Patient.generalPractitioner) -> write back -> Meld shows the new GP -> close the loop.
//  2. soln-A2-patient-2 (no GP): enter a GP by hand -> PUT Practitioner + PUT PractitionerRole +
//     PATCH (add generalPractitioner) -> write back -> Meld check.
//  3. Reset: reload the test data, delete the manually created Practitioner / PractitionerRole.
//   node playground.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start, shot, setPatient, buildForm, prepopulate, advancedJson, extract, writeBack, qrAnswers,
  check, failed, OPEN, showEditor } from './playground-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'screenshots');
const get = async (p) => (await fetch(`${OPEN}/${p}`, { headers: { Accept: 'application/fhir+json' } })).json();
const save = (name, obj) => fs.writeFileSync(path.join(HERE, name), JSON.stringify(obj, null, 2) + '\n');
const MANUAL_ID = 'soln-A2-gp-testmanual-kim-0000009z';

let { browser, page, requests } = await start();
try {
  // --- 1. patient 1 ---------------------------------------------------------------------------
  await setPatient(page, 'Gina Testgp', 'soln-A2-patient-1');
  await buildForm(page, 'soln-A2-standalone');
  await prepopulate(page);
  await page.getByRole('button', { name: 'Advanced props' }).click().catch(() => {});
  await shot(page, SHOTS, '01-prepopulated.png', { fullPage: true });
  const qr = await advancedJson(page, 'QR', /updatableResponse/);
  save('playground-qr-prepopulated.json', qr);
  const a = qrAnswers(qr);
  const exp = {
    'pam-gp-current-name': 'Dr Ruth Ambrose', 'pam-gp-current-practice': 'Chermside Family Practice (synthetic)',
    'pam-gp-current-phone': '07 3000 0101', 'pam-gp-current-provider': '0000001A', 'pam-gp-current-ref': 'PractitionerRole/soln-A2-role-ambrose',
    'pam-gp-referring-name': 'Dr Lucy Tran', 'pam-gp-referring-practice': 'Aspley Road Surgery (synthetic)',
    'pam-gp-referring-ref': 'PractitionerRole/soln-A2-role-tran', 'pam-gp-referring-date': '2026-10-01',
    'pam-gp-admission-name': 'Dr Omar Haddad', 'pam-gp-admission-practice': 'Kedron Medical Centre (synthetic)',
    'pam-gp-admission-ref': 'PractitionerRole/soln-A2-role-haddad', 'pam-gp-admission-date': '2026-08-10',
    'pam-gp-new-display': 'Dr Ruth Ambrose',
  };
  for (const [l, v] of Object.entries(exp)) check(`prepop ${l}`, a[l]?.[0] === v, JSON.stringify(a[l]));
  check('prepop source = current', a['pam-gp-source']?.[0]?.code === 'current');

  await extract(page, true);
  const none = await advancedJson(page, 'Extract', /^templateExtractResult$/).catch(() => null);
  check('unchanged -> modified-only extract has no entries', (none?.entry?.length ?? 0) === 0,
    none ? `bundle with ${none.entry?.length ?? 0} entries` : 'no extract result shown');

  await showEditor(page);
  await page.getByText('GP from the latest admission', { exact: true }).click();
  await page.waitForTimeout(1500);
  await shot(page, SHOTS, '02-admission-selected.png', { fullPage: true });
  await extract(page, true);
  const b1 = await advancedJson(page, 'Extract', /^templateExtractResult$/);
  save('playground-extracted-admission.json', b1);
  await shot(page, SHOTS, '03-extracted-patch.png');
  const e1 = b1.entry || [];
  const op = e1[0]?.resource?.parameter?.[0]?.part || [];
  const part = (n) => op.find((p) => p.name === n);
  check('one PATCH entry to Patient/soln-A2-patient-1', e1.length === 1 && e1[0].request.method === 'PATCH'
    && e1[0].request.url === 'Patient/soln-A2-patient-1', JSON.stringify(e1.map((e) => e.request)));
  check('patch: replace Patient.generalPractitioner -> haddad', part('type')?.valueCode === 'replace'
    && part('path')?.valueString === 'Patient.generalPractitioner'
    && part('value')?.valueReference?.reference === 'PractitionerRole/soln-A2-role-haddad'
    && part('value')?.valueReference?.display === 'Dr Omar Haddad', JSON.stringify(op));
  const wb1 = await writeBack(page, SHOTS, '04-write-back-dialog.png');
  console.log('write back:', wb1);
  check('write back reported success', /successful/.test(wb1.msg), wb1.msg);
  const p1 = await get('Patient/soln-A2-patient-1');
  check('Meld: patient 1 GP is now Dr Omar Haddad', JSON.stringify(p1.generalPractitioner) ===
    JSON.stringify([{ reference: 'PractitionerRole/soln-A2-role-haddad', display: 'Dr Omar Haddad' }]), JSON.stringify(p1.generalPractitioner));
  await prepopulate(page);
  const a2 = qrAnswers(await advancedJson(page, 'QR', /updatableResponse/));
  check('close the loop: GP on record = Dr Omar Haddad', a2['pam-gp-current-name']?.[0] === 'Dr Omar Haddad', a2['pam-gp-current-name']);
  await shot(page, SHOTS, '05-close-the-loop.png', { fullPage: true });

  // --- 2. patient 2, manual entry -------------------------------------------------------------------
  // Fresh browser for patient 2 (a fresh session, as a user switching patient would have)
  await browser.close();
  ({ browser, page, requests } = await start());
  await setPatient(page, 'Noel Nogp', 'soln-A2-patient-2');
  await buildForm(page, 'soln-A2-standalone');
  await prepopulate(page);
  const a3 = qrAnswers(await advancedJson(page, 'QR', /updatableResponse/));
  check('patient 2: no GP, no source pre-selected', !a3['pam-gp-current-ref'] && !a3['pam-gp-source'], JSON.stringify(a3));
  await showEditor(page);
  await page.getByText('Enter the GP manually', { exact: true }).click();
  await page.waitForTimeout(800);
  for (const [id, v] of [['given', 'Kim'], ['family', 'Testmanual'], ['provider', '0000009Z'],
    ['practice', 'Nundah Test Clinic'], ['phone', '07 3000 0909']]) {
    const f = page.locator(`[id$="pam-gp-manual-${id}"]`).first();
    await f.fill(v);
    await f.press('Tab');
    // Pause like a person would: filling fields back to back faster than the renderer finishes
    // its calculations left calculated answers out of the response in testing
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(1500);
  await shot(page, SHOTS, '06-manual-entry.png', { fullPage: true });
  await extract(page, true);
  const b2 = await advancedJson(page, 'Extract', /^templateExtractResult$/);
  save('playground-extracted-manual.json', b2);
  await shot(page, SHOTS, '07-extracted-manual.png');
  const reqs = (b2.entry || []).map((e) => `${e.request.method} ${e.request.url}`);
  check('manual: PUT Practitioner, PUT PractitionerRole, PATCH Patient', JSON.stringify(reqs.sort()) === JSON.stringify([
    `PATCH Patient/soln-A2-patient-2`, `PUT Practitioner/${MANUAL_ID}`, `PUT PractitionerRole/${MANUAL_ID}-role`].sort()), JSON.stringify(reqs));
  const res = (t) => b2.entry?.find((e) => e.resource.resourceType === t)?.resource;
  const prac = res('Practitioner'); const role = res('PractitionerRole');
  const ops = res('Parameters')?.parameter?.[0]?.part || [];
  check('manual Practitioner content', prac?.name?.[0]?.family === 'Testmanual' && prac?.name?.[0]?.given?.[0] === 'Kim'
    && prac?.identifier?.[0]?.value === '0000009Z', JSON.stringify(prac));
  check('manual PractitionerRole content', role?.practitioner?.reference === `Practitioner/${MANUAL_ID}`
    && role?.organization?.display === 'Nundah Test Clinic' && role?.telecom?.[0]?.value === '07 3000 0909', JSON.stringify(role));
  check('manual PATCH: add generalPractitioner', ops.find((p) => p.name === 'type')?.valueCode === 'add'
    && ops.find((p) => p.name === 'path')?.valueString === 'Patient'
    && ops.find((p) => p.name === 'value')?.valueReference?.reference === `PractitionerRole/${MANUAL_ID}-role`, JSON.stringify(ops));
  // Never let a POST through (server-assigned ids would break the sandbox's soln-A2- id rule)
  if (reqs.some((r) => r.startsWith('POST'))) throw new Error(`refusing to write back POST entries: ${reqs}`);
  const wb2 = await writeBack(page, SHOTS, '08-write-back-manual-dialog.png');
  console.log('write back:', wb2);
  check('manual write back reported success', /successful/.test(wb2.msg), wb2.msg);
  const p2 = await get('Patient/soln-A2-patient-2');
  check('Meld: patient 2 GP = manual PractitionerRole', p2.generalPractitioner?.[0]?.reference === `PractitionerRole/${MANUAL_ID}-role`, JSON.stringify(p2.generalPractitioner));
  const r2 = await get(`PractitionerRole/${MANUAL_ID}-role`);
  check('Meld: manual PractitionerRole exists', r2.resourceType === 'PractitionerRole', r2.resourceType);
  fs.writeFileSync(path.join(HERE, 'playground-requests.log'), requests.join('\n') + '\n');
} finally {
  await browser.close();
  // --- 3. reset (test data first, so patient 2 no longer references the manual GP) ----------------------------------------------------------------------------------
  console.log('reset test data:', execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', OPEN,
    '-H', 'Content-Type: application/fhir+json', '--data-binary', `@${path.join(HERE, 'testdata-bundle.json')}`]).toString());
  for (const r of [`PractitionerRole/${MANUAL_ID}-role`, `Practitioner/${MANUAL_ID}`]) {
    const d = await fetch(`${OPEN}/${r}`, { method: 'DELETE' });
    console.log(`cleanup DELETE ${r} -> ${d.status}`);
  }
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASS');
process.exit(failed() ? 1 : 0);
