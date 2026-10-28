#!/usr/bin/env node
// Verify every FHIRPath expression in the A6 diagnosis module and standalone form with fhirpath.js (R4).
//
//   node verify.mjs           # offline (x-fhir-queries simulated over test-data.json)
//   node verify.mjs --live    # x-fhir-queries on the Meld open endpoint (needs `python3 meld.py data`)
//
// Checks: the decision rules (root variables) on hand-made cases incl. thresholds and missing values,
// with both the proposed and the current pam-root hbThreshold; the classification against all 40
// synthetic PAM patients' recorded diagnoses; item calculations and enableWhenExpression; the Condition,
// Flag and Goal templates; pre-population; the playground results (playground-results/*.json); coverage.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate, check, pass, fail, finish, coverage, runQueries, buildQr, findItem, exprOf, LIVE,
} from '../A5-pathology/verify-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const Q = load('soln-pam-diagnosis.json');
const ALONE = load('soln-A6-standalone.json');
const ROOTVARS = load('root-variables.json');
const testData = load('test-data.json').entry.map((e) => e.resource);
const calcOf = (id) => exprOf(findItem(Q, id), 'sdc-questionnaire-calculatedExpression');
const show = (v) => JSON.stringify(v);
const SCT = 'http://snomed.info/sct';
const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';

// Root variables in the standalone's order (= root-variables.json existing + proposed threshold + new)
const STANDALONE_VARS = ALONE.extension.filter((e) => e.url.endsWith('/variable')).map((e) => e.valueExpression);
const CURRENT_ROOT_VARS = [...ROOTVARS.existing, ...ROOTVARS.new].map((e) => e.valueExpression);
check('standalone root variables = root-variables.json (with proposed hbThreshold)',
  STANDALONE_VARS.map((v) => v.name),
  [...ROOTVARS.existing.filter((e) => e.valueExpression.name !== 'hbThreshold'), ROOTVARS.hbThresholdProposed, ...ROOTVARS.new]
    .map((e) => e.valueExpression.name));

const dec = (v) => (v === undefined ? undefined : { valueDecimal: v });
function qrFor(c, extra = {}) {
  const a = {
    'pam-sex': c.sex && { valueCoding: { system: 'http://hl7.org/fhir/administrative-gender', code: c.sex } },
    'pam-hb': dec(c.hb), 'pam-ferritin': dec(c.ferritin), 'pam-tsat': dec(c.tsat), 'pam-crp': dec(c.crp),
    'pam-mcv': dec(c.mcv), 'pam-egfr': dec(c.egfr), ...extra,
  };
  Object.keys(a).forEach((k) => a[k] === undefined && delete a[k]);
  return buildQr(ALONE, a, 'Patient/soln-A6-patient-1');
}
// Evaluate the variables in order (each sees the earlier ones), as Smart Forms does
function vars(qr, defs = STANDALONE_VARS) {
  const env = { resource: qr, rootResource: qr };
  for (const v of defs) env[v.name] = evaluate(qr, v.expression, env);
  return env;
}
// Calculated items need their own answers in the QR too (e.g. pam-pathway for the Condition note)
function classify(c, defs) {
  const qr = qrFor(c);
  const env = vars(qr, defs);
  const calc = (id) => evaluate(qr, calcOf(id), env);
  return { env, qr, anaemia: calc('pam-anaemia'), ironDeficiency: calc('pam-iron-deficiency'),
    inflammation: calc('pam-inflammation'), severity: calc('pam-anaemia-severity'), pathway: env.pathway,
    pathwayText: calc('pam-pathway'), suggested: calc('pam-diagnosis-suggested'), code: env.suggestedDxCode };
}

// --- 1. Decision rules ------------------------------------------------------------------------------
const CASES = [
  ['IDA', { sex: 'female', hb: 100, ferritin: 20, tsat: 8, crp: 3 }, ['ida', '87522002', true, true, false, 'Moderate (Hb 80–109 g/L)']],
  ['ACD (test patient)', { sex: 'male', hb: 118, ferritin: 160, tsat: 14, crp: 28 }, ['acd', '234347009', true, true, true, 'Mild (Hb 110 g/L to the threshold)']],
  ['ID without anaemia', { sex: 'female', hb: 125, ferritin: 40, tsat: 15, crp: 2 }, ['id', '35240004', false, true, false, null]],
  ['anaemia, not iron', { sex: 'male', hb: 115, ferritin: 250, tsat: 30, crp: 4 }, ['anaemia', '271737000', true, false, false, 'Mild (Hb 110 g/L to the threshold)']],
  ['none', { sex: 'female', hb: 135, ferritin: 200, tsat: 30, crp: 2 }, ['none', null, false, false, false, null]],
  ['female Hb 120 (boundary)', { sex: 'female', hb: 120, ferritin: 200, tsat: 30, crp: 2 }, ['anaemia', '271737000', true, false, false, 'Mild (Hb 110 g/L to the threshold)']],
  ['female Hb 121', { sex: 'female', hb: 121, ferritin: 200, tsat: 30, crp: 2 }, ['none', null, false, false, false, null]],
  ['male Hb 130 (boundary)', { sex: 'male', hb: 130, ferritin: 200, tsat: 30, crp: 2 }, ['anaemia', '271737000', true, false, false, 'Mild (Hb 110 g/L to the threshold)']],
  ['male Hb 131', { sex: 'male', hb: 131, ferritin: 50, tsat: 30, crp: 2 }, ['id', '35240004', false, true, false, null]],
  ['ferritin 100, TSAT 19, no CRP', { sex: 'female', hb: 110, ferritin: 100, tsat: 19 }, ['ida', '87522002', true, true, null, 'Mild (Hb 110 g/L to the threshold)']],
  ['ferritin 300, TSAT 19, CRP 11', { sex: 'female', hb: 100, ferritin: 300, tsat: 19, crp: 11 }, ['acd', '234347009', true, true, true, 'Moderate (Hb 80–109 g/L)']],
  ['ferritin 301, TSAT 10', { sex: 'female', hb: 100, ferritin: 301, tsat: 10, crp: 11 }, ['anaemia', '271737000', true, false, true, 'Moderate (Hb 80–109 g/L)']],
  ['ferritin 99, CRP 50 (absolute ID wins)', { sex: 'male', hb: 100, ferritin: 99, tsat: 25, crp: 50 }, ['ida', '87522002', true, true, true, 'Moderate (Hb 80–109 g/L)']],
  ['CRP 10 is not inflammation', { sex: 'male', hb: 100, ferritin: 150, tsat: 15, crp: 10 }, ['ida', '87522002', true, true, false, 'Moderate (Hb 80–109 g/L)']],
  ['severe', { sex: 'female', hb: 75, ferritin: 8, tsat: 4, crp: 1 }, ['ida', '87522002', true, true, false, 'Severe (Hb < 80 g/L)']],
  ['no ferritin -> no pathway', { sex: 'female', hb: 100, tsat: 10, crp: 1 }, [null, null, true, null, false, 'Moderate (Hb 80–109 g/L)']],
  ['ferritin 150, no TSAT -> no pathway', { sex: 'female', hb: 100, ferritin: 150, crp: 1 }, [null, null, true, null, false, 'Moderate (Hb 80–109 g/L)']],
  ['no Hb -> no pathway', { sex: 'female', ferritin: 20, tsat: 8, crp: 3 }, [null, null, null, true, false, null]],
  ['sex unknown -> no threshold', { sex: 'unknown', hb: 100, ferritin: 20, tsat: 8, crp: 3 }, [null, null, null, true, false, null]],
];
const one = (x) => (x.length ? x[0] : null);
for (const [name, c, [pathway, code, anaemia, idf, infl, severity]] of CASES) {
  const r = classify(c);
  check(`rules: ${name}`, [one(r.pathway), one(r.code), one(r.anaemia), one(r.ironDeficiency), one(r.inflammation), one(r.severity)],
    [pathway, code, anaemia, idf, infl, severity]);
}
// Pathway text and suggestion strings
{
  const r = classify({ sex: 'male', hb: 115, ferritin: 250, tsat: 30, crp: 4, mcv: 106, egfr: 45 });
  check('pathway text: anaemia + macrocytic + low eGFR', r.pathwayText, [
    'Anaemia without iron deficiency: look for other causes (B12, folate, renal function, haematology review). '
    + 'Macrocytic (MCV > 100 fL). eGFR < 60: consider anaemia of chronic kidney disease']);
  check('pathway text: microcytic', classify({ sex: 'male', hb: 115, ferritin: 250, tsat: 30, crp: 4, mcv: 72 }).pathwayText,
    ['Anaemia without iron deficiency: look for other causes (B12, folate, renal function, haematology review). Microcytic (MCV < 80 fL)']);
  check('pathway text: IDA (no hints)', classify({ sex: 'female', hb: 100, ferritin: 20, tsat: 8, crp: 3, mcv: 70 }).pathwayText,
    ['Iron deficiency anaemia: iron replacement (see Treatment)']);
  check('pathway text: empty when no pathway', classify({ sex: 'female', hb: 100 }).pathwayText, []);
  check('suggested: ACD', classify({ sex: 'male', hb: 118, ferritin: 160, tsat: 14, crp: 28 }).suggested,
    ['Anaemia of chronic disease (SNOMED CT 234347009)']);
  check('suggested: none', classify({ sex: 'female', hb: 135, ferritin: 200, tsat: 30, crp: 2 }).suggested,
    ['None: no anaemia or iron deficiency']);
  check('suggested: empty when no pathway', classify({ sex: 'female', hb: 100 }).suggested, []);
}
// The current pam-root hbThreshold (120 unless male) gives the same results for male / female
{
  let same = 0;
  for (const [name, c] of CASES.filter(([, c]) => c.sex === 'male' || c.sex === 'female')) {
    const a = classify(c); const b = classify(c, CURRENT_ROOT_VARS);
    if (show([a.pathway, a.anaemia]) === show([b.pathway, b.anaemia])) same++; else fail(`current root: ${name}`, show([b.pathway, b.anaemia]));
  }
  pass('current pam-root hbThreshold', `same classification for all ${same} male/female cases`);
  check('current pam-root hbThreshold: sex unknown treated as female (120)',
    one(classify({ sex: 'unknown', hb: 100, ferritin: 20, tsat: 8, crp: 3 }, CURRENT_ROOT_VARS).pathway), 'ida');
}

// --- 2. All 40 synthetic PAM patients: suggested diagnosis = recorded Condition ----------------------
{
  const f = join(HERE, '../../data/pam-synthetic-bundle.json');
  if (!existsSync(f)) fail('synthetic', `${f} not found`);
  else {
    const rs = JSON.parse(readFileSync(f, 'utf8')).entry.map((e) => e.resource);
    const byId = Object.fromEntries(rs.map((r) => [r.id, r]));
    const tally = {}; const bad = [];
    for (const p of rs.filter((r) => r.resourceType === 'Patient')) {
      const v = (k) => byId[`${p.id}-${k}-1`].valueQuantity.value;
      const r = classify({ sex: p.gender, hb: v('hb'), ferritin: v('ferritin'), tsat: v('tsat'), crp: v('crp') });
      const recorded = byId[`${p.id}-diagnosis`]?.code.coding[0].code ?? null;
      tally[one(r.pathway)] = (tally[one(r.pathway)] ?? 0) + 1;
      if (one(r.code) !== recorded) bad.push(`${p.id}: suggested ${one(r.code)} (${one(r.pathway)}), recorded ${recorded}`);
    }
    bad.length ? fail('synthetic: suggested = recorded diagnosis', bad.join('; '))
      : pass('synthetic: suggested = recorded diagnosis', `40/40 patients (${show(tally)})`);
  }
}

// --- 3. Item logic: mismatch warning, Flag trigger, target gap -----------------------------------------
const coding = (system, code, display) => ({ valueCoding: { system, code, display } });
const ACD = classify({ sex: 'male', hb: 118, ferritin: 160, tsat: 14, crp: 28 });
{
  const differs = exprOf(findItem(Q, 'pam-diagnosis-differs'), 'sdc-questionnaire-enableWhenExpression');
  const withDx = (code) => {
    const qr = qrFor({ sex: 'male', hb: 118, ferritin: 160, tsat: 14, crp: 28 }, code ? { 'pam-diagnosis': coding(SCT, code, '') } : {});
    return evaluate(qr, differs, vars(qr));
  };
  check('differs: IDA chosen, ACD suggested -> shown', withDx('87522002'), [true]);
  check('differs: ACD chosen -> hidden', withDx('234347009'), [false]);
  check('differs: nothing chosen -> hidden', withDx(null), [false]);
  const trig = calcOf('pam-blood-flag');
  const consent = (c) => { const qr = qrFor({}, c ? { 'pam-blood-consent': coding(`${LOCAL}/blood-product-consent`, c, `label ${c}`) } : {}); return evaluate(qr, trig, vars(qr)); };
  check('flag trigger: full consent -> no answer (no Flag)', consent('full'), []);
  check('flag trigger: limited -> answer', consent('limited'), ['label limited']);
  check('flag trigger: refused -> answer', consent('refused'), ['label refused']);
  check('flag trigger: unanswered -> no answer', consent(null), []);
  const gap = calcOf('pam-target-hb-gap');
  const g = (t, hb) => { const qr = qrFor({ sex: 'male', hb }, t ? { 'pam-target-hb': dec(t) } : {}); return evaluate(qr, gap, vars(qr)); };
  check('target gap: 130 vs 118', g(130, 118), [12]);
  check('target gap: target below Hb', g(110, 118), [0]);
  check('target gap: no target', g(undefined, 118), []);
  check('target gap: no Hb', g(130, undefined), []);
}

// --- 4. Templates ---------------------------------------------------------------------------------------
const tv = (node) => node.extension[0].valueString;
const tpl = (id) => Q.contained.find((c) => c.id === id);
function qrItem(qr, linkId) {
  let f; (function walk(items) { for (const i of items ?? []) { if (i.linkId === linkId) f = i; walk(i.item); } })(qr.item); return f;
}
const at = (qr, linkId, expr) => evaluate(qrItem(qr, linkId), expr, { resource: qr, rootResource: qr }, 'QuestionnaireResponse.item');
{
  // Condition: on pam-diagnosis and on pam-diagnosis-other (separate copies of the same template)
  const qr0 = qrFor({ sex: 'male', hb: 118, ferritin: 160, tsat: 14, crp: 28 }, {
    'pam-diagnosis': coding(SCT, '234347009', 'Anaemia of chronic disease'),
    'pam-diagnosis-other': coding(SCT, '724556004', 'Iron deficiency anaemia due to blood loss'),
    'pam-pathway': { valueString: one(ACD.pathwayText) },
  });
  for (const [id, link, code] of [['PAMDiagnosisTemplate', 'pam-diagnosis', '234347009'], ['PAMOtherDiagnosisTemplate', 'pam-diagnosis-other', '724556004']]) {
    const t = tpl(id);
    check(`Condition ${id}: code`, at(qr0, link, tv(t.code.coding[0])).map((c) => c.code), [code]);
    check(`Condition ${id}: subject`, at(qr0, link, tv(t.subject._reference)), ['Patient/soln-A6-patient-1']);
    const rec = at(qr0, link, tv(t._recordedDate));
    /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(rec[0]) ? pass(`Condition ${id}: recordedDate`, rec[0]) : fail(`Condition ${id}: recordedDate`, show(rec));
    check(`Condition ${id}: note`, at(qr0, link, tv(t.note[0]._text)), [`Pathway (PAM decision support): ${one(ACD.pathwayText)}`]);
  }
  const qrNoPathway = qrFor({}, { 'pam-diagnosis': coding(SCT, '271737000', 'Anaemia') });
  check('Condition note: none without a pathway', at(qrNoPathway, 'pam-diagnosis', tv(tpl('PAMDiagnosisTemplate').note[0]._text)), []);
  check('Condition templates identical apart from id', { ...tpl('PAMOtherDiagnosisTemplate'), id: 'x' }, { ...tpl('PAMDiagnosisTemplate'), id: 'x' });

  // Flag
  const F = tpl('PAMBloodProductFlagTemplate');
  const flagFor = (consent, extra) => {
    const qr = qrFor({}, { 'pam-blood-consent': coding(`${LOCAL}/blood-product-consent`, consent, consent), 'pam-blood-flag': { valueString: consent }, ...extra });
    const r = (e) => at(qr, 'pam-blood-flag', e);
    return { code: r(tv(F.code.coding[0]._code)), display: r(tv(F.code.coding[0]._display)), text: r(tv(F.code._text)),
      subject: r(tv(F.subject._reference)), start: r(tv(F.period._start)) };
  };
  const religious = { 'pam-blood-reason': coding(`${LOCAL}/blood-product-refusal-reason`, 'religious', "Religious belief (e.g. Jehovah's Witness)") };
  const limited = flagFor('limited', {
    'pam-blood-declined': [coding(SCT, '126242007', 'Red blood cells, blood product'), coding(SCT, '256395009', 'Platelet product')],
    ...religious, 'pam-blood-details': { valueString: 'Accepts albumin' } });
  check('Flag limited + religious', [limited.code, limited.display, limited.text], [['708129006'],
    ['Transfusion of blood product refused for religious reason'],
    ["Limited consent to blood products: declines Red blood cells, blood product, Platelet product. Reason: Religious belief (e.g. Jehovah's Witness). Accepts albumin"]]);
  const refused = flagFor('refused', { 'pam-blood-reason': coding(`${LOCAL}/blood-product-refusal-reason`, 'personal', 'Personal preference') });
  check('Flag refused + personal', [refused.code, refused.display, refused.text],
    [['699054003'], ['Administration of blood product declined'], ['Refuses all blood products. Reason: Personal preference']]);
  const bare = flagFor('refused', {});
  check('Flag refused, nothing else', [bare.code, bare.text, bare.subject], [['699054003'], ['Refuses all blood products'], ['Patient/soln-A6-patient-1']]);
  check('Flag limited, no products listed', flagFor('limited', {}).text, ['Limited consent to blood products']);
  /^\d{4}-\d\d-\d\d$/.test(bare.start[0]) ? pass('Flag period.start', bare.start[0]) : fail('Flag period.start', show(bare.start));

  // Goal
  const G = tpl('PAMTargetHbGoalTemplate');
  const goalFor = (extra) => {
    const qr = qrFor({ sex: 'male', hb: 118 }, { 'pam-target-hb': dec(130), ...extra });
    const r = (e) => at(qr, 'pam-target-hb', e);
    return { description: r(tv(G.description._text)), value: r(tv(G.target[0].detailQuantity._value)),
      due: r(tv(G.target[0]._dueDate)), note: r(tv(G.note[0]._text)), start: r(tv(G._startDate)), subject: r(tv(G.subject._reference)) };
  };
  const goal = goalFor({ 'pam-target-hb-due': { valueDate: '2026-12-03' },
    'pam-target-hb-by': coding(`${LOCAL}/target-hb-requester`, 'surgeon', 'Surgeon') });
  check('Goal', [goal.description, goal.value, goal.due, goal.note, goal.subject],
    [['Haemoglobin at least 130 g/L before surgery'], [130], ['2026-12-03'], ['Requested by: Surgeon'], ['Patient/soln-A6-patient-1']]);
  /^\d{4}-\d\d-\d\d$/.test(goal.start[0]) ? pass('Goal startDate', goal.start[0]) : fail('Goal startDate', show(goal.start));
  const goal2 = goalFor({});
  check('Goal without due date / requester', [goal2.due, goal2.note], [[], []]);
}

// --- 5. Pre-population (standalone inputs + booked surgery date) ----------------------------------------
{
  const env = { ...(await runQueries(ALONE, 'soln-A6-patient-1', testData)), patient: testData.find((r) => r.resourceType === 'Patient') };
  const got = {};
  (function walk(items) { for (const i of items ?? []) { const e = exprOf(i, 'sdc-questionnaire-initialExpression'); if (e) got[i.linkId] = evaluate({}, e, env); walk(i.item); } })(ALONE.item);
  check(`pre-population${LIVE ? ' (live)' : ''}`, got, {
    'pam-sex': ['male'], 'pam-hb': [118], 'pam-ferritin': [160], 'pam-tsat': [14], 'pam-crp': [28], 'pam-mcv': [84], 'pam-egfr': [55],
    'pam-target-hb-due': ['2026-12-03'] });
}

// --- 6. Standalone = module + inputs --------------------------------------------------------------------
check('standalone module group = module', ALONE.item[1], Q.item[0]);
check('standalone templates = module', ALONE.contained, Q.contained);

// --- 7. Playground results (from playground.mjs) ----------------------------------------------------------
{
  const fq = join(HERE, 'playground-results/qr-filled.json'); const fb = join(HERE, 'playground-results/extract-bundle.json');
  if (!existsSync(fq) || !existsSync(fb)) fail('playground', 'playground-results missing (run playground.mjs)');
  else {
    const qr = JSON.parse(readFileSync(fq, 'utf8'));
    const env = vars(qr);
    const calc = {};
    (function walk(items) { for (const i of items ?? []) { const e = exprOf(i, 'sdc-questionnaire-calculatedExpression'); if (e) calc[i.linkId] = evaluate(qr, e, env); walk(i.item); } })(Q.item);
    const inQr = {};
    (function walk(items) { for (const i of items ?? []) { if (i.answer) inQr[i.linkId] = i.answer.map((a) => Object.entries(a).find(([k]) => k.startsWith('value'))[1]); walk(i.item); } })(qr.item);
    const diffs = Object.keys(calc).filter((k) => show(calc[k]) !== show(inQr[k] ?? []));
    diffs.length ? fail('playground calculations = fhirpath.js', diffs.map((k) => `${k}: playground ${show(inQr[k])} fhirpath.js ${show(calc[k])}`).join('; '))
      : pass('playground calculations = fhirpath.js', `${Object.keys(calc).length} calculated items identical`);
    const b = JSON.parse(readFileSync(fb, 'utf8'));
    check('playground extract: resources', b.entry.map((e) => `${e.resource.resourceType} ${e.resource.code?.coding?.[0]?.code ?? e.resource.target?.[0]?.detailQuantity?.value}`),
      ['Condition 234347009', 'Condition 724556004', 'Flag 708129006', 'Goal 130']);
  }
}

coverage(Q);
coverage(ALONE);
finish();
