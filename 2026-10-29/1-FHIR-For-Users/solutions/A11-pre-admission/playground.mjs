#!/usr/bin/env node
// Drive the patched Smart Forms playground (headless Chromium) through A11, end to end:
//   1. the patient's form for soln-A11-patient-1: pre-populate demographics, answer in plain language,
//      take the QuestionnaireResponse the playground builds;
//   2. store that response on Meld as QuestionnaireResponse/soln-A11-qr-1 (status completed) — the
//      playground has no "save response" (the Smart Forms app does that after a SMART launch);
//   3. the nurse-side form: pre-populate, and check its items were filled from that response.
//
//   node solutions/A11-pre-admission/playground.mjs          (from T/)
//
// Screenshots, the response and the nurse-side response go into solutions/A11-pre-admission/img/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(HERE, '../../decks/package.json'))('playwright');
const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const IMG = join(HERE, 'img');
mkdirSync(IMG, { recursive: true });
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: join(IMG, name), ...opts }); console.log('shot', name); };
async function settle(page) {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(1000);
}

async function openPlayground(patientName) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await page.goto('https://aehrc.github.io/qh-connectathon/smart-forms/', { waitUntil: 'networkidle' });
  await page.getByText(/Go to playground/i).first().click();
  await page.locator('[data-test="launch-settings-button-playground"]').click();
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('input').first().fill(OPEN);
  await page.locator('[data-test="validate-url-button-playground"]').first().click();
  await dlg.getByText('URL validated').waitFor();
  await page.locator('[data-test="set-fhir-server-button-playground"]').click();
  await dlg.locator('[role=combobox]').first().click();
  const opt = page.getByRole('option', { name: patientName });
  await opt.scrollIntoViewIfNeeded();
  await opt.click();
  await page.getByRole('listbox').waitFor({ state: 'detached' }).catch(() => {});
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  return { browser, page };
}
async function buildAndPrepopulate(page, id, waitFor) {
  const picker = page.locator('.MuiAutocomplete-input');
  await picker.click();
  await picker.fill(id);
  await page.getByRole('option', { name: id, exact: true }).click();
  await page.getByText('Resolvable URL').waitFor();
  await page.getByRole('button', { name: 'Build form' }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  await page.waitForFunction(waitFor);
  await settle(page);
}
async function radio(page, linkId, value) {
  await page.locator(`[data-linkid="${linkId}"] input[type=radio][value="${value}"]`).first().click();
  await page.waitForTimeout(250);
}
async function tick(page, linkId, label) {
  await page.locator(`[data-linkid="${linkId}"]`).getByLabel(label).first().click();
  await page.waitForTimeout(250);
}
async function readQR(page, name) {
  await page.getByRole('button', { name: 'Advanced props' }).click();
  await page.getByRole('button', { name: /^QR$/ }).last().click();
  await page.waitForTimeout(800);
  const text = await page.getByRole('heading', { name: /response/i }).first().locator('xpath=following::pre[1]').innerText()
    .catch(async () => page.locator('pre').last().innerText());
  writeFileSync(join(IMG, name), text);
  return JSON.parse(text);
}

// --- 1. patient form ------------------------------------------------------------------------------
let qr;
{
  const { browser, page } = await openPlayground('Grace Preadmit-A11');
  try {
    await buildAndPrepopulate(page, 'soln-A11-pre-admission',
      () => document.querySelector('#string-pam-pa-name')?.value);
    await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
    await shot(page, 'patient-1-prepopulated.png');
    await radio(page, 'pam-pa-interpreter', 'false');
    await radio(page, 'pam-pa-told-anaemia', 'Y');
    await radio(page, 'pam-pa-iron-tablets', 'Y');
    await radio(page, 'pam-pa-iron-infusion', 'N');
    await radio(page, 'pam-pa-tired', 'Y');
    await radio(page, 'pam-pa-bruising', 'N');
    await radio(page, 'pam-pa-gut-bleeding', 'N');
    await radio(page, 'pam-pa-heavy-periods', 'Y');
    await radio(page, 'pam-pa-blood-thinners', 'Y');
    await page.locator('#string-pam-pa-blood-thinners-names').fill('Aspirin 100 mg daily');
    await radio(page, 'pam-pa-kidney', 'N');
    await radio(page, 'pam-pa-diet-type', '765021002');
    await radio(page, 'pam-pa-tea-coffee', 'Y');
    await radio(page, 'pam-pa-appetite', 'N');
    await radio(page, 'pam-pa-transfused-before', 'N');
    await radio(page, 'pam-pa-transfusion-accept', 'some');
    await page.waitForTimeout(500);
    await tick(page, 'pam-pa-products', 'Albumin');
    await tick(page, 'pam-pa-products', /^Cell salvage/);
    await radio(page, 'pam-pa-transfusion-reason', 'religious');
    await radio(page, 'pam-pa-directive', 'Y');
    await radio(page, 'pam-pa-talk', 'Y');
    await radio(page, 'pam-pa-completed-by', 'patient');
    await settle(page);
    const tr = page.locator('[data-linkid="pam-pa-transfusion"]').first();
    await tr.scrollIntoViewIfNeeded();
    await shot(page, 'patient-2-transfusion.png');
    await page.locator('[data-linkid="pam-pa-health"]').first().scrollIntoViewIfNeeded();
    await shot(page, 'patient-3-health.png');
    qr = await readQR(page, 'patient-qr-from-playground.json');
  } finally { await browser.close(); }
}

// --- 2. store the response as the patient's completed form ----------------------------------------
const stored = {
  ...qr, id: 'soln-A11-qr-1', status: 'completed', authored: '2026-10-28T09:30:00+10:00',
  subject: { reference: 'Patient/soln-A11-patient-1' }, author: { reference: 'Patient/soln-A11-patient-1' },
  source: { reference: 'Patient/soln-A11-patient-1' },
};
delete stored.meta;
writeFileSync(join(IMG, 'patient-qr-stored.json'), JSON.stringify(stored, null, 2) + '\n'); // test-data.json holds a copy
const put = await fetch(`${OPEN}/QuestionnaireResponse/soln-A11-qr-1`, {
  method: 'PUT', headers: { 'Content-Type': 'application/fhir+json' }, body: JSON.stringify(stored) });
console.log('PUT QuestionnaireResponse/soln-A11-qr-1 ->', put.status, 'questionnaire =', stored.questionnaire);

// --- 3. nurse side --------------------------------------------------------------------------------
{
  const { browser, page } = await openPlayground('Grace Preadmit-A11');
  try {
    await buildAndPrepopulate(page, 'soln-A11-nurse-standalone',
      () => document.querySelector('#string-pam-pr-source')?.value);
    await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
    await shot(page, 'nurse-1-prepopulated.png');
    const nqr = await readQR(page, 'nurse-qr-from-playground.json');
    const vals = {};
    (function walk(items) { for (const i of items || []) { if (i.answer) vals[i.linkId] = i.answer.map((a) => a.valueCoding?.code ?? Object.values(a).find((v) => typeof v !== 'object') ?? a); walk(i.item); } })(nqr.item);
    console.log('nurse form answers:', JSON.stringify(vals, null, 1));
  } finally { await browser.close(); }
}
