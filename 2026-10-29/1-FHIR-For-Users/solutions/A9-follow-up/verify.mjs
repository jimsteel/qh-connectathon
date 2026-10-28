#!/usr/bin/env node
// Verify the A9 Follow-up + Status forms: every FHIRPath expression, against live data on Meld.
//
//   node solutions/A9-follow-up/verify.mjs [base]          (from T/; default base: Meld open endpoint)
//   EXTRACT_DIR=<dir with node_modules/@aehrc/sdc-template-extract> node .../verify.mjs
//
// 1. Runs each x-fhir-query (fuEpisode, fuReferral, fuTasks) for soln-A9-patient-1 (after
//    ./reset-test-data.sh) and for a read-only real case, pam-032.
// 2. Evaluates every initialExpression with fhirpath.js (R4 model) and compares with expected values.
// 3. Builds QuestionnaireResponses as Smart Forms would (two reviews: "still being managed" and
//    "cleared") and evaluates the calculatedExpressions (days with the team, due date) and the
//    templateExtractValue / resourceId / ifMatch / patchRequestUrl expressions.
// 4. If EXTRACT_DIR is set, runs Smart Forms' own extractor (@aehrc/sdc-template-extract inAppExtract,
//    the code behind the playground's "Template-based $extract") on those responses and checks the Bundle.
// Exits non-zero on any failure.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const requireDecks = createRequire(resolve(HERE, '../../decks/package.json'));
const fhirpath = requireDecks('fhirpath');
const r4 = requireDecks('fhirpath/fhir-context/r4');
const BASE = (process.argv[2] || 'https://gw.interop.community/QHConnectathon2026/open').replace(/\/$/, '');
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));

let failures = 0, checks = 0;
const show = (v) => String(JSON.stringify(v));
function check(id, actual, expected) {
  checks++;
  if (isDeepStrictEqual(actual, expected)) console.log(`PASS ${id}  ${show(actual).slice(0, 160)}`);
  else { failures++; console.log(`FAIL ${id}\n       expected ${show(expected)}\n       got      ${show(actual)}`); }
}
const fp = (data, expr, env, base) =>
  fhirpath.evaluate(data, base ? { base, expression: expr } : expr, env, r4);

async function get(path) {
  const url = `${BASE}/${path.replace(/\|/g, '%7C')}`;
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function walk(items, fn) { for (const it of items || []) { fn(it); walk(it.item, fn); } }
const extOf = (it, suffix) => (it.extension || []).find((e) => e.url.endsWith(suffix));

const MODULE = load('pam-follow-up.json');
const STANDALONE = load('A9-standalone.json');
const PUT = load('A9-standalone-put.json');

// --- 0. structure ------------------------------------------------------------------------------
{
  const top = MODULE.item[0];
  check('module-structure', [MODULE.id, MODULE.version, top.linkId, top.item[0].linkId,
    MODULE.extension.some((e) => e.valueCode === 'assemble-child')],
  ['soln-pam-follow-up', '0.2.0', 'pam-follow-up', 'pam-follow-up-module', true]);
  const ids = []; walk(MODULE.item, (it) => ids.push(it.linkId));
  check('linkIds-prefixed-and-unique', [ids.every((l) => l.startsWith('pam-')), new Set(ids).size === ids.length], [true, true]);
  check('standalone = module items and templates (minus assemble-child)',
    JSON.stringify([STANDALONE.item, STANDALONE.contained]) === JSON.stringify([MODULE.item, MODULE.contained]), true);
  // Every contained template is referenced by exactly one templateExtract, and vice versa.
  for (const q of [MODULE, STANDALONE, PUT]) {
    const refs = []; walk(q.item, (it) => (it.extension || []).filter((e) => e.url.endsWith('templateExtract'))
      .forEach((e) => refs.push(e.extension.find((x) => x.url === 'template').valueReference.reference.slice(1))));
    check(`${q.id}-templates-wired`, refs.sort(), q.contained.map((c) => c.id).sort());
  }
}

// --- 1. queries ---------------------------------------------------------------------------------
const varsOf = (q) => q.item[0].extension.filter((e) => e.valueExpression?.language === 'application/x-fhir-query')
  .map((e) => e.valueExpression);
async function prepopEnv(patientId) {
  const patient = await get(`Patient/${patientId}`);
  const env = { patient };
  for (const v of varsOf(MODULE)) env[v.name] = await get(v.expression.replace('{{%patient.id}}', patientId));
  return env;
}
const env = await prepopEnv('soln-A9-patient-1');
check('query-fuEpisode', env.fuEpisode.entry?.map((e) => e.resource.id), ['soln-A9-episode-1']);
check('query-fuReferral', env.fuReferral.entry?.map((e) => e.resource.id), ['soln-A9-referral-1']);
check('query-fuTasks (oldest first)', env.fuTasks.entry?.map((e) => e.resource.id).slice(0, 2), ['soln-A9-task-1', 'soln-A9-task-2']);
const realEnv = await prepopEnv('pam-032'); // read only
check('query-fuEpisode pam-032', realEnv.fuEpisode.entry?.map((e) => e.resource.id), ['pam-032-episode']);
check('query-fuTasks pam-032', realEnv.fuTasks.entry?.map((e) => e.resource.id), ['pam-032-follow-up']);

// --- 2. initialExpressions -------------------------------------------------------------------------
const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const version = env.fuEpisode.entry[0].resource.meta.versionId;
const expectedInit = {
  'pam-fu-episode-id': ['soln-A9-episode-1'],
  'pam-fu-care-manager': ['Practitioner/pam-nurse-2'],
  'pam-fu-open-task-id': ['soln-A9-task-2'],
  'pam-fu-referral-date': ['2026-09-01'],
  'pam-fu-current-status': ['active'],
  'pam-fu-open-task-due': ['2026-10-08'],
  'pam-fu-previous-notes': ['2026-09-04: Hb 104 g/L, ferritin 18 ug/L: iron deficiency anaemia. Ferric carboxymaltose 1000 mg booked for 10/09.\n'
    + '2026-09-10: Infusion given 10/09, no reaction. Repeat FBC and iron studies in 4 weeks.'],
  'pam-fu-review-date': [TODAY],
  'pam-fu-status': ['active'],
  'pam-fu-weeks': [4],
  // PUT variant only
  'pam-fu-episode-version': [version],
  'pam-fu-episode-start': ['2026-09-01'],
  'pam-fu-episode-end': [],
  'pam-fu-episode-org': ['Organization/pam-blood-management'],
  'pam-fu-episode-referral': ['ServiceRequest/soln-A9-referral-1'],
};
const seen = new Set();
for (const q of [MODULE, PUT]) {
  walk(q.item, (it) => {
    const e = extOf(it, 'initialExpression');
    if (!e || seen.has(it.linkId)) return;
    seen.add(it.linkId);
    const got = fp({}, e.valueExpression.expression, env).map((v) => (typeof v === 'object' ? String(v) : v));
    check(`init ${it.linkId}`, got, expectedInit[it.linkId]);
  });
}
check('all initialExpressions covered', [...seen].sort(), Object.keys(expectedInit).sort());
// On a real active case the same expressions give sensible values (read only).
check('init on pam-032: status, open task, referral date',
  ['pam-fu-current-status', 'pam-fu-open-task-id', 'pam-fu-referral-date'].map((l) => {
    let x; walk(MODULE.item, (it) => { if (it.linkId === l) x = extOf(it, 'initialExpression').valueExpression.expression; });
    return fp({}, x, realEnv).map(String)[0];
  }), ['active', 'pam-032-follow-up', '2026-09-13']);

// --- 3. responses as Smart Forms builds them, calculated expressions, template expressions ---------
const ans = (v) => [typeof v === 'number' ? (Number.isInteger(v) ? { valueInteger: v } : { valueDecimal: v })
  : typeof v === 'object' ? { valueCoding: v } : /^\d{4}-\d\d-\d\d$/.test(v) ? { valueDate: v } : { valueString: v }];
const EOC = 'http://hl7.org/fhir/episode-of-care-status';
function buildQR(q, review) {
  const vals = {
    'pam-follow-up-module': 'pam-follow-up|0.2.0',
    'pam-fu-episode-id': 'soln-A9-episode-1', 'pam-fu-care-manager': 'Practitioner/pam-nurse-2',
    'pam-fu-open-task-id': 'soln-A9-task-2',
    'pam-fu-episode-version': version, 'pam-fu-episode-start': '2026-09-01',
    'pam-fu-episode-org': 'Organization/pam-blood-management', 'pam-fu-episode-referral': 'ServiceRequest/soln-A9-referral-1',
    'pam-fu-referral-date': '2026-09-01',
    'pam-fu-current-status': { system: EOC, code: 'active', display: 'Being managed' },
    'pam-fu-open-task-due': '2026-10-08',
    'pam-fu-review-date': '2026-10-28',
    'pam-fu-status': review === 'cleared' ? { system: EOC, code: 'finished', display: 'Cleared' }
      : { system: EOC, code: 'active', display: 'Being managed' },
    'pam-fu-days': 0, 'pam-fu-due': '2000-01-01', // placeholders, overwritten by calculate()
    'pam-fu-task-type': 'Follow up post-treatment bloods', 'pam-fu-weeks': 6, 'pam-fu-note': 'Hb 118 today. Recheck in 6 weeks.',
  };
  const toQR = (items) => items.flatMap((it) => {
    if (it.type === 'group') {
      if (it.linkId === 'pam-fu-next' && review === 'cleared') return []; // disabled by enableWhen
      const kids = toQR(it.item); return kids.length ? [{ linkId: it.linkId, text: it.text, item: kids }] : [];
    }
    return it.linkId in vals ? [{ linkId: it.linkId, text: it.text, answer: ans(vals[it.linkId]) }] : [];
  });
  return { resourceType: 'QuestionnaireResponse', status: 'completed', questionnaire: `${q.url}|${q.version}`,
    subject: { reference: 'Patient/soln-A9-patient-1' }, authored: '2026-10-28T10:00:00+10:00', item: toQR(q.item) };
}
// calculatedExpressions: evaluate, write the answer back into the QR (as the renderer does)
function calculate(q, qr) {
  const calcs = {}; walk(q.item, (it) => { const e = extOf(it, 'calculatedExpression'); if (e) calcs[it.linkId] = e.valueExpression.expression; });
  const out = {};
  for (const [l, x] of Object.entries(calcs)) {
    const v = fp(qr, x, { resource: qr, rootResource: qr }).map(String);
    out[l] = v;
    walk(qr.item, (qi) => { if (qi.linkId === l) qi.answer = v.length ? ans(/^\d+$/.test(v[0]) ? +v[0] : v[0]) : undefined; });
  }
  return out;
}
const managedQR = buildQR(MODULE, 'managed');
const clearedQR = buildQR(MODULE, 'cleared');
check('calc managed: days, due (review 28/10 + 6 weeks)', calculate(MODULE, managedQR), { 'pam-fu-days': ['57'], 'pam-fu-due': ['2026-12-09'] });
check('calc cleared: days; due not shown', calculate(MODULE, clearedQR), { 'pam-fu-days': ['57'], 'pam-fu-due': [] });
// days formula across a year end and a leap day
{
  let daysExpr; walk(MODULE.item, (it) => { if (it.linkId === 'pam-fu-days') daysExpr = extOf(it, 'calculatedExpression').valueExpression.expression; });
  const qrWith = (a, b) => ({ resourceType: 'QuestionnaireResponse', status: 'completed', item: [
    { linkId: 'pam-fu-referral-date', answer: [{ valueDate: a }] }, { linkId: 'pam-fu-review-date', answer: [{ valueDate: b }] }] });
  for (const [a, b, d] of [['2025-12-20', '2026-01-10', 21], ['2024-02-20', '2024-03-05', 14], ['2025-07-01', '2026-10-06', 462], ['2026-10-28', '2026-10-28', 0]]) {
    const r = qrWith(a, b); check(`days ${a} -> ${b}`, fp(r, daysExpr, { resource: r }), [d]);
  }
}

// --- 4. Smart Forms' extractor (optional) --------------------------------------------------------
if (process.env.EXTRACT_DIR) {
  const { inAppExtract } = createRequire(join(resolve(process.env.EXTRACT_DIR), 'x.js'))('@aehrc/sdc-template-extract');
  async function extract(q, qr) {
    const out = await inAppExtract(structuredClone(qr), q, null);
    if (!out.extractSuccess) throw new Error(JSON.stringify(out.extractResult).slice(0, 500));
    return out.extractResult.extractedBundle;
  }
  const summary = (b) => b.entry.map((e) => `${e.request.method} ${e.request.url}`).sort();

  const bManaged = await extract(MODULE, managedQR);
  check('extract managed: entries', summary(bManaged), ['PATCH Task/soln-A9-task-2', 'POST Task']);
  const task = bManaged.entry.find((e) => e.request.method === 'POST').resource;
  check('extract managed: new Task', {
    status: task.status, code: task.code.coding[0].code, text: task.code.text, description: task.description,
    for: task.for.reference, focus: task.focus.reference, owner: task.owner.reference,
    due: task.restriction.period.end, note: task.note[0].text, noteTimeSet: /^\d{4}-\d\d-\d\dT/.test(task.note[0].time),
  }, { status: 'requested', code: 'follow-up', text: 'Follow up post-treatment bloods', description: 'Follow up post-treatment bloods',
    for: 'Patient/soln-A9-patient-1', focus: 'EpisodeOfCare/soln-A9-episode-1', owner: 'Practitioner/pam-nurse-2',
    due: '2026-12-09', note: 'Hb 118 today. Recheck in 6 weeks.', noteTimeSet: true });
  check('extract managed: previous Task completed', bManaged.entry.find((e) => e.request.url === 'Task/soln-A9-task-2').resource.parameter,
    [{ name: 'operation', part: [{ name: 'type', valueCode: 'replace' }, { name: 'path', valueString: 'Task.status' }, { name: 'value', valueCode: 'completed' }] }]);

  const bCleared = await extract(MODULE, clearedQR);
  check('extract cleared: entries', summary(bCleared), ['PATCH EpisodeOfCare/soln-A9-episode-1', 'PATCH Task/soln-A9-task-2']);
  check('extract cleared: EpisodeOfCare patch',
    bCleared.entry.find((e) => e.request.url.startsWith('EpisodeOfCare')).resource.parameter,
    [{ name: 'operation', part: [{ name: 'type', valueCode: 'replace' }, { name: 'path', valueString: 'EpisodeOfCare.status' }, { name: 'value', valueCode: 'finished' }] },
      { name: 'operation', part: [{ name: 'type', valueCode: 'add' }, { name: 'path', valueString: 'EpisodeOfCare.period' }, { name: 'name', valueString: 'end' }, { name: 'value', valueDateTime: '2026-10-28' }] }]);

  const putQR = buildQR(PUT, 'cleared'); calculate(PUT, putQR);
  const bPut = await extract(PUT, putQR);
  check('extract PUT variant: entries', summary(bPut), ['PATCH Task/soln-A9-task-2', 'PUT EpisodeOfCare/soln-A9-episode-1']);
  const putEntry = bPut.entry.find((e) => e.request.method === 'PUT');
  const { meta, ...eoc } = putEntry.resource; // eslint-disable-line no-unused-vars
  // The form asks for ifMatch W/"<versionId>" (optimistic locking), but sdc-template-extract 1.0.16 drops
  // it: buildBundle.ts getOptionalBundleEntryRequestProperty() keeps a result only if result[0].id is a
  // string, which a string never has. Known Smart Forms bug; this check documents the current behaviour.
  check('extract PUT variant: ifMatch dropped by Smart Forms (known bug)', putEntry.request.ifMatch, undefined);
  { let x; walk(PUT.item, (it) => { const te = extOf(it, 'templateExtract'); const im = te?.extension.find((e) => e.url === 'ifMatch'); if (im) x = im.valueString; });
    check('PUT variant: ifMatch expression itself', fp(putQR, x, { resource: putQR }), [`W/"${version}"`]); }
  check('extract PUT variant: EpisodeOfCare', eoc, {
    resourceType: 'EpisodeOfCare', id: 'soln-A9-episode-1', status: 'finished',
    type: [{ coding: [{ system: 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/episode-type', code: 'pam', display: 'Preoperative anaemia management' }], text: 'Preoperative anaemia management' }],
    patient: { reference: 'Patient/soln-A9-patient-1' }, managingOrganization: { reference: 'Organization/pam-blood-management' },
    period: { start: '2026-09-01', end: '2026-10-28' }, referralRequest: [{ reference: 'ServiceRequest/soln-A9-referral-1' }],
    careManager: { reference: 'Practitioner/pam-nurse-2' } });
  // A review that changes nothing about the status writes no EpisodeOfCare entry.
  const noChange = buildQR(MODULE, 'managed'); calculate(MODULE, noChange);
  check('extract managed: no EpisodeOfCare write when status unchanged',
    (await extract(MODULE, noChange)).entry.some((e) => e.request.url.startsWith('EpisodeOfCare')), false);
} else {
  console.log('SKIP extraction checks (set EXTRACT_DIR to a folder with @aehrc/sdc-template-extract installed)');
}

console.log(failures ? `\n${failures} failure(s) of ${checks}` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
