#!/usr/bin/env node
// Verify every FHIRPath expression in the A5 pathology module with fhirpath.js (R4 model).
//
//   node verify.mjs           # offline: x-fhir-queries simulated over test-data.json and fixtures
//   node verify.mjs --live    # x-fhir-queries run on the Meld open endpoint (needs `python3 meld.py data`)
//
// Checks: pre-population (latest, initial vs post-treatment, history rows) for the test patient and
// two in-memory edge cases; the initial / post-treatment rule against all 40 synthetic PAM patients;
// calculated changes; the Observation template on hand-entered results; the standalone form matches
// the module; the playground results (playground-results/*.json, from playground.mjs) agree; and that
// every FHIRPath expression in the module was evaluated.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate, check, pass, fail, finish, coverage, runQueries, searchOffline, buildQr, findItem, exprOf, inventory,
  LIVE,
} from './verify-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const Q = load('soln-pam-pathology.json');
const ALONE = load('soln-A5-standalone.json');
const testData = load('test-data.json').entry.map((e) => e.resource);
const KEYS = ['hb', 'ferritin', 'tsat', 'crp', 'mcv', 'b12', 'folate', 'egfr'];
const initialOf = (linkId) => exprOf(findItem(Q, linkId), 'sdc-questionnaire-initialExpression');
const calcOf = (linkId) => exprOf(findItem(Q, linkId), 'sdc-questionnaire-calculatedExpression');

// Pre-populate: evaluate every initialExpression outside the history group -> { linkId: [values] }
async function prepopulate(patientId, resources, live = LIVE) {
  const vars = await runQueries(Q, patientId, resources, live);
  const env = { ...vars, patient: resources.find((r) => r.id === patientId) ?? { resourceType: 'Patient', id: patientId } };
  const out = {};
  (function walk(items, inHistory) {
    for (const i of items ?? []) {
      const e = exprOf(i, 'sdc-questionnaire-initialExpression');
      if (e && !inHistory) out[i.linkId] = evaluate({}, e, env);
      walk(i.item, inHistory || i.linkId === 'pam-path-history');
    }
  })(Q.item, false);
  // History: itemPopulationContext -> one row per Observation
  const hist = findItem(Q, 'pam-path-history');
  const ctx = hist.extension.find((x) => x.url.endsWith('itemPopulationContext')).valueExpression;
  const rows = evaluate({}, ctx.expression, env).map((r) => Object.fromEntries(hist.item.map((c) => [
    c.linkId, evaluate({}, exprOf(c, 'sdc-questionnaire-initialExpression'), { ...env, [ctx.name]: r })])));
  return { values: out, rows, env };
}

// --- 1. Test patient (treated: IV iron 2026-08-20) ------------------------------------------------
{
  const { values: v, rows } = await prepopulate('soln-A5-patient-1', testData);
  const P = 'patient-1';
  const latest = { hb: 121, ferritin: 310, tsat: 26, crp: 5, mcv: 82, b12: 310, folate: 22, egfr: 70 };
  for (const k of KEYS) {
    check(`${P} latest ${k}`, v[`pam-${k}`], [latest[k]]);
    check(`${P} latest ${k} date`, v[`pam-${k}-date`], [['b12', 'folate'].includes(k) ? '2026-08-12' : '2026-09-24']);
  }
  check(`${P} treatment date`, v['pam-path-treatment-date'], ['2026-08-20']);
  const initial = { hb: 104, ferritin: 15, tsat: 9, crp: 6, mcv: 76, b12: 310, folate: 22, egfr: 72 };
  const post = { hb: 121, ferritin: 310, tsat: 26, crp: 5, mcv: 82, egfr: 70 }; // no B12 / folate after treatment
  for (const k of KEYS) {
    check(`${P} initial ${k}`, v[`pam-${k}-initial`], [initial[k]]);
    check(`${P} initial ${k} date`, v[`pam-${k}-initial-date`], ['2026-08-12']);
    check(`${P} post ${k}`, v[`pam-${k}-post`], post[k] === undefined ? [] : [post[k]]);
    check(`${P} post ${k} date`, v[`pam-${k}-post-date`], post[k] === undefined ? [] : ['2026-09-24']);
  }
  check(`${P} history row count`, rows.length, 18);
  check(`${P} history first row`, rows[0]['pam-hist-date'], ['2026-09-24']);
  check(`${P} history last row`, [rows.at(-1)['pam-hist-date'], rows.at(-1)['pam-hist-lab'], rows.at(-1)['pam-hist-phase']],
    [['2026-06-03'], ['Northside Community Pathology (synthetic)'], ['Before']]);
  check(`${P} history phases`, rows.map((r) => r['pam-hist-phase'][0]).reduce((a, p) => ({ ...a, [p]: (a[p] ?? 0) + 1 }), {}),
    { After: 6, Before: 12 });
  const hbRows = rows.filter((r) => r['pam-hist-test'][0] === 'Haemoglobin (Hb)');
  check(`${P} history Hb rows`, hbRows.map((r) => [r['pam-hist-date'][0], r['pam-hist-value'][0], r['pam-hist-unit'][0]]),
    [['2026-09-24', 121, 'g/L'], ['2026-08-12', 104, 'g/L'], ['2026-06-03', 112, 'g/L']]);
  check(`${P} history eGFR unit`, rows.find((r) => r['pam-hist-test'][0] === 'eGFR')['pam-hist-unit'], ['mL/min/1.73 m²']);

  // Calculated changes (post - initial), on a QR holding the pre-populated answers
  const answers = {};
  for (const [l, vals] of Object.entries(v)) if (vals.length) answers[l] = vals.map((x) => (typeof x === 'number'
    ? { valueDecimal: x } : { valueDate: x }));
  const qr = buildQr(Q, answers, 'Patient/soln-A5-patient-1');
  const change = { hb: [17], ferritin: [295], tsat: [17], crp: [-1], mcv: [6], b12: [], folate: [], egfr: [-2] };
  for (const k of KEYS) check(`${P} change ${k}`, evaluate(qr, calcOf(`pam-${k}-change`), { resource: qr }), change[k]);
}

// --- 2. Edge cases (in memory) ----------------------------------------------------------------------
const obs = (pid, id, code, day, value) => ({
  resourceType: 'Observation', id, status: 'final', subject: { reference: `Patient/${pid}` },
  code: { coding: [{ system: 'http://loinc.org', code }] }, effectiveDateTime: day,
  valueQuantity: { value, unit: 'g/L', system: 'http://unitsofmeasure.org', code: 'g/L' },
});
const medReq = (pid, id, status, day, text, route = '47625008') => ({
  resourceType: 'MedicationRequest', id, status, intent: 'order', subject: { reference: `Patient/${pid}` },
  authoredOn: day, medicationCodeableConcept: { text },
  dosageInstruction: [{ route: { coding: [{ system: 'http://snomed.info/sct', code: route }] } }],
});
{
  // Untreated: only a non-iron IV order and a cancelled IV iron order -> earliest vs latest
  const pid = 'edge-untreated';
  const rs = [obs(pid, 'a', '718-7', '2026-01-10', 100), obs(pid, 'b', '718-7', '2026-02-10', 105),
    obs(pid, 'c', '718-7', '2026-03-01T09:30:00+10:00', 108), obs(pid, 'd', '2276-4', '2026-01-10', 150),
    medReq(pid, 'm1', 'completed', '2026-02-01', 'Ceftriaxone 1 g injection'),
    medReq(pid, 'm2', 'cancelled', '2026-02-01', 'Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial'),
    medReq(pid, 'm3', 'active', '2026-02-01', 'Iron (as ferrous sulfate) tablet', '26643006')]; // oral
  const { values: v, rows } = await prepopulate(pid, rs, false);
  check('untreated: no treatment date', v['pam-path-treatment-date'], []);
  check('untreated: initial Hb = earliest', [v['pam-hb-initial'], v['pam-hb-initial-date']], [[100], ['2026-01-10']]);
  check('untreated: post Hb = latest', [v['pam-hb-post'], v['pam-hb-post-date']], [[108], ['2026-03-01']]);
  check('untreated: single ferritin -> initial only', [v['pam-ferritin-initial'], v['pam-ferritin-post']], [[150], []]);
  check('untreated: history phase empty', rows.map((r) => r['pam-hist-phase']), [[], [], [], []]);
  check('untreated: latest Hb date from dateTime', v['pam-hb-date'], ['2026-03-01']);
}
{
  // Treated, but no result before the IV iron order -> no initial value
  const pid = 'edge-no-baseline';
  const rs = [obs(pid, 'a', '718-7', '2026-04-10', 112), medReq(pid, 'm', 'completed', '2026-03-01', 'Ferric derisomaltose'),
    { ...medReq(pid, 'm0', 'completed', '2026-01-01', ''), medicationCodeableConcept: { coding: [{ display: 'Iron sucrose 100 mg/5 mL' }] } }];
  const { values: v } = await prepopulate(pid, rs, false);
  check('no baseline: treatment date = most recent IV iron', v['pam-path-treatment-date'], ['2026-03-01']);
  check('no baseline: initial Hb empty, post Hb 112', [v['pam-hb-initial'], v['pam-hb-post']], [[], [112]]);
}
// (Edge cases are in memory, so they never go to Meld, even with --live.)

// --- 3. All 40 synthetic PAM patients: initial / post match the generator's -1 / -2 results ----------
{
  const bundlePath = join(HERE, '../../data/pam-synthetic-bundle.json');
  if (!existsSync(bundlePath)) fail('synthetic', `${bundlePath} not found`);
  else {
    const rs = JSON.parse(readFileSync(bundlePath, 'utf8')).entry.map((e) => e.resource);
    const byId = Object.fromEntries(rs.map((r) => [r.id, r]));
    let n = 0; const bad = [];
    for (const p of rs.filter((r) => r.resourceType === 'Patient')) {
      const env = {
        pathHistory: searchOffline(rs, findQuery('pathHistory').replace('{{%patient.id}}', p.id)),
        pathIvIron: searchOffline(rs, findQuery('pathIvIron').replace('{{%patient.id}}', p.id)),
      };
      for (const k of ['hb', 'ferritin', 'tsat', 'crp']) {
        const want = [byId[`${p.id}-${k}-1`]?.valueQuantity.value, byId[`${p.id}-${k}-2`]?.valueQuantity.value];
        const got = [evaluate({}, initialOf(`pam-${k}-initial`), env)[0], evaluate({}, initialOf(`pam-${k}-post`), env)[0]];
        n++;
        if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`${p.id} ${k} want ${want} got ${got}`);
      }
    }
    bad.length ? fail('synthetic initial/post', bad.slice(0, 5).join('; ')) : pass('synthetic initial/post', `${n} patient-tests match the generator's initial (-1) and post-treatment (-2) results`);
  }
}
function findQuery(name) { return inventory(Q).find((e) => e.name === name).expression; }

// --- 4. Observation template on hand-entered results ---------------------------------------------------
{
  const coding = (code, display) => ({ valueCoding: { system: 'http://loinc.org', code, display } });
  const qr = buildQr(Q, {
    'pam-ext': [
      { 'pam-ext-test': coding('718-7', 'Haemoglobin (Hb), g/L'), 'pam-ext-value': { valueDecimal: 98 },
        'pam-ext-date': { valueDate: '2026-10-27' }, 'pam-ext-lab': { valueString: 'Sunshine Pathology (synthetic)' } },
      { 'pam-ext-test': coding('14685-2', 'Vitamin B12, pmol/L'), 'pam-ext-value': { valueDecimal: 180 },
        'pam-ext-date': { valueDate: '2026-10-26' } },
      { 'pam-ext-test': coding('62238-1', 'eGFR, mL/min/1.73 m²'), 'pam-ext-value': { valueDecimal: 58 },
        'pam-ext-date': { valueDate: '2026-10-25' } },
    ],
  }, 'Patient/soln-A5-patient-1');
  const reps = qrItems(qr, 'pam-ext');
  const tpl = Q.contained.find((c) => c.id === 'PAMExternalResultTemplate');
  const tv = (node) => node.extension[0].valueString;
  const ex = {
    code: tv(tpl.code.coding[0]._code), display: tv(tpl.code.coding[0]._display), text: tv(tpl.code._text),
    subject: tv(tpl.subject._reference), date: tv(tpl._effectiveDateTime), lab: tv(tpl.performer[0]._display),
    value: tv(tpl.valueQuantity._value), ucum: tv(tpl.valueQuantity._code), unit: tv(tpl.valueQuantity._unit),
  };
  const run = (rep) => Object.fromEntries(Object.entries(ex).map(([k, e]) => [k,
    evaluate(rep, e, { resource: qr, rootResource: qr }, 'QuestionnaireResponse.item')]));
  check('template Hb', run(reps[0]), {
    code: ['718-7'], display: ['Hemoglobin [Mass/volume] in Blood'], text: ['Haemoglobin (Hb)'],
    subject: ['Patient/soln-A5-patient-1'], date: ['2026-10-27'], lab: ['Sunshine Pathology (synthetic)'],
    value: [98], ucum: ['g/L'], unit: ['g/L'] });
  check('template B12 (no lab -> no performer)', run(reps[1]), {
    code: ['14685-2'], display: ['Cobalamin (Vitamin B12) [Moles/volume] in Serum or Plasma'], text: ['Vitamin B12'],
    subject: ['Patient/soln-A5-patient-1'], date: ['2026-10-26'], lab: [], value: [180], ucum: ['pmol/L'], unit: ['pmol/L'] });
  check('template eGFR units', [run(reps[2]).ucum, run(reps[2]).unit], [['mL/min/{1.73_m2}'], ['mL/min/1.73 m²']]);
  // Every answer option has a unit and a LOINC display in the template
  for (const o of findItem(Q, 'pam-ext-test').answerOption) {
    const q1 = buildQr(Q, { 'pam-ext': [{ 'pam-ext-test': { valueCoding: o.valueCoding } }] }, 'Patient/x');
    const r = run(qrItems(q1, 'pam-ext')[0]);
    (r.ucum.length && r.unit.length && r.display.length && r.text.length) ? pass(`template option ${o.valueCoding.code}`, `${r.ucum} / ${r.text}`)
      : fail(`template option ${o.valueCoding.code}`, show(r));
  }
}
function show(v) { return JSON.stringify(v); }
function qrItems(qr, linkId) {
  const out = [];
  (function walk(items) { for (const i of items ?? []) { if (i.linkId === linkId) out.push(i); walk(i.item); } })(qr.item);
  return out;
}

// --- 5. Standalone = module (same item tree and template) -----------------------------------------------
check('standalone item tree = module', ALONE.item, Q.item);
check('standalone template = module', ALONE.contained, Q.contained);

// --- 6. Playground results (from playground.mjs) agree --------------------------------------------------
{
  const f = join(HERE, 'playground-results/qr-prepopulated.json');
  if (!existsSync(f)) fail('playground', 'playground-results/qr-prepopulated.json missing (run playground.mjs)');
  else {
    const qr = JSON.parse(readFileSync(f, 'utf8'));
    const { values } = await prepopulate('soln-A5-patient-1', testData, false);
    const got = {};
    (function walk(items) { for (const i of items ?? []) { if (i.answer && !i.linkId.startsWith('pam-hist')) got[i.linkId] = i.answer.map((a) => Object.entries(a).find(([k]) => k.startsWith('value'))[1]); walk(i.item); } })(qr.item);
    const want = Object.fromEntries(Object.entries(values).filter(([, x]) => x.length));
    const diffs = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    diffs.length ? fail('playground prepopulation = fhirpath.js', diffs.map((k) => `${k}: ${show(got[k])} vs ${show(want[k])}`).join('; '))
      : pass('playground prepopulation = fhirpath.js', `${Object.keys(want).length} pre-populated answers identical`);
    check('playground history rows', qr.item[0].item.filter((i) => i.linkId === 'pam-path-history').length, 18);
  }
}

coverage(Q);
finish();
