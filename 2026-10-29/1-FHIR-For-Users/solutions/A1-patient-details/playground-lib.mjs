// Drive the patched Smart Forms playground (https://aehrc.github.io/qh-connectathon/smart-forms/)
// headless with Playwright from decks/node_modules: set the source FHIR server + patient, pick a
// form, pre-populate, extract (optionally "modified only"), read Advanced props, write back.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DECKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../decks');
const { chromium } = createRequire(path.join(DECKS, 'package.json'))('playwright');

export const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const PLAYGROUND = 'https://aehrc.github.io/qh-connectathon/smart-forms/playground';

export async function start() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const requests = [];
  page.on('request', (r) => { if (r.url().startsWith(OPEN)) requests.push(`${r.method()} ${r.url()}`); });
  return { browser, page, requests };
}

export async function shot(page, dir, name, opts = {}) {
  const out = path.join(dir, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, ...opts });
  console.log(`shot ${name}`);
}

export async function settle(page) {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(1000);
}

export async function setPatient(page, patientName, patientId) {
  await page.goto(PLAYGROUND, { waitUntil: 'networkidle' });
  await page.locator('[data-test="launch-settings-button-playground"]').click();
  const dlg = page.locator('[role=dialog]');
  // Second time round (same browser) the server is already saved: leave it
  const url = dlg.locator('input').first();
  await url.waitFor();
  await page.waitForTimeout(1000);
  if ((await url.inputValue()) !== OPEN) {
    await url.fill(OPEN);
    await page.locator('[data-test="validate-url-button-playground"]').first().click();
    await dlg.getByText('URL validated').waitFor();
    await page.locator('[data-test="set-fhir-server-button-playground"]').click();
  }
  await dlg.locator('[role=combobox]').first().click();
  const opt = page.getByRole('option', { name: patientName });
  await opt.scrollIntoViewIfNeeded();
  await opt.click();
  await dlg.getByText(patientId).waitFor();
  await page.getByRole('listbox').waitFor({ state: 'detached' }).catch(() => {});
  await page.waitForTimeout(500);
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
}

export async function buildForm(page, id) {
  const picker = page.locator('.MuiAutocomplete-input');
  await picker.click();
  await picker.fill(id);
  await page.getByRole('option', { name: id, exact: true }).click();
  await page.getByText('Resolvable URL').waitFor();
  await page.getByRole('button', { name: 'Build form' }).first().click();
  await page.waitForTimeout(2500);
}

export async function prepopulate(page) {
  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  await page.waitForTimeout(5000);
  await settle(page);
}

export async function advancedJson(page, tab, heading) {
  await page.getByRole('button', { name: 'Advanced props' }).click().catch(() => {});
  await page.getByRole('button', { name: tab, exact: true }).last().click();
  const h = page.getByRole('heading', { name: heading });
  await h.waitFor();
  await page.waitForTimeout(500);
  return JSON.parse(await h.locator('xpath=following::pre[1]').innerText());
}

export async function showEditor(page) {
  await page.getByRole('button', { name: 'Show editor' }).click().catch(() => {});
}

export async function extract(page, modifiedOnly = false) {
  await page.getByRole('button', { name: 'Extract', exact: true }).first().click();
  const name = modifiedOnly ? /^Template-based \$extract \(modified only\)/ : /^Template-based \$extract \[/;
  await page.getByRole('menuitem', { name }).click();
  await page.getByText(/Successful template-based extraction|No changes|nothing/i).first().waitFor().catch(() => {});
  await page.waitForTimeout(1500);
  await settle(page);
}

export async function writeBack(page, dir, shotName) {
  await page.getByRole('button', { name: 'Review write back items' }).click();
  await page.locator('[role=dialog]').getByText('Select items to write back').waitFor();
  await page.waitForTimeout(800);
  if (dir && shotName) await shot(page, dir, shotName);
  const btn = page.getByRole('button', { name: /Write back \(\d+ entr/i });
  const label = await btn.innerText();
  await btn.click();
  const msg = await page.getByText(/Write back to .*(successful|failed)|error/i).first().innerText({ timeout: 30000 }).catch((e) => `no message: ${e.message}`);
  await settle(page);
  return { label, msg };
}

export const qrAnswers = (qr) => {
  const out = {};
  (function walk(items) {
    for (const i of items || []) {
      if (i.answer) (out[i.linkId] ??= []).push(...i.answer.map((a) => { const k = Object.keys(a).find((x) => x.startsWith('value')); return k ? a[k] : undefined; }));
      walk(i.item);
      for (const a of i.answer || []) walk(a.item);
    }
  })(qr.item);
  return out;
};

let failures = 0;
export const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};
export const failed = () => failures;
