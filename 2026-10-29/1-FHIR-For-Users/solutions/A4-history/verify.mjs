#!/usr/bin/env node
// Verify every FHIRPath expression in the A4 solution with fhirpath.js (R4 model).
//
//   node verify.mjs [base]      (resolves fhirpath from ../../decks/node_modules)
//
// 1. Runs the module's x-fhir-queries against Meld for the test patient soln-A4-patient-1
//    (| -> %7C), evaluates each itemPopulationContext and every row's initialExpressions.
// 2. Evaluates the enableWhenExpression and the standalone's root variable.
// 3. Evaluates every templateExtractValue and ifNoneExist expression against a sample response
//    (question follow-ups are siblings in a wrapper group, so extraction finds them).
// 4. Checks that no expression was left unverified, and that every enableWhen points at an
//    existing linkId with a compatible answer type.
// 5. Expands every ECL answerValueSet on Ontoserver (SNOMED CT-AU) and checks expected members.
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
const PATIENT_ID = 'soln-A4-patient-1';
const SCT = 'http://snomed.info/sct';
const load = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const Q = load('soln-pam-history.json');
const STANDALONE = load('soln-A4-standalone.json');

let failures = 0, checks = 0;
const show = (v) => JSON.stringify(v);
function check(id, actual, expected) {
  checks++;
  if (isDeepStrictEqual(actual, expected)) console.log(`PASS ${id}  ${show(actual).slice(0, 160)}`);
  else { failures++; console.log(`FAIL ${id}\n       expected ${show(expected)}\n       got      ${show(actual)}`); }
}
const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
};
const ev = (base, expr, vars) => fhirpath.evaluate(base, expr, vars, r4);

// --- collect expressions ---------------------------------------------------------------------
const exprs = [];
const items = new Map();
(function walk(n, linkId) {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, linkId));
  if (!n || typeof n !== 'object') return;
  if (n.linkId) items.set(n.linkId, n);
  const lid = n.linkId || linkId;
  if (n.valueExpression) exprs.push({ linkId: lid, url: n.url, ...n.valueExpression });
  if (n.url?.endsWith('templateExtractValue') || n.url === 'ifNoneExist') exprs.push({ linkId: lid, url: n.url, expression: n.valueString });
  Object.values(n).forEach((x) => walk(x, lid));
})(Q);
const covered = new Set();
const find = (pred, what) => {
  const e = exprs.find(pred);
  if (!e) throw new Error(`no expression: ${what}`);
  covered.add(e); return e.expression;
};
const byLink = (linkId, kind) => find((x) => x.linkId === linkId && x.url.endsWith(kind), `${kind} on ${linkId}`);

// --- 1. pre-population -----------------------------------------------------------------------
const vars = { patient: await getJson(`${BASE}/Patient/${PATIENT_ID}`) };
for (const e of exprs.filter((x) => x.language === 'application/x-fhir-query')) {
  covered.add(e);
  vars[e.name] = await getJson(`${BASE}/${e.expression.replace('{{%patient.id}}', PATIENT_ID).replace(/\|/g, '%7C')}`);
}
const ids = (b) => (b.entry || []).map((x) => x.resource.id).sort();
// Only the test data's baseline (extraction tests delete what they write)
check('query historyConditions (problem list only, not the encounter diagnosis)', ids(vars.historyConditions),
  [`${PATIENT_ID}-condition-1`, `${PATIENT_ID}-condition-2`, `${PATIENT_ID}-condition-3`]);
check('query historyProcedures', ids(vars.historyProcedures), [`${PATIENT_ID}-procedure-1`, `${PATIENT_ID}-procedure-2`]);
check('query historyMedications (active only)', ids(vars.historyMedications), [`${PATIENT_ID}-medication-1`, `${PATIENT_ID}-medication-2`]);
check('query historyAllergies', ids(vars.historyAllergies), [`${PATIENT_ID}-allergy-1`]);

function rowsOf(groupLinkId) {
  const ctx = find((x) => x.linkId === groupLinkId && x.url.endsWith('itemPopulationContext'), groupLinkId);
  const name = exprs.find((x) => x.expression === ctx).name;
  const rows = ev({}, ctx, vars);
  const kids = items.get(groupLinkId).item.map((i) => i.linkId);
  return rows.map((row) => Object.fromEntries(kids.map((k) => {
    const v = ev({}, byLink(k, 'initialExpression'), { ...vars, [name]: row });
    return [k.replace(`${groupLinkId}-`, ''), v.map((x) => (x && typeof x === 'object' ? x.code : String(x)))];
  })));
}
const sortRows = (r) => r.sort((a, b) => show(a).localeCompare(show(b)));
check('rows: conditions', sortRows(rowsOf('pam-history-condition')), sortRows([
  { code: ['433144002'], status: ['active'], onset: ['2021-05-10'] },
  { code: ['44054006'], status: ['active'], onset: ['2015-03-01'] },
  { code: ['239873007'], status: ['active'], onset: ['2019-11-20'] }]));
check('rows: procedures', rowsOf('pam-history-procedure'), [
  { code: ['73761001'], date: ['2024-02-15'] }, { code: ['80146002'], date: ['1989-07-10'] }]);
check('rows: medications', sortRows(rowsOf('pam-history-medication')), sortRows([
  { code: ['134251000036103'], dose: ['5 mg twice daily'] }, { code: ['23358011000036102'], dose: ['500 mg twice daily'] }]));
check('rows: allergies', rowsOf('pam-history-allergy'), [{ code: ['764146007'], reaction: ['271807003'], criticality: ['high'] }]);
// criticality is a code; the item is a choice with answerOption codings -> Smart Forms maps code -> option
check('criticality code is one of the answerOptions',
  items.get('pam-history-allergy-criticality').answerOption.some((o) => o.valueCoding.code === 'high'), true);

// --- 2. root variable + enableWhenExpression -------------------------------------------------
const sexInit = STANDALONE.item[0].extension.find((x) => x.url.endsWith('initialExpression')).valueExpression.expression;
check('standalone pam-sex initial', ev({}, sexInit, vars), ['female']);
const sexVar = STANDALONE.extension.find((x) => x.valueExpression?.name === 'sexCode').valueExpression.expression;
const qrSex = (code) => ({ resourceType: 'QuestionnaireResponse', status: 'in-progress',
  item: [{ linkId: 'pam-sex', answer: [{ valueCoding: { system: 'http://hl7.org/fhir/administrative-gender', code } }] }] });
const hmbExpr = byLink('pam-history-hmb-group', 'enableWhenExpression');
for (const [code, want] of [['female', [true]], ['male', [false]]]) {
  const qr = qrSex(code);
  const sexCode = ev(qr, sexVar, { resource: qr, rootResource: qr });
  check(`sexCode (${code})`, sexCode, [code]);
  check(`HMB enabled for ${code}`, ev({}, hmbExpr, { sexCode }), want);
}
check('HMB with no sex recorded -> not enabled (empty)', ev({}, hmbExpr, { sexCode: [] }), []);

// --- 3. extraction on a sample response ------------------------------------------------------
const c = (code, display, system = SCT) => ({ valueCoding: { system, code, display } });
const qr = {
  resourceType: 'QuestionnaireResponse', status: 'in-progress', subject: { reference: `Patient/${PATIENT_ID}` },
  item: [{ linkId: 'pam-history', item: [
    { linkId: 'pam-history-screen', item: [
      { linkId: 'pam-history-gi-group', item: [
        { linkId: 'pam-history-gi', answer: [{ valueBoolean: true }] },
        { linkId: 'pam-history-gi-investigated', answer: [{ valueString: 'Yes, done' }] },
        { linkId: 'pam-history-scope', item: [
          { linkId: 'pam-history-scope-type', answer: [c('386831001', 'Gastroscopy')] },
          { linkId: 'pam-history-scope-date', answer: [{ valueDate: '2026-09-01' }] },
          { linkId: 'pam-history-scope-result', answer: [{ valueString: 'Abnormal' }] },
          { linkId: 'pam-history-scope-findings', answer: [{ valueString: 'Gastric ulcer' }] }] },
        { linkId: 'pam-history-scope', item: [
          { linkId: 'pam-history-scope-type', answer: [c('73761001', 'Colonoscopy')] },
          { linkId: 'pam-history-scope-date', answer: [{ valueDate: '2026-09-02' }] },
          { linkId: 'pam-history-scope-result', answer: [{ valueString: 'Normal' }] }] }] },
      { linkId: 'pam-history-transfusion-group', item: [
        { linkId: 'pam-history-transfusion', answer: [{ valueBoolean: true }] },
        { linkId: 'pam-history-transfusion-details', item: [
          { linkId: 'pam-history-transfusion-date', answer: [{ valueDate: '2018-06-01' }] },
          { linkId: 'pam-history-transfusion-reaction', answer: [{ valueBoolean: true }] },
          { linkId: 'pam-history-transfusion-reaction-type', answer: [c('302972002', 'Urticarial transfusion reaction')] }] }] },
      { linkId: 'pam-history-comorbidities', item: [
        { linkId: 'pam-history-ckd-group', item: [
          { linkId: 'pam-history-ckd', answer: [{ valueBoolean: true }] },
          { linkId: 'pam-history-ckd-stage', answer: [c('433144002', 'Chronic kidney disease stage 3')] }] }] }] },
    { linkId: 'pam-history-add', item: [
      { linkId: 'pam-history-new-condition', item: [
        { linkId: 'pam-history-new-condition-code', answer: [c('84114007', 'Heart failure')] },
        { linkId: 'pam-history-new-condition-status', answer: [c('active', 'Active', 'http://terminology.hl7.org/CodeSystem/condition-clinical')] },
        { linkId: 'pam-history-new-condition-onset', answer: [{ valueDate: '2022-01-15' }] }] },
      { linkId: 'pam-history-new-procedure', item: [
        { linkId: 'pam-history-new-procedure-code', answer: [c('52734007', 'Total hip replacement')] },
        { linkId: 'pam-history-new-procedure-date', answer: [{ valueDate: '2012-04-03' }] }] }] }] }],
};
const qrItems = (linkId) => {
  const out = [];
  (function walk(n) { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (n.linkId === linkId) out.push(n); Object.values(n).forEach(walk); } })(qr);
  return out;
};
const ctx = { resource: qr, rootResource: qr };
function extract(templateId, linkId, index = 0) {
  const tpl = Q.contained.find((t) => t.id === templateId);
  const node = qrItems(linkId)[index];
  const out = {};
  (function walk(n, path) {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!n || typeof n !== 'object') return;
    if (n.url?.endsWith('templateExtractValue')) {
      const e = exprs.find((x) => x.expression === n.valueString); covered.add(e);
      const v = ev(node, { base: 'QuestionnaireResponse.item', expression: n.valueString }, ctx);
      out[path.replace(/\.extension\[0\]$/, '')] = v.map((x) => (x && typeof x === 'object' ? x.code : String(x)));
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'url' && k !== 'valueString') walk(v, `${path}.${k}`);
  })(tpl, '');
  // ifNoneExist on the item that references this template
  const ref = items.get(linkId).extension.find((x) => x.url.endsWith('templateExtract') && x.extension[0].valueReference.reference === `#${templateId}`);
  const ine = ref.extension.find((x) => x.url === 'ifNoneExist');
  if (ine) {
    const e = exprs.find((x) => x.expression === ine.valueString && x.url === 'ifNoneExist'); covered.add(e);
    out.ifNoneExist = ev(node, { base: 'QuestionnaireResponse.item', expression: ine.valueString }, ctx);
  }
  return out;
}
const now = (o, k) => { const v = o[k]; delete o[k]; return v?.length === 1 && /^\d{4}-\d\d-\d\dT/.test(v[0]); };

const cond1 = extract('PAMHistoryConditionCkdTemplate', 'pam-history-ckd-stage');
check('Condition from comorbidity: recordedDate = now()', now(cond1, '._recordedDate'), true);
check('Condition from comorbidity (CKD stage)', cond1, {
  '.code.coding[0]': ['433144002'], '.subject._reference': [`Patient/${PATIENT_ID}`],
  ifNoneExist: [`patient=${PATIENT_ID}&code=http://snomed.info/sct|433144002`] });
const cond2 = extract('PAMHistoryNewConditionTemplate', 'pam-history-new-condition');
check('new Condition: recordedDate = now()', now(cond2, '._recordedDate'), true);
check('new Condition', cond2, {
  '.clinicalStatus.coding[0]': ['active'], '.code.coding[0]': ['84114007'], '.subject._reference': [`Patient/${PATIENT_ID}`],
  '._onsetDateTime': ['2022-01-15'], ifNoneExist: [`patient=${PATIENT_ID}&code=http://snomed.info/sct|84114007`] });
check('new Procedure', extract('PAMHistoryNewProcedureTemplate', 'pam-history-new-procedure'), {
  '.code.coding[0]': ['52734007'], '.subject._reference': [`Patient/${PATIENT_ID}`], '._performedDateTime': ['2012-04-03'],
  ifNoneExist: [`patient=${PATIENT_ID}&code=http://snomed.info/sct|52734007`] });
check('Endoscopy 1 (abnormal, with findings)', extract('PAMEndoscopyTemplate', 'pam-history-scope', 0), {
  '.code.coding[0]': ['386831001'], '.subject._reference': [`Patient/${PATIENT_ID}`], '._performedDateTime': ['2026-09-01'],
  '.note[0]._text': ['Abnormal: Gastric ulcer'],
  ifNoneExist: [`patient=${PATIENT_ID}&code=http://snomed.info/sct|386831001&date=2026-09-01`] });
check('Endoscopy 2 (normal, no findings)', extract('PAMEndoscopyTemplate', 'pam-history-scope', 1), {
  '.code.coding[0]': ['73761001'], '.subject._reference': [`Patient/${PATIENT_ID}`], '._performedDateTime': ['2026-09-02'],
  '.note[0]._text': ['Normal'],
  ifNoneExist: [`patient=${PATIENT_ID}&code=http://snomed.info/sct|73761001&date=2026-09-02`] });
check('Transfusion', extract('PAMTransfusionTemplate', 'pam-history-transfusion-details'), {
  '.subject._reference': [`Patient/${PATIENT_ID}`], '._performedDateTime': ['2018-06-01'],
  '.complication[0].coding[0]': ['302972002'] });

// --- 4. coverage and enableWhen integrity -----------------------------------------------------
const coveredText = new Set([...covered].map((e) => e.expression));
check('every expression verified (identical text counts once)', exprs.filter((e) => !coveredText.has(e.expression)).map((e) => `${e.linkId}: ${e.expression.slice(0, 70)}`), []);
const bad = [];
let maxDepth = 0, deepest = '';
const parents = new Map();
(function p(list, parent) { for (const i of list || []) { if (parent) parents.set(i.linkId, parent); p(i.item, i.linkId); } })(Q.item);
for (const [lid, it] of items) {
  for (const w of it.enableWhen || []) {
    const target = items.get(w.question);
    if (!target) { bad.push(`${lid} -> missing ${w.question}`); continue; }
    const key = Object.keys(w).find((k) => k.startsWith('answer'));
    const okType = { answerBoolean: ['boolean'], answerString: ['choice', 'string'], answerCoding: ['choice'], answerInteger: ['integer'] }[key];
    if (w.operator !== 'exists' && !okType?.includes(target.type)) bad.push(`${lid}: ${key} vs ${target.type}`);
    if (key === 'answerString' && target.answerOption && !target.answerOption.some((o) => o.valueString === w.answerString)) bad.push(`${lid}: "${w.answerString}" not an option of ${w.question}`);
    if (key === 'answerCoding' && target.answerOption && !target.answerOption.some((o) => o.valueCoding.code === w.answerCoding.code)) bad.push(`${lid}: ${w.answerCoding.code} not an option`);
  }
  // controlling questions: enableWhen of the item and its ancestors, followed transitively
  const ctl = new Set();
  const visit = (l) => { for (let a = l; a; a = parents.get(a)) for (const w of items.get(a).enableWhen || []) if (!ctl.has(w.question)) { ctl.add(w.question); visit(w.question); } };
  visit(lid);
  const d = ctl.size;
  if (d > maxDepth) { maxDepth = d; deepest = `${lid} <- ${[...ctl].join(' <- ')}`; }
  maxDepth = Math.max(maxDepth, d);
}
check('enableWhen targets exist and answer types match', bad, []);
check(`deepest enableWhen chain: ${deepest}`, maxDepth >= 3, true);
check('standalone carries the same module group', isDeepStrictEqual(STANDALONE.item[1], Q.item[0]), true);
// Smart Forms extraction only walks item.item: no templateExtract item may sit under a question
const underQuestion = [];
(function w(list, inQuestion) { for (const i of list || []) {
  if (inQuestion && i.extension?.some((e) => e.url.endsWith('templateExtract'))) underQuestion.push(i.linkId);
  w(i.item, inQuestion || !['group', 'display'].includes(i.type)); } })(Q.item, false);
check('no templateExtract item nested under a question', underQuestion, []);

// --- 5. terminology (Ontoserver, SNOMED CT-AU) -----------------------------------------------
const members = {
  'pam-history-condition-code': ['433144002', '44054006', '239873007'],
  'pam-history-procedure-code': ['80146002', '73761001', '52734007', '386831001'],
  'pam-history-medication-code': ['134251000036103', '23358011000036102', '703906002'],
  'pam-history-allergy-code': ['764146007'],
  'pam-history-allergy-reaction': ['271807003'],
  'pam-history-antithrombotic-med': ['703906002', '48603004', '7947003', '108979001'],
  'pam-history-transfusion-reaction-type': ['302972002'],
  'pam-history-cancer-type': ['363346000'],
  'pam-history-coag-type': ['64779008'],
  'pam-history-liver-type': ['235856003'],
  'pam-history-new-condition-code': ['84114007'],
  'pam-history-new-procedure-code': ['52734007'],
};
const notMembers = { 'pam-history-antithrombotic-med': ['23358011000036102' /* metformin MPUU */, '21522001'] };
for (const [lid, codes] of Object.entries(members)) {
  const vs = items.get(lid).answerValueSet;
  const exp = await getJson(`${TX}/ValueSet/$expand?url=${encodeURIComponent(vs)}&count=1`);
  const edition = exp.expansion.parameter.find((p) => p.name === 'used-codesystem')?.valueUri || '';
  check(`${lid}: expands (${exp.expansion.total} codes), SNOMED CT-AU`, exp.expansion.total > 0 && edition.includes('32506021000036107'), true);
  for (const code of codes) {
    const vc = await getJson(`${TX}/ValueSet/$validate-code?url=${encodeURIComponent(vs)}&system=${SCT}&code=${code}`);
    check(`${lid}: ${code} in value set`, vc.parameter.find((p) => p.name === 'result').valueBoolean, true);
  }
  for (const code of notMembers[lid] || []) {
    const vc = await getJson(`${TX}/ValueSet/$validate-code?url=${encodeURIComponent(vs)}&system=${SCT}&code=${code}`);
    check(`${lid}: ${code} NOT in value set`, vc.parameter.find((p) => p.name === 'result').valueBoolean, false);
  }
}
// answerOption codes are active SNOMED CT-AU concepts with the display we use
for (const [lid, it] of items) {
  for (const o of it.answerOption || []) {
    if (o.valueCoding?.system !== SCT) continue;
    const lk = await getJson(`${TX}/CodeSystem/$lookup?system=${SCT}&code=${o.valueCoding.code}`);
    const display = lk.parameter.find((p) => p.name === 'display')?.valueString;
    check(`${lid}: ${o.valueCoding.code} display`, display, o.valueCoding.display);
  }
}

console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
