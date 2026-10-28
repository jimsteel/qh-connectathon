#!/usr/bin/env node
// Verify every FHIRPath expression in the A3 solution with fhirpath.js (R4 model).
//
//   cd ../../decks && node ../solutions/A3-proposed-surgery/verify.mjs [base]
//   (or NODE_PATH=../../decks/node_modules node verify.mjs)
//
// 1. Runs the module's x-fhir-queries against Meld for the test patient soln-A3-patient-1
//    (| -> %7C) and evaluates every initialExpression against the results.
// 2. Evaluates the days-until-surgery calculatedExpression for many dates (vs a JS date diff).
// 3. Evaluates the root variable and every templateExtractValue against a sample response.
// 4. Checks that no expression in the Questionnaire was left unverified.
// 5. Expands the ECL answerValueSet on Ontoserver and checks the prepopulated code is a member.
// Prints PASS/FAIL per check; exits non-zero on any failure.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '../../decks/package.json'));
const fhirpath = require('fhirpath');
const r4 = require('fhirpath/fhir-context/r4');

const BASE = (process.argv[2] || 'https://gw.interop.community/QHConnectathon2026/open').replace(/\/$/, '');
const TX = 'https://r4.ontoserver.csiro.au/fhir';
const PATIENT_ID = 'soln-A3-patient-1';
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const Q = load('soln-pam-proposed-surgery.json');
const STANDALONE = load('soln-A3-standalone.json');

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function check(id, actual, expected) {
  checks++;
  if (isDeepStrictEqual(actual, expected)) console.log(`PASS ${id}  ${show(actual)}`);
  else { failures++; console.log(`FAIL ${id}\n       expected ${show(expected)}\n       got      ${show(actual)}`); }
}
const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
};
const ev = (base, expr, vars) => fhirpath.evaluate(base, expr, vars, r4);

// --- collect every expression in the module --------------------------------------------------
const covered = new Set();
const exprs = [];
(function walk(n, linkId) {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, linkId));
  if (!n || typeof n !== 'object') return;
  const lid = n.linkId || linkId;
  if (n.valueExpression) exprs.push({ linkId: lid, url: n.url, ...n.valueExpression });
  if (n.url?.endsWith('templateExtractValue')) exprs.push({ linkId: lid, url: n.url, expression: n.valueString });
  Object.values(n).forEach((x) => walk(x, lid));
})(Q);
const byLink = (linkId, kind) => {
  const e = exprs.find((x) => x.linkId === linkId && x.url.endsWith(kind));
  if (!e) throw new Error(`no ${kind} on ${linkId}`);
  covered.add(e); return e.expression;
};

// --- 1. pre-population -----------------------------------------------------------------------
const patient = await getJson(`${BASE}/Patient/${PATIENT_ID}`);
const vars = { patient };
for (const e of exprs.filter((x) => x.language === 'application/x-fhir-query')) {
  covered.add(e);
  const q = e.expression.replace('{{%patient.id}}', PATIENT_ID).replace(/\|/g, '%7C');
  vars[e.name] = await getJson(`${BASE}/${q}`);
  check(`query ${e.name}`, (vars[e.name].entry || []).map((x) => `${x.resource.resourceType}/${x.resource.id}`).sort(),
    e.name === 'waitlist'
      ? ['Organization/pam-unit-orthopaedics', 'Practitioner/pam-surgeon-orthopaedics', `ServiceRequest/${PATIENT_ID}-surgery`]
      : (vars[e.name].entry || []).map((x) => `${x.resource.resourceType}/${x.resource.id}`).sort());
}
// bmsReferral: whatever the server has now must be a referral of this patient (code 3457005)
check('bmsReferral is a referral (or none)',
  (vars.bmsReferral.entry || []).every((x) => x.resource.code.coding.some((c) => c.code === '3457005')), true);

const init = (linkId) => ev({}, byLink(linkId, 'initialExpression'), vars);
check('pam-surgery-waitlist-ref', init('pam-surgery-waitlist-ref'), [`ServiceRequest/${PATIENT_ID}-surgery`]);
check('pam-surgery-surgeon-ref', init('pam-surgery-surgeon-ref'), ['Practitioner/pam-surgeon-orthopaedics']);
check('pam-surgery-unit-ref', init('pam-surgery-unit-ref'), ['Organization/pam-unit-orthopaedics']);
check('pam-surgery-procedure', init('pam-surgery-procedure'),
  [{ system: 'http://snomed.info/sct', code: '52734007', display: 'Total hip replacement' }]);
check('pam-surgery-surgeon', init('pam-surgery-surgeon'), ['Dr Alan Pierce']);
check('pam-surgery-unit', init('pam-surgery-unit'), ['Orthopaedics (synthetic)']);
check('pam-surgery-category', init('pam-surgery-category'),
  [{ system: 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/elective-category', code: '2', display: 'Category 2' }]);
check('pam-surgery-date', init('pam-surgery-date'), ['2026-11-18']);
const refExpected = (vars.bmsReferral.entry || []).map((x) => x.resource.authoredOn.slice(0, 10));
check('pam-surgery-existing-referral', init('pam-surgery-existing-referral'), refExpected);
check('pam-referral-date (today)', init('pam-referral-date').map(String), [new Date().toLocaleDateString('sv-SE')]);

// Same expressions against a synthetic pam-* patient's real data (read-only), to show they generalise
{
  const v2 = { patient: await getJson(`${BASE}/Patient/pam-001`) };
  const wq = exprs.find((x) => x.name === 'waitlist').expression.replace('{{%patient.id}}', 'pam-001').replace(/\|/g, '%7C');
  v2.waitlist = await getJson(`${BASE}/${wq}`);
  check('pam-001 surgeon', ev({}, byLink('pam-surgery-surgeon', 'initialExpression'), v2), ['Dr Alan Pierce']);
  check('pam-001 procedure', ev({}, byLink('pam-surgery-procedure', 'initialExpression'), v2).map((c) => c.code), ['609588000']);
  check('pam-001 date', ev({}, byLink('pam-surgery-date', 'initialExpression'), v2), ['2025-10-21']);
}

// --- 2. days until surgery -------------------------------------------------------------------
const daysExpr = byLink('pam-surgery-days', 'calculatedExpression');
const jsDays = (a, b) => Math.round((Date.UTC(...a.split('-').map((x, i) => +x - (i === 1 ? 1 : 0))) -
  Date.UTC(...b.split('-').map((x, i) => +x - (i === 1 ? 1 : 0)))) / 86400000);
const todayStr = new Date().toLocaleDateString('sv-SE');
const dates = ['2026-11-18', '2026-10-28', '2027-01-01', '2028-03-01', '2028-02-29', '2025-10-21', '2030-12-31', todayStr];
for (const d of dates) {
  const got = ev({}, daysExpr, { surgeryDate: d });
  check(`days until ${d}`, got, [jsDays(d, todayStr)]);
}
// with a FHIR date typed answer (as in a QuestionnaireResponse)
check('days (no surgery date) is empty', ev({}, daysExpr, { surgeryDate: [] }), []);
// day-number function itself, across leap years and month ends, against JS
{
  const pairs = [['2024-03-01', '2024-02-28'], ['2023-03-01', '2023-02-28'], ['2100-03-01', '2100-02-28'],
    ['2000-03-01', '2000-02-28'], ['2027-01-01', '2026-12-31']];
  const diffExpr = daysExpr.replace('today().toString()', '%other');
  for (const [a, b] of pairs) check(`date diff ${a} - ${b}`, ev({}, diffExpr, { surgeryDate: a, other: b }), [jsDays(a, b)]);
}

// --- 3. root variable + template extraction on a sample response ----------------------------
const qr = {
  resourceType: 'QuestionnaireResponse', status: 'in-progress',
  subject: { reference: `Patient/${PATIENT_ID}` },
  item: [{ linkId: 'pam-surgery', item: [
    { linkId: 'pam-surgery-waitlist-ref', answer: [{ valueString: `ServiceRequest/${PATIENT_ID}-surgery` }] },
    { linkId: 'pam-surgery-surgeon-ref', answer: [{ valueString: 'Practitioner/pam-surgeon-orthopaedics' }] },
    { linkId: 'pam-surgery-date', answer: [{ valueDate: '2026-11-18' }] },
    { linkId: 'pam-surgery-days', answer: [{ valueInteger: 21 }] },
    { linkId: 'pam-referral-make', answer: [{ valueBoolean: true }] },
    { linkId: 'pam-referral', item: [
      { linkId: 'pam-referral-date', answer: [{ valueDate: '2026-10-28' }] },
      { linkId: 'pam-referral-source', answer: [{ valueCoding: { system: 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/referral-source', code: 'preadmission', display: 'Pre-admission clinic' } }] },
      { linkId: 'pam-referral-reason', answer: [{ valueCoding: { system: 'http://snomed.info/sct', code: '87522002', display: 'Iron deficiency anaemia' } }] },
      { linkId: 'pam-referral-note', answer: [{ valueString: 'Hb 98, ferritin 12' }] },
    ] },
  ] }],
};
const rootVar = STANDALONE.extension.find((x) => x.valueExpression?.name === 'surgeryDate').valueExpression.expression;
const typedDate = ev(qr, rootVar, { resource: qr, rootResource: qr });
check('root variable surgeryDate', typedDate.map(String), ['2026-11-18']);
check('days from the typed QR date', ev({}, daysExpr, { surgeryDate: typedDate }), [jsDays('2026-11-18', todayStr)]);

const group = qr.item[0].item.find((i) => i.linkId === 'pam-referral');
const tplVal = (path) => {
  // find the templateExtractValue whose JSON path in the contained template matches
  const tpl = Q.contained.find((c) => c.id === 'PAMReferralTemplate');
  let node = tpl; for (const p of path) node = node[p];
  const expr = node.extension[0].valueString;
  const e = exprs.find((x) => x.expression === expr && x.url.endsWith('templateExtractValue')); covered.add(e);
  return ev(group, { base: 'QuestionnaireResponse.item', expression: expr }, { resource: qr, rootResource: qr });
};
check('tpl category', tplVal(['category', 0, 'coding', 0]).map((c) => c.code), ['preadmission']);
check('tpl priority (21 days -> urgent)', tplVal(['_priority']), ['urgent']);
check('tpl subject', tplVal(['subject', '_reference']), [`Patient/${PATIENT_ID}`]);
check('tpl authoredOn', tplVal(['_authoredOn']), ['2026-10-28']);
check('tpl requester', tplVal(['requester', '_reference']), ['Practitioner/pam-surgeon-orthopaedics']);
check('tpl reasonCode', tplVal(['reasonCode', 0, 'coding', 0]).map((c) => c.code), ['87522002']);
check('tpl supportingInfo', tplVal(['supportingInfo', 0, '_reference']), [`ServiceRequest/${PATIENT_ID}-surgery`]);
check('tpl note', tplVal(['note', 0, '_text']), ['Hb 98, ferritin 12']);
{ // priority routine when > 4 weeks away
  const q2 = structuredClone(qr); q2.item[0].item.find((i) => i.linkId === 'pam-surgery-days').answer[0].valueInteger = 60;
  const expr = Q.contained[0]._priority.extension[0].valueString;
  check('tpl priority (60 days -> routine)', ev(q2.item[0], { base: 'QuestionnaireResponse.item', expression: expr }, { resource: q2, rootResource: q2 }), ['routine']);
}

// --- 4. coverage -----------------------------------------------------------------------------
const uncovered = exprs.filter((e) => !covered.has(e));
check('every expression verified', uncovered.map((e) => `${e.linkId}: ${e.expression.slice(0, 60)}`), []);
check('standalone has the same item tree', isDeepStrictEqual(STANDALONE.item, Q.item), true);

// --- 5. terminology --------------------------------------------------------------------------
const vs = Q.item[0].item.find((i) => i.linkId === 'pam-surgery-procedure').answerValueSet;
const exp = await getJson(`${TX}/ValueSet/$expand?url=${encodeURIComponent(vs)}&filter=hip&count=50`);
check('ECL value set expands (filter "hip")', exp.expansion.total > 0, true);
check('ECL value set contains 52734007', exp.expansion.contains.some((c) => c.code === '52734007'), true);
const vc = await getJson(`${TX}/ValueSet/$validate-code?url=${encodeURIComponent(vs)}&system=http://snomed.info/sct&code=609588000`);
check('609588000 (pam-001 procedure) is in the value set', vc.parameter.find((p) => p.name === 'result').valueBoolean, true);
check('edition is SNOMED CT-AU', exp.expansion.parameter.find((p) => p.name === 'used-codesystem').valueUri.includes('32506021000036107'), true);

console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
