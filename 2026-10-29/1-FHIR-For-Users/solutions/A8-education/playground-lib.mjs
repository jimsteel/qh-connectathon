// Copied from solutions/A5-pathology/playground-lib.mjs (same pattern as decks/tools/shoot-smart-forms-playground.mjs).
// Drive the patched Smart Forms playground (https://aehrc.github.io/qh-connectathon/smart-forms/)
// headless: set the source FHIR server + patient, pick a form, pre-populate, read the QR / extract result.
// Pattern from decks/tools/shoot-smart-forms-playground.mjs. Uses playwright from decks/node_modules
// (cd ../../decks && npm install, if it isn't there).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DECKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../decks');
export const requireFromDecks = createRequire(path.join(DECKS, 'package.json'));
const { chromium } = requireFromDecks('playwright');

export const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const PLAYGROUND = 'https://aehrc.github.io/qh-connectathon/smart-forms/playground';

export async function start() {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { browser, page };
}

export async function shot(page, dir, name, opts = {}) {
  const out = path.join(dir, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, ...opts });
  console.log(`shot ${out} ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

export async function settle(page) {
  for (const x of await page.locator('.notistack-SnackbarContainer button').all()) await x.click().catch(() => {});
  await page.waitForTimeout(1200);
}

export async function setPatient(page, patientName, patientId) {
  await page.goto(PLAYGROUND, { waitUntil: 'networkidle' });
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
  await page.waitForTimeout(2000);
}

export async function prepopulate(page, waitSelector) {
  await page.getByRole('button', { name: 'Populate' }).click();
  await page.getByRole('menuitem', { name: /Pre-populate/ }).click();
  if (waitSelector) await page.waitForFunction((s) => document.querySelector(s)?.value, waitSelector);
  await page.waitForTimeout(2500);
  await settle(page);
}

// Read a JSON panel of Advanced props (tab "QR", "Extract", ...): returns the parsed JSON shown
// under the given heading, via the page's text.
export async function advancedJson(page, tab = 'QR', heading = 'updatableResponse') {
  await page.getByRole('button', { name: 'Advanced props' }).click().catch(() => {});
  await page.getByRole('button', { name: tab, exact: true }).last().click();
  const h = page.getByRole('heading', { name: heading });
  await h.waitFor();
  await page.waitForTimeout(500);
  const text = await h.locator('xpath=following::pre[1]').innerText();
  return JSON.parse(text);
}

export async function extract(page) {
  await page.getByRole('button', { name: 'Extract', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Template-based \$extract \[/ }).click();
  await page.getByText('Successful template-based extraction').waitFor();
  await settle(page);
}

export async function writeBack(page) {
  await page.getByRole('button', { name: 'Review write back items' }).click();
  await page.locator('[role=dialog]').getByText('Select items to write back').waitFor();
  await page.waitForTimeout(800);
  const btn = page.getByRole('button', { name: /Write back \(\d+ entr/i });
  const label = await btn.innerText();
  await btn.click();
  await page.getByText(/Write back to .* successful/).first().waitFor();
  await settle(page);
  return label;
}

// linkId -> [answer values] (primitive value, or the Coding / Quantity object), in document order.
export const qrAnswers = (qr) => {
  const out = {};
  (function walk(items) {
    for (const i of items || []) {
      for (const a of i.answer || []) {
        const k = Object.keys(a).find((x) => x.startsWith('value'));
        if (k) (out[i.linkId] ??= []).push(a[k]);
        walk(a.item);
      }
      walk(i.item);
    }
  })(qr.item);
  return out;
};

// Scroll the form pane (left) so the element is at the top, for screenshots of long forms.
export async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(600);
}
