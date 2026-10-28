#!/usr/bin/env node
// Drive the patched Smart Forms playground (headless Chromium, fresh context) with the A3 standalone
// form and the test patient: build, pre-populate, fill the referral, template $extract, write back.
//
//   node playground.mjs            (NODE_PATH or ../../decks/node_modules must provide playwright)
//   WRITEBACK=0 node playground.mjs   skips the write-back step
//
// Screenshots go to screenshots/. The extracted Bundle is saved to extracted-bundle.json.
// Write-back POSTs a ServiceRequest for soln-A3-patient-1; the script deletes it afterwards
// (cleanup.sh does the same) so the test patient stays at its baseline.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../decks/package.json'));
const { chromium } = require('playwright');

const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const APP = 'https://aehrc.github.io/qh-connectathon/smart-forms/';
const FORM = process.env.FORM || 'soln-A3-standalone';
const PATIENT = { name: 'Avery Solnthree', id: 'soln-A3-patient-1' };
mkdirSync(join(HERE, 'screenshots'), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const log = [];
page.on('request', (r) => { if (r.url().includes('QHConnectathon2026') || r.url().includes('ontoserver')) log.push(`${r.method()} ${decodeURIComponent(r.url())}`); });
const shot = async (name, opts = {}) => { await page.screenshot({ path: join(HERE, 'screenshots', name), ...opts }); console.log('shot', name); };
async function settle() {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(1200);
}
const val = (sel) => page.locator(sel).inputValue();

let exitCode = 0;
try {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByText(/go to playground/i).first().click();
  await page.locator('[data-test="launch-settings-button-playground"]').waitFor();

  // Settings: source server = Meld open endpoint, patient = the A3 test patient
  await page.locator('[data-test="launch-settings-button-playground"]').click();
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('input').first().fill(OPEN);
  await page.locator('[data-test="validate-url-button-playground"]').first().click();
  await dlg.getByText('URL validated').waitFor();
  await page.locator('[data-test="set-fhir-server-button-playground"]').click();
  await dlg.locator('[role=combobox]').first().click();
  const opt = page.getByRole('option', { name: PATIENT.name });
  await opt.scrollIntoViewIfNeeded();
  await opt.click();
  await dlg.getByText(PATIENT.id).waitFor();
  await page.waitForTimeout(800);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();

  // Pick the form from the forms server (= Meld open endpoint) and build it
  const picker = page.locator('.MuiAutocomplete-input');
  await picker.click();
  await picker.fill(FORM);
  await page.getByRole('option', { name: FORM, exact: true }).click();
  await page.getByText('Resolvable URL').waitFor();
  await page.getByRole('button', { name: 'Build form' }).first().click();
  await page.locator('#date-pam-surgery-date').waitFor();
  await settle();
  await shot('01-built.png');

  // Pre-populate
  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  await page.waitForFunction(() => document.querySelector('#date-pam-surgery-date')?.value !== '', null, { timeout: 30000 });
  await settle();
  await page.waitForTimeout(1500);
  const got = {
    procedure: await page.locator('[id*="pam-surgery-procedure"]').first().inputValue().catch(() => '?'),
    surgeon: await val('#string-pam-surgery-surgeon').catch(() => '?'),
    unit: await val('#string-pam-surgery-unit').catch(() => '?'),
    date: await val('#date-pam-surgery-date'),
    days: await page.locator('[id*="pam-surgery-days"]').first().inputValue().catch(() => '?'),
    soonWarning: await page.getByText('Less than 4 weeks to surgery').isVisible(),
    category2Checked: await page.getByRole('radio', { name: 'Category 2' }).isChecked().catch(() => '?'),
  };
  console.log('prepopulated', JSON.stringify(got));
  await shot('02-prepopulated.png', { fullPage: true });

  // Referral: yes -> fill the group
  await page.locator('[data-linkid="pam-referral-make"], #boolean-pam-referral-make').first().getByText('Yes').click()
    .catch(async () => { await page.getByRole('radio', { name: 'Yes' }).first().click(); });
  await page.getByRole('radio', { name: 'Pre-admission clinic' }).waitFor();
  await page.getByRole('radio', { name: 'Pre-admission clinic' }).click();
  await page.getByRole('radio', { name: 'Iron deficiency anaemia' }).click();
  await page.locator('[id*="pam-referral-note"]').first().fill('Hb 98 g/L, ferritin 12 ug/L at pre-admission clinic');
  await page.locator('[id*="pam-referral-note"]').first().press('Tab');
  await page.waitForTimeout(1000);
  console.log('referral date', await val('#date-pam-referral-date').catch(() => '?'));
  await shot('03-referral-filled.png', { fullPage: true });

  // Template-based $extract
  await page.getByRole('button', { name: 'Extract', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Template-based \$extract \[/ }).click();
  await page.getByText('Successful template-based extraction').waitFor();
  await page.getByRole('button', { name: 'Advanced props' }).click();
  await page.getByRole('button', { name: 'Extract', exact: true }).last().click();
  const h = page.getByRole('heading', { name: 'templateExtractResult' });
  await h.waitFor();
  await settle();
  const text = await h.locator('xpath=following::pre[1]').innerText();
  const bundle = JSON.parse(text);
  writeFileSync(join(HERE, 'extracted-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  console.log('extracted', bundle.entry?.length, 'entries:', bundle.entry?.map((e) => `${e.request.method} ${e.request.url}`).join(', '));
  await shot('04-extracted-bundle.png');

  if (process.env.WRITEBACK !== '0') {
    await page.getByRole('button', { name: 'Review write back items' }).click();
    await page.locator('[role=dialog]').getByText('Select items to write back').waitFor();
    await page.waitForTimeout(1000);
    await shot('05-write-back-dialog.png');
    const before = new Set(((await (await fetch(`${OPEN}/ServiceRequest?patient=${PATIENT.id}&_count=100`, { headers: { Accept: 'application/fhir+json' } })).json()).entry || []).map((e) => e.resource.id));
    await page.getByRole('button', { name: /Write back \(\d+ entr/i }).click();
    await page.getByText(/Write back to .* successful/).first().waitFor({ timeout: 60000 });
    await settle();
    await shot('06-write-back-ok.png');
    const after = ((await (await fetch(`${OPEN}/ServiceRequest?patient=${PATIENT.id}&_count=100`, { headers: { Accept: 'application/fhir+json' } })).json()).entry || []).map((e) => e.resource.id);
    const locs = after.filter((id) => !before.has(id)).map((id) => `ServiceRequest/${id}`);
    console.log('write-back created', locs.join(', '));
    // Close the loop: pre-populate again; the new referral shows as the previous referral
    await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
    await page.getByRole('button', { name: 'Populate' }).click();
    await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
    await page.waitForFunction(() => document.querySelector('#date-pam-surgery-existing-referral')?.value !== '', null, { timeout: 30000 })
      .catch(() => {});
    await settle();
    console.log('after write-back, previous referral =', await val('#date-pam-surgery-existing-referral').catch(() => '?'));
    await page.locator('#date-pam-surgery-existing-referral').scrollIntoViewIfNeeded().catch(() => {});
    await shot('07-close-the-loop.png');
    // Read the created resources back, then delete them
    for (const loc of locs) {
      const rel = loc.replace(/^.*?\/open\//, '').replace(/\/_history\/.*$/, '');
      const res = await (await fetch(`${OPEN}/${rel}`, { headers: { Accept: 'application/fhir+json' } })).json();
      writeFileSync(join(HERE, 'written-back-resource.json'), JSON.stringify(res, null, 2) + '\n');
      console.log('read back', rel, JSON.stringify({ status: res.status, priority: res.priority, category: res.category?.[0]?.coding?.[0]?.code, code: res.code?.coding?.[0]?.code, subject: res.subject?.reference, requester: res.requester?.reference, performer: res.performer?.[0]?.reference, reason: res.reasonCode?.[0]?.coding?.[0]?.code, supportingInfo: res.supportingInfo?.[0]?.reference, authoredOn: res.authoredOn, note: res.note?.[0]?.text }));
      if (process.env.KEEP !== '1') {
        // close the loop first: pre-populate again shows the previous referral
        const d = await fetch(`${OPEN}/${rel}`, { method: 'DELETE' });
        console.log('deleted', rel, d.status);
      }
    }
  }
} catch (e) {
  exitCode = 1;
  console.error('ERROR', e.message);
  await shot('error.png', { fullPage: true }).catch(() => {});
} finally {
  writeFileSync(join(HERE, 'screenshots', 'network.log'), log.join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
