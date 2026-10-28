#!/usr/bin/env node
// Evaluate every FHIRPath expression in the A1 module with fhirpath.js (R4 model) and print PASS/FAIL.
//   node verify.mjs                (run from anywhere; fhirpath is resolved from ../../decks/node_modules)
// Data: the test patient + Observations from testdata-bundle.json (as the x-fhir-query results would
// return them), a sparse patient (only the starter data's fields, like pam-001), and the real
// QuestionnaireResponse the playground produced (playground-qr-prepopulated.json) for the
// templateExtractValue expressions. Also checks that every expression in the JSON is covered.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(HERE, '../../decks/package.json'));
const fhirpath = req('fhirpath');
const r4 = req('fhirpath/fhir-context/r4');
const load = (f) => JSON.parse(readFileSync(path.join(HERE, f), 'utf8'));

const Q = load('pam-patient-details.json');
const S = load('A1-standalone.json');
const data = load('testdata-bundle.json').entry.map((e) => e.resource);
const patient = data.find((r) => r.resourceType === 'Patient');
const searchset = (code) => {
  const obs = data.filter((r) => r.resourceType === 'Observation' && r.code.coding[0].code === code)
    .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime)).slice(0, 1);
  return { resourceType: 'Bundle', type: 'searchset', total: obs.length, entry: obs.map((resource) => ({ resource })) };
};
const empty = { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] };
const sparse = { resourceType: 'Patient', id: 'sparse', name: [{ given: ['Alice'], family: 'Brooks' }], gender: 'female',
  birthDate: '1960-01-02', identifier: [{ system: 'http://ns.electronichealth.net.au/id/medicare-number', value: '0000000011' }],
  address: [{ use: 'home', city: 'Kedron', state: 'QLD', postalCode: '4031', country: 'AU' }] };

const today = new Date().toLocaleDateString('en-CA');
let failures = 0;
const covered = new Set();
// base: the context node; {item} = a QuestionnaireResponse item (typed via the R4 model)
function run(id, expr, ctx, vars, expected, base = {}) {
  covered.add(expr);
  let got;
  try {
    got = base.item ? fhirpath.evaluate(base.item, { base: 'QuestionnaireResponse.item', expression: expr }, vars, r4)
      : fhirpath.evaluate(base, expr, vars, r4);
    got = JSON.parse(JSON.stringify(got));
  } catch (e) { got = `ERROR ${e.message}`; }
  const ok = isDeepStrictEqual(got, expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${JSON.stringify(got)}${ok ? '' : `  expected ${JSON.stringify(expected)}`}`);
}

// Pull expressions out of the questionnaire by linkId
const byLink = {};
(function walk(items) { for (const i of items || []) { byLink[i.linkId] = i; walk(i.item); } })(Q.item);
const exprOf = (linkId, kind) => byLink[linkId].extension.find((e) => e.url.endsWith(kind)).valueExpression.expression;

const fullVars = { patient, obsHeight: searchset('8302-2'), obsWeight: searchset('29463-7') };
const sparseVars = { patient: sparse, obsHeight: empty, obsWeight: empty };
const expected = {
  'pam-name': [['Anna Testdetails'], ['Alice Brooks']],
  'pam-dob': [['1956-07-21'], ['1960-01-02']],
  'pam-sex': [['female'], ['female']],
  'pam-medicare': [['0000099901'], ['0000000011']],
  'pam-indigenous': [[{ system: 'https://healthterminologies.gov.au/fhir/CodeSystem/australian-indigenous-status-1', code: '4', display: 'Neither Aboriginal nor Torres Strait Islander origin' }], []],
  'pam-interpreter': [[true], []],
  'pam-language': [[{ system: 'urn:ietf:bcp:47', code: 'el', display: 'Greek' }], []],
  'pam-phone': [['0400 000 111'], []],
  'pam-addr-line': [['12 Example Street, Unit 3'], []],
  'pam-addr-suburb': [['Chermside'], ['Kedron']],
  'pam-addr-state': [['QLD'], ['QLD']],
  'pam-addr-postcode': [['4032'], ['4031']],
  'pam-nok-name': [['Sofia Testdetails'], []],
  'pam-nok-relationship': [['Daughter'], []],
  'pam-nok-phone': [['0400 000 222'], []],
  'pam-height': [[162], []],
  'pam-weight': [[68.4], []],
  'pam-hw-last': [['Latest on record: 162 cm (2026-09-15), 68.4 kg (2026-09-15)'], ['No height or weight on record']],
};
for (const [linkId, [full, sp]] of Object.entries(expected)) {
  const expr = exprOf(linkId, 'initialExpression');
  run(`${linkId} (test patient)`, expr, null, fullVars, full);
  run(`${linkId} (sparse patient)`, expr, null, sparseVars, sp);
}
// today(): fhirpath.js returns a FHIR date
{
  const expr = exprOf('pam-hw-date', 'initialExpression');
  covered.add(expr);
  const got = fhirpath.evaluate({}, `${expr}.toString()`, {}, r4);
  const ok = got[0] === today; if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} pam-hw-date (today)  ${JSON.stringify(got)}`);
}

// Calculations on root variables (as the standalone form defines them)
const ageExpr = exprOf('pam-age', 'calculatedExpression');
const y = Number(today.slice(0, 4));
const md = today.slice(5);
run('pam-age (birthday later this year)', ageExpr, null, { dob: '1956-12-31' }, [y - 1956 - (md < '12-31' ? 1 : 0)]);
run('pam-age (birthday on 1 Jan)', ageExpr, null, { dob: '1956-01-01' }, [y - 1956]);
run('pam-bmi', exprOf('pam-bmi', 'calculatedExpression'), null, { weightKg: 68.4, heightCm: 162 }, [26.1]);
run('pam-bmi (no height)', exprOf('pam-bmi', 'calculatedExpression'), null, { weightKg: 68.4, heightCm: [] }, []);

// Root variables copied into the standalone form, over the playground's pre-populated QR
const qr = load('playground-qr-prepopulated.json');
qr.subject ??= { reference: 'Patient/soln-A1-patient-1' };
const rootVars = Object.fromEntries(S.extension.filter((e) => e.url.endsWith('/variable')).map((e) => [e.valueExpression.name, e.valueExpression.expression]));
run('root var dob', rootVars.dob, null, { resource: qr }, ['1956-07-21'], qr);
run('root var heightCm', rootVars.heightCm, null, { resource: qr }, [162], qr);
run('root var weightKg', rootVars.weightKg, null, { resource: qr }, [68.4], qr);

// templateExtractValue expressions: context = the pam-weight / pam-height QR item, %resource = QR
const qrItem = (l) => { let f; (function w(items) { for (const i of items || []) { if (i.linkId === l) f = i; w(i.item); } })(qr.item); return f; };
for (const t of Q.contained) {
  const tevs = [];
  (function w(n, p) {
    if (Array.isArray(n)) n.forEach((x, i) => w(x, `${p}[${i}]`));
    else if (n && typeof n === 'object') {
      if (n.url?.endsWith('templateExtractValue')) tevs.push([p, n.valueString]);
      for (const [k, v] of Object.entries(n)) w(v, `${p}.${k}`);
    }
  })(t, t.id);
  const ctx = qrItem(t.id === 'PAMHeightTemplate' ? 'pam-height' : 'pam-weight');
  const exp = {
    '%resource.subject.reference': [qr.subject.reference],
    // the playground's response carries the date it was filled in (pam-hw-date defaults to today())
    "%resource.repeat(item).where(linkId='pam-hw-date').answer.value.toString()": [qrItem('pam-hw-date').answer[0].valueDate],
    'answer.value': [t.id === 'PAMHeightTemplate' ? 162 : 68.4],
  };
  for (const [p, expr] of tevs) run(`template ${p}`, expr, ctx, { resource: qr }, exp[expr], { item: ctx });
}

// Coverage: every expression in the module must have been evaluated above
const all = [];
(function w(n) {
  if (Array.isArray(n)) n.forEach(w);
  else if (n && typeof n === 'object') {
    if (n.valueExpression?.language === 'text/fhirpath') all.push(n.valueExpression.expression);
    if (n.url?.endsWith('templateExtractValue')) all.push(n.valueString);
    Object.values(n).forEach(w);
  }
})(Q);
const missed = all.filter((e) => !covered.has(e));
if (missed.length) { failures++; console.log(`FAIL coverage  not evaluated: ${JSON.stringify(missed)}`); }
else console.log(`PASS coverage  all ${all.length} FHIRPath expressions in the module evaluated`);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
