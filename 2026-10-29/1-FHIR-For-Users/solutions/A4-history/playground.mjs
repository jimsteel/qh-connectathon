#!/usr/bin/env node
// Drive the patched Smart Forms playground (headless Chromium, fresh context) with the A4 standalone
// form and the test patient soln-A4-patient-1: build, pre-populate, answer the enableWhen trees,
// template $extract, write back, read back, then delete what was written.
//
//   node playground.mjs                 (resolves playwright from ../../decks/node_modules)
//   EXPLORE=1 node playground.mjs       stops after pre-population and dumps the input ids
//   WRITEBACK=0 / KEEP=1                skip write-back / keep the written resources
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../decks/package.json'));
const { chromium } = require('playwright');

const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const APP = 'https://aehrc.github.io/qh-connectathon/smart-forms/';
const FORM = 'soln-A4-standalone';
const PATIENT = { name: 'Blair Solnfour', id: 'soln-A4-patient-1' };
mkdirSync(join(HERE, 'screenshots'), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const log = [];
page.on('request', (r) => { if (r.url().includes('QHConnectathon2026') || r.url().includes('ontoserver')) log.push(`${r.method()} ${r.url()}`); });
const shot = async (name) => { await page.screenshot({ path: join(HERE, 'screenshots', name) }); console.log('shot', name); };
async function settle(ms = 1200) {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(ms);
}
const getJson = async (q) => (await fetch(`${OPEN}/${q}`, { headers: { Accept: 'application/fhir+json' } })).json();
const ids = async (type) => ((await getJson(`${type}?patient=${PATIENT.id}&_count=100`)).entry || []).map((e) => `${type}/${e.resource.id}`);

// Each question has a <label id="label-<linkId>">; its row is the nearest ancestor holding an input.
const row = (linkId, inputSel = 'input') =>
  page.locator(`#label-${linkId}`).first().locator(`xpath=ancestor::*[.//${inputSel}][1]`);
const q = (linkId) => page.locator(`[data-linkid="${linkId}"]`).first();
async function radio(linkId, label) {
  await row(linkId, 'input[@type="radio"]').getByRole('radio', { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
}
async function auto(linkId, text, option) {
  // answerValueSet autocompletes render as a (multiline) textarea combobox
  const input = row(linkId, '*[@role="combobox"]').locator('[role="combobox"]:not([aria-hidden="true"])').first();
  await input.click();
  await input.fill(text);
  await page.getByRole('option', { name: option, exact: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(400);
}
async function date(linkId, ddmmyyyy) {
  const input = row(linkId, 'input').locator('input').first();
  await input.click();
  await input.pressSequentially(ddmmyyyy);
  await input.press('Tab');
}
async function text(linkId, value) {
  await row(linkId, 'textarea').locator('textarea:not([aria-hidden="true"])').first().fill(value);
}

let exitCode = 0;
try {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByText(/go to playground/i).first().click();
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

  const picker = page.locator('.MuiAutocomplete-input');
  await picker.click();
  await picker.fill(FORM);
  await page.getByRole('option', { name: FORM, exact: true }).click();
  await page.getByText('Resolvable URL').waitFor();
  await page.getByRole('button', { name: 'Build form' }).first().click();
  await page.getByText('Bleeding and anaemia screening').first().waitFor();
  await settle();
  await shot('01-built.png');

  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  await page.getByText('Successful', { exact: false }).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('input, textarea')].some((i) => /Chronic kidney disease stage 3/.test(i.value)), null, { timeout: 30000 });
  await settle(2000);
  const values = await page.$$eval('input, textarea', (els) => els.map((e) => [e.id, e.value]).filter(([, v]) => v));
  console.log('prepopulated inputs', JSON.stringify(values));
  await shot('02-prepopulated.png');
  const scroller = page.locator('[data-linkid="pam-history-allergy"]').first();
  await scroller.scrollIntoViewIfNeeded().catch(() => {});
  await shot('03-prepopulated-tables.png');
  if (process.env.EXPLORE) {
    const linkids = await page.$$eval('[data-linkid]', (els) => els.map((e) => e.getAttribute('data-linkid')));
    console.log('data-linkid', JSON.stringify([...new Set(linkids)]));
    throw new Error('EXPLORE stop');
  }

  // HMB visible for this (female) patient via %sexCode
  console.log('HMB question visible (female):', await page.getByText('Heavy menstrual bleeding?').isVisible());

  // GI tree: yes -> symptoms -> investigated: Yes, done -> endoscopy -> Abnormal -> findings
  await radio('pam-history-gi', 'Yes');
  await page.locator('[data-test="checkbox-single-Melaena"]').first().click();
  await radio('pam-history-gi-investigated', 'Yes, done');
  await radio('pam-history-scope-type', 'Gastroscopy').catch(async () => {
    await q('pam-history-scope-type').locator('input').first().click();
    await page.getByRole('option', { name: 'Gastroscopy' }).click();
  });
  await date('pam-history-scope-date', '01/09/2026');
  await radio('pam-history-scope-result', 'Abnormal');
  await text('pam-history-scope-findings', 'Gastric ulcer');
  await shot('04-gi-tree.png');

  // Anticoagulant (AMT ECL refinement) -> plan -> last dose date
  await radio('pam-history-antithrombotic', 'Yes');
  await auto('pam-history-antithrombotic-med', 'apix', 'Apixaban');
  await radio('pam-history-antithrombotic-plan', 'Stop before surgery');
  await date('pam-history-antithrombotic-stop', '15/11/2026');

  // Transfusion -> details -> reaction -> type (ECL)
  await radio('pam-history-transfusion', 'Yes');
  await date('pam-history-transfusion-date', '01/06/2018');
  await radio('pam-history-transfusion-reaction', 'Yes');
  await auto('pam-history-transfusion-reaction-type', 'urticarial', 'Urticarial transfusion reaction');
  await shot('05-anticoag-transfusion.png');

  // Comorbidity: CKD stage 3 (already on the record -> ifNoneExist should not duplicate it)
  await radio('pam-history-ckd', 'Yes');
  await q('pam-history-ckd-stage').locator('input').first().click().catch(() => {});
  await page.getByRole('option', { name: 'Chronic kidney disease stage 3' }).click().catch(async () => {
    await radio('pam-history-ckd-stage', 'Chronic kidney disease stage 3');
  });
  // Cancer -> type (ECL)
  await radio('pam-history-cancer', 'Yes');
  await auto('pam-history-cancer-type', 'carcinoma of colon', 'Carcinoma of colon');
  await shot('06-comorbidities.png');

  // New condition + new procedure
  await auto('pam-history-new-condition-code', 'heart failure', 'Heart failure');
  await radio('pam-history-new-condition-status', 'Active');
  await date('pam-history-new-condition-onset', '15/01/2022');
  await auto('pam-history-new-procedure-code', 'total hip', 'Total hip replacement');
  await date('pam-history-new-procedure-date', '03/04/2012');
  await settle(800);
  await shot('07-add-new.png');

  // Template-based $extract
  await page.getByRole('button', { name: 'Extract', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Template-based \$extract \[/ }).click();
  await page.getByText('Successful template-based extraction').waitFor();
  await page.getByRole('button', { name: 'Advanced props' }).click();
  await page.getByRole('button', { name: 'Extract', exact: true }).last().click();
  const h = page.getByRole('heading', { name: 'templateExtractResult' });
  await h.waitFor();
  await settle();
  const bundle = JSON.parse(await h.locator('xpath=following::pre[1]').innerText());
  writeFileSync(join(HERE, 'extracted-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  console.log('extracted', bundle.entry?.length, 'entries:');
  for (const e of bundle.entry || []) {
    const r = e.resource;
    console.log(' ', e.request.method, e.request.url, e.request.ifNoneExist || '', r.code?.coding?.map((c) => `${c.code} ${c.display}`).join(';'),
      r.performedDateTime || r.onsetDateTime || '', r.note?.[0]?.text || '', r.complication?.[0]?.coding?.[0]?.code || '');
  }
  await shot('08-extracted-bundle.png');

  if (process.env.WRITEBACK !== '0') {
    const before = new Set([...(await ids('Condition')), ...(await ids('Procedure'))]);
    await page.getByRole('button', { name: 'Review write back items' }).click();
    await page.locator('[role=dialog]').getByText('Select items to write back').waitFor();
    await page.waitForTimeout(1000);
    await shot('09-write-back-dialog.png');
    await page.getByRole('button', { name: /Write back \(\d+ entr/i }).click();
    await page.getByText(/Write back to .* successful/).first().waitFor({ timeout: 60000 });
    await settle();
    await shot('10-write-back-ok.png');
    const after = [...(await ids('Condition')), ...(await ids('Procedure'))];
    const created = after.filter((x) => !before.has(x));
    console.log('write-back created', created.length, created.join(', '));
    const ckd = ((await getJson(`Condition?patient=${PATIENT.id}&code=433144002`)).entry || []).length;
    console.log('CKD stage 3 Conditions after write-back (ifNoneExist => 1):', ckd);
    const written = [];
    for (const rel of created) written.push(await getJson(rel));
    writeFileSync(join(HERE, 'written-back-resources.json'), JSON.stringify(written, null, 2) + '\n');
    for (const r of written) console.log('  read back', r.resourceType, r.id, r.category?.[0]?.coding?.[0]?.code || r.category?.coding?.[0]?.code || '', r.code?.coding?.[0]?.code, r.code?.coding?.[0]?.display, r.performedDateTime || r.onsetDateTime || '', r.subject?.reference);

    // Close the loop: pre-populate again -> the new Conditions/Procedures appear in "On record"
    await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
    await page.getByRole('button', { name: 'Populate' }).click();
    await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('input, textarea')].some((i) => /Heart failure/.test(i.value)), null, { timeout: 30000 })
      .then(() => console.log('close the loop: Heart failure now pre-populated in On record'))
      .catch(() => console.log('close the loop: Heart failure NOT found after re-populate'));
    await settle();
    await shot('11-close-the-loop.png');

    if (process.env.KEEP !== '1') {
      for (const rel of created) console.log('deleted', rel, (await fetch(`${OPEN}/${rel}`, { method: 'DELETE' })).status);
    }
  }
} catch (e) {
  if (e.message !== 'EXPLORE stop') { exitCode = 1; console.error('ERROR', e.message); }
  await shot('error.png').catch(() => {});
} finally {
  writeFileSync(join(HERE, 'screenshots', 'network.log'), log.join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
