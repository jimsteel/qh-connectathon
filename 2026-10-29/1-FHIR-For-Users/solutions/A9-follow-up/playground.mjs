#!/usr/bin/env node
// Drive the patched Smart Forms playground (headless Chromium) through the A9 forms with the test
// patient: pre-populate, fill in, template-based $extract, write back to Meld, and check the server.
//
//   node solutions/A9-follow-up/playground.mjs [managed|cleared|put|all]    (from T/; default all)
//
// Writes to the Meld open endpoint, for soln-A9-patient-1 only; runs ./reset-test-data.sh before
// each run and at the end. Screenshots and the extracted Bundles go into solutions/A9-follow-up/img/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(HERE, '../../decks/package.json'))('playwright');
const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const PLAYGROUND = 'https://aehrc.github.io/qh-connectathon/smart-forms/';
const PATIENT_NAME = 'Fiona Followup-A9';
const IMG = join(HERE, 'img');
mkdirSync(IMG, { recursive: true });
const which = process.argv[2] || 'all';

const reset = () => execFileSync(join(HERE, 'reset-test-data.sh'), { stdio: 'inherit' });
async function get(path) {
  const res = await fetch(`${OPEN}/${path}`, { headers: { Accept: 'application/fhir+json' } });
  return res.json();
}
async function shot(page, name) {
  await page.screenshot({ path: join(IMG, name), fullPage: false });
  console.log('shot', name);
}
async function settle(page) {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(1000);
}

async function openPlayground() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await page.goto(PLAYGROUND, { waitUntil: 'networkidle' });
  await page.getByText(/Go to playground/i).first().click();
  await page.locator('[data-test="launch-settings-button-playground"]').waitFor();
  await page.locator('[data-test="launch-settings-button-playground"]').click();
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('input').first().fill(OPEN);
  await page.locator('[data-test="validate-url-button-playground"]').first().click();
  await dlg.getByText('URL validated').waitFor();
  await page.locator('[data-test="set-fhir-server-button-playground"]').click();
  await dlg.locator('[role=combobox]').first().click();
  const opt = page.getByRole('option', { name: PATIENT_NAME });
  await opt.scrollIntoViewIfNeeded();
  await opt.click();
  await page.getByRole('listbox').waitFor({ state: 'detached' }).catch(() => {});
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  return { browser, page };
}

async function buildForm(page, id) {
  const picker = page.locator('.MuiAutocomplete-input');
  await picker.click();
  await picker.fill(id);
  await page.getByRole('option', { name: id, exact: true }).click();
  await page.getByText('Resolvable URL').waitFor();
  await page.getByRole('button', { name: 'Build form' }).first().click();
  await page.getByText('Follow-up and status').first().waitFor();
  await settle(page);
}

async function prepopulate(page) {
  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some((i) => i.id.includes('pam-fu-referral-date') && i.value));
  } catch (e) {
    await shot(page, 'debug-prepop.png');
    console.log(await page.evaluate(() => [...document.querySelectorAll('input,textarea')].map((i) => `${i.id}=${i.value}`).join('\n')));
    throw e;
  }
  await settle(page);
}

async function extractBundle(page, name) {
  await page.getByRole('button', { name: 'Extract', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Template-based \$extract \[/ }).click();
  await page.getByText('Successful template-based extraction').waitFor();
  await page.getByRole('button', { name: 'Advanced props' }).click();
  await page.getByRole('button', { name: 'Extract', exact: true }).last().click();
  const h = page.getByRole('heading', { name: 'templateExtractResult' });
  await h.waitFor();
  await settle(page);
  const text = await h.locator('xpath=following::pre[1]').innerText();
  writeFileSync(join(IMG, `${name}-extracted-bundle.json`), text);
  await shot(page, `${name}-3-extracted.png`);
  // Also the QR the playground built
  await page.getByRole('button', { name: /^QR$/ }).last().click().catch(() => {});
  await page.waitForTimeout(500);
  const qrText = await page.locator('pre').last().innerText().catch(() => '');
  if (qrText.includes('QuestionnaireResponse')) writeFileSync(join(IMG, `${name}-qr.json`), qrText);
  await page.getByRole('button', { name: 'Extract', exact: true }).last().click();
  await page.waitForTimeout(500);
  return JSON.parse(text);
}

async function writeBack(page, name) {
  await page.getByRole('button', { name: 'Review write back items' }).click();
  await page.locator('[role=dialog]').getByText('Select items to write back').waitFor();
  await page.waitForTimeout(1000);
  await shot(page, `${name}-4-write-back-dialog.png`);
  await page.getByRole('button', { name: /Write back \(\d+ entr/i }).click();
  const ok = page.getByText(/Write back to .* successful/).first();
  const bad = page.getByText(/fail|error/i).first();
  await Promise.race([ok.waitFor(), bad.waitFor({ timeout: 30000 })]);
  await page.waitForTimeout(800);
  await shot(page, `${name}-5-write-back-result.png`);
}

async function chooseStatus(page, label) {
  await page.getByRole('radio', { name: label }).check();
  await page.waitForTimeout(500);
}

async function run(name, formId, fill, checkServer) {
  reset();
  const { browser, page } = await openPlayground();
  try {
    await buildForm(page, formId);
    await prepopulate(page);
    await shot(page, `${name}-1-prepopulated.png`);
    await fill(page);
    await settle(page);
    await shot(page, `${name}-2-filled.png`);
    const bundle = await extractBundle(page, name);
    console.log(name, 'extracted:', bundle.entry.map((e) => `${e.request.method} ${e.request.url}`).join(', '));
    await writeBack(page, name);
    await checkServer();
    if (name === 'managed') {
      // close the loop: pre-populate again, the new note and due date come back
      await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
      await prepopulate(page);
      await page.locator('#text-pam-fu-previous-notes, [id$="pam-fu-previous-notes"]').first().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, `${name}-6-close-the-loop.png`);
    }
  } finally {
    await browser.close();
  }
}

const tasks = async () => (await get('Task?patient=soln-A9-patient-1&_count=50')).entry?.map((e) => e.resource) || [];
const episode = () => get('EpisodeOfCare/soln-A9-episode-1');

if (which === 'managed' || which === 'all') {
  await run('managed', 'soln-A9-standalone', async (page) => {
    await page.locator('[id$="pam-fu-weeks"]').first().fill('6');
    await page.waitForTimeout(3000); // the renderer recalculates the due date after a short delay
    await page.locator('[id$="pam-fu-note"]').first().fill('Hb 118 today. Recheck FBC and iron studies in 6 weeks.');
    await page.locator('[id$="pam-fu-note"]').first().press('Tab');
  }, async () => {
    const t = await tasks();
    const created = t.filter((x) => !x.id.startsWith('soln-A9-task-'));
    console.log('server: tasks', t.map((x) => `${x.id}:${x.status}:${x.restriction?.period?.end || ''}`).join(' '));
    console.log('server: new Task', JSON.stringify(created.map(({ meta, ...r }) => r)));
    console.log('server: episode status', (await episode()).status);
  });
}
if (which === 'cleared' || which === 'all') {
  await run('cleared', 'soln-A9-standalone', async (page) => { await chooseStatus(page, 'Cleared'); }, async () => {
    const e = await episode();
    console.log('server: episode', e.status, JSON.stringify(e.period), 'version', e.meta.versionId);
    console.log('server: tasks', (await tasks()).map((x) => `${x.id}:${x.status}`).join(' '));
  });
}
if (which === 'put' || which === 'all') {
  await run('put', 'soln-A9-standalone-put', async (page) => { await chooseStatus(page, 'Cleared'); }, async () => {
    const { meta, ...e } = await episode();
    console.log('server: episode (PUT)', JSON.stringify(e), 'version', meta.versionId);
  });
}
reset();
