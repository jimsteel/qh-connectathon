#!/usr/bin/env node
// Verify A11: every FHIRPath expression in the patient form and the nurse-side module, with fhirpath.js (R4).
//
//   node solutions/A11-pre-admission/verify.mjs [base] [--offline]     (from T/)
//
// Live (default): reads Patient/soln-A11-patient-1 and runs the nurse module's x-fhir-query on Meld
// (load test-data.json first). --offline: uses the resources in test-data.json instead.
// Also checks the nurse module against edge cases built in memory: a newer response to a different
// Questionnaire (must be ignored), an older A11 response (the latest wins), and no response at all.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(HERE, '../../decks/package.json'));
const fhirpath = req('fhirpath');
const r4 = req('fhirpath/fhir-context/r4');
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const BASE = (args.find((a) => !a.startsWith('--')) || 'https://gw.interop.community/QHConnectathon2026/open').replace(/\/$/, '');
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));

let failures = 0, checks = 0;
function check(id, actual, expected) {
  checks++;
  if (isDeepStrictEqual(actual, expected)) console.log(`PASS ${id}  ${String(JSON.stringify(actual)).slice(0, 140)}`);
  else { failures++; console.log(`FAIL ${id}\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`); }
}
const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v) && !('system' in v || 'code' in v) ? String(v) : v);
const fp = (expr, env) => fhirpath.evaluate({}, expr, env, r4).map(norm);
function walk(items, fn) { for (const it of items || []) { fn(it); walk(it.item, fn); } }
const initials = (q) => { const o = {}; walk(q.item, (it) => { const e = (it.extension || []).find((x) => x.url.endsWith('initialExpression')); if (e) o[it.linkId] = e.valueExpression.expression; }); return o; };
async function get(path) {
  const res = await fetch(`${BASE}/${path.replace(/\|/g, '%7C')}`, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

const PA = load('A11-pre-admission.json');
const NURSE = load('A11-nurse-import.json');
const NURSE_SA = load('A11-nurse-standalone.json');
const DATA = load('test-data.json').entry.map((e) => e.resource);

// --- structure ---------------------------------------------------------------------------------
{
  const ids = []; walk(PA.item, (it) => ids.push(it.linkId));
  check('pre-admission: id/url/version', [PA.id, PA.url, PA.version],
    ['soln-A11-pre-admission', 'https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/A11-pre-admission', '0.2.0']);
  check('pre-admission: linkIds pam- and unique', [ids.every((l) => l.startsWith('pam-')), new Set(ids).size === ids.length], [true, true]);
  // every enableWhen points at an earlier question, with an answer the question can have
  const byId = {}; walk(PA.item, (it) => { byId[it.linkId] = it; });
  const bad = [];
  for (const q of [PA, NURSE]) walk(q.item, (it) => (it.enableWhen || []).forEach((w) => {
    const src = q === PA ? byId[w.question] : (() => { let x; walk(q.item, (i) => { if (i.linkId === w.question) x = i; }); return x; })();
    if (!src) bad.push(`${it.linkId}: no ${w.question}`);
    else if (w.answerCoding && !(src.answerOption || []).some((o) => o.valueCoding.code === w.answerCoding.code && o.valueCoding.system === w.answerCoding.system)) bad.push(`${it.linkId}: ${w.answerCoding.code}`);
  }));
  check('enableWhen targets and answers exist', bad, []);
  // the nurse module only reads linkIds that exist in the patient form, and uses the same answer codes
  const read = []; walk(NURSE.item, (it) => { const e = initials({ item: [it] })[it.linkId]; for (const m of (e || '').matchAll(/linkId = '([^']+)'/g)) read.push(m[1]); });
  check('nurse module reads existing A11 linkIds', read.filter((l) => !byId[l]), []);
  const optsOf = (it) => (it.answerOption || []).map((o) => `${o.valueCoding.system}|${o.valueCoding.code}`).join();
  const pairs = [['pam-pr-transfusion-accept', 'pam-pa-transfusion-accept'], ['pam-pr-products', 'pam-pa-products'],
    ['pam-pr-diet', 'pam-pa-diet-type'], ['pam-pr-iron-infusion', 'pam-pa-iron-infusion'], ['pam-pr-talk', 'pam-pa-talk']];
  const nById = {}; walk(NURSE.item, (it) => { nById[it.linkId] = it; });
  check('nurse answer options match the patient form', pairs.filter(([n, p]) => optsOf(nById[n]) !== optsOf(byId[p])), []);
  check('standalone = module minus assemble-child', JSON.stringify(NURSE_SA.item), JSON.stringify(NURSE.item));
}

// --- patient form: demographics pre-population --------------------------------------------------
const patient = OFFLINE ? DATA.find((r) => r.resourceType === 'Patient') : await get('Patient/soln-A11-patient-1');
const expectPA = {
  'pam-pa-name': ['Grace Preadmit-A11'], 'pam-pa-dob': ['1966-03-02'], 'pam-pa-sex': ['female'],
  'pam-pa-medicare': ['0000000111'], 'pam-pa-phone': ['0400 000 111'],
  'pam-pa-address': ['12 Example Street, Kedron QLD 4031'], 'pam-pa-language': ['English'], 'pam-pa-interpreter': [false],
};
for (const [l, x] of Object.entries(initials(PA))) check(`patient form init ${l}`, fp(x, { patient }), expectPA[l]);
check('patient form: all initialExpressions covered', Object.keys(initials(PA)).sort(), Object.keys(expectPA).sort());
// a sparser Patient (no address line, no mobile, no communication) still gives sensible values
{
  const sparse = { resourceType: 'Patient', name: [{ given: ['Al'], family: 'Sparse' }], gender: 'male',
    telecom: [{ system: 'phone', value: '07 0000 0000', use: 'home' }], address: [{ city: 'Aspley', state: 'QLD', postalCode: '4034' }] };
  const i = initials(PA);
  check('sparse patient: name, phone, address, language',
    ['pam-pa-name', 'pam-pa-phone', 'pam-pa-address', 'pam-pa-language'].map((l) => fp(i[l], { patient: sparse })),
    [['Al Sparse'], ['07 0000 0000'], ['Aspley QLD 4034'], []]);
}

// --- nurse module: x-fhir-query + FHIRPath over the latest A11 response -------------------------
const qExpr = NURSE.item[0].extension.find((e) => e.valueExpression.name === 'paResponse').valueExpression.expression;
const storedQR = DATA.find((r) => r.resourceType === 'QuestionnaireResponse');
const paResponse = OFFLINE
  ? { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: storedQR }] }
  : await get(qExpr.replace('{{%patient.id}}', 'soln-A11-patient-1'));
check('nurse query returns the stored response', paResponse.entry?.map((e) => e.resource.id), ['soln-A11-qr-1']);
const expectNurse = {
  'pam-pr-source': ['Completed 2026-10-28 (QuestionnaireResponse/soln-A11-qr-1)'],
  'pam-pr-transfusion-accept': [{ system: 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/transfusion-preference', code: 'some', display: 'Only some blood products' }],
  'pam-pr-products': [{ system: 'http://snomed.info/sct', code: '116788004', display: 'Albumin' },
    { system: 'http://snomed.info/sct', code: '233568002', display: 'Cell salvage (your own blood, collected during the operation and given back)' }],
  'pam-pr-directive': [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0136', code: 'Y', display: 'Yes' }],
  'pam-pr-transfusion-reaction': [], // not asked: never transfused
  'pam-pr-iron-infusion': [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0136', code: 'N', display: 'No' }],
  'pam-pr-blood-thinners': ['Yes: Aspirin 100 mg daily'],
  'pam-pr-diet': [{ system: 'http://snomed.info/sct', code: '765021002', display: 'Vegetarian (no meat or fish)' }],
  'pam-pr-talk': [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0136', code: 'Y', display: 'Yes' }],
};
const ni = initials(NURSE);
for (const [l, x] of Object.entries(ni)) check(`nurse init ${l}`, fp(x, { patient, paResponse }), expectNurse[l]);
check('nurse: all initialExpressions covered', Object.keys(ni).sort(), Object.keys(expectNurse).sort());

// edge cases (in memory)
{
  const other = { resourceType: 'QuestionnaireResponse', id: 'other', status: 'completed', authored: '2026-10-29T08:00:00+10:00',
    questionnaire: 'https://example.org/Questionnaire/something-else|1.0', item: [{ linkId: 'pam-pa-transfusion-accept', answer: [{ valueCoding: { code: 'accept' } }] }] };
  const older = structuredClone(storedQR); older.id = 'older'; older.authored = '2026-09-01T09:00:00+10:00';
  walk(older.item, (it) => { if (it.linkId === 'pam-pa-transfusion-accept') it.answer = [{ valueCoding: { code: 'refuse' } }]; });
  // the search is sorted newest first, so the bundle is: other (newest), stored, older
  const mixed = { resourceType: 'Bundle', entry: [other, storedQR, older].map((resource) => ({ resource })) };
  check('edge: newer response to another form ignored; latest A11 wins',
    fp(ni['pam-pr-transfusion-accept'], { patient, paResponse: mixed }).map((c) => c.code), ['some']);
  const empty = { resourceType: 'Bundle', type: 'searchset', total: 0 };
  check('edge: no response -> every nurse item empty',
    Object.values(ni).flatMap((x) => fp(x, { patient, paResponse: empty })), []);
  const neverThinners = structuredClone(storedQR);
  walk(neverThinners.item, (it) => { if (it.linkId === 'pam-pa-blood-thinners') it.answer = [{ valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/v2-0136', code: 'N', display: 'No' } }]; });
  check('edge: blood thinners "No"', fp(ni['pam-pr-blood-thinners'], { patient, paResponse: { resourceType: 'Bundle', entry: [{ resource: neverThinners }] } }), ['No']);
}
if (!OFFLINE) {
  // Meld matches questionnaire= on the exact stored string (url|version), not on the url alone.
  const url = PA.url;
  const byUrl = await get(`QuestionnaireResponse?subject=Patient/soln-A11-patient-1&questionnaire=${url}`);
  const byUrlVersion = await get(`QuestionnaireResponse?subject=Patient/soln-A11-patient-1&questionnaire=${url}|${PA.version}`);
  check('Meld: questionnaire=<url> / <url>|<version> matches', [byUrl.total ?? byUrl.entry?.length ?? 0, byUrlVersion.total ?? byUrlVersion.entry?.length], [0, 1]);
}

console.log(failures ? `\n${failures} failure(s) of ${checks}` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
