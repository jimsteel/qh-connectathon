#!/usr/bin/env node
// Verify the A8 solution: structure, every FHIRPath expression (fhirpath.js, R4 model),
// prepopulation from the test patient on Meld, and template extraction (single and multiple
// answers) with @aehrc/sdc-template-extract, the library inside Smart Forms, if installed.
//
//   node verify.mjs [base]          (default base: the Meld open endpoint; "offline" skips Meld)
//
// Needs fhirpath (found in ../../decks/node_modules). For the extraction checks:
//   npm install --no-save @aehrc/sdc-template-extract@1.0.16     (in this folder; don't commit node_modules)
// Prepopulation needs the test patient: load test-data.json first (see README).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allExpressions, buildResponse, evaluate, evaluated, load, runQuery, walkQ } from './sdc-sim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || 'https://gw.interop.community/QHConnectathon2026/open').replace(/\/$/, '');
const read = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const module_ = read('soln-pam-education.json');
const standalone = read('soln-A8-standalone.json');

let failures = 0;
const pass = (id, msg = '') => console.log(`PASS ${id}  ${msg}`);
const fail = (id, msg) => { failures++; console.log(`FAIL ${id}  ${msg}`); };
const check = (id, ok, msg) => (ok ? pass(id, msg) : fail(id, msg));

// --- 1. structure -------------------------------------------------------------------------------
const SOLN = 'https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire';
check('module-id', module_.id === 'soln-pam-education' && module_.url === `${SOLN}/pam-education` && module_.version === '0.2.0', module_.url);
check('standalone-id', standalone.id === 'soln-A8-standalone' && standalone.url === `${SOLN}/A8-standalone`, standalone.url);
const top = module_.item[0];
check('top-group', module_.item.length === 1 && top.linkId === 'pam-education' && top.type === 'group', top.linkId);
check('module-item', top.item[0].linkId === 'pam-education-module' && top.item[0].extension.some((e) => e.url.endsWith('questionnaire-hidden')), top.item[0].initial[0].valueString);
const linkIds = []; walkQ(module_.item, (it) => linkIds.push(it.linkId));
check('linkids', new Set(linkIds).size === linkIds.length && linkIds.every((l) => l.startsWith('pam-')), `${linkIds.length} unique, all pam-`);
const multi = linkIds.filter((l) => { let r; walkQ(module_.item, (it) => { if (it.linkId === l) r = it; }); return r.repeats && r.type === 'choice'; });
check('multi-select', multi.join() === 'pam-edu-method,pam-edu-material', multi.join(', '));

// --- 2. prepopulation from the test patient on Meld ---------------------------------------------
const PID = 'soln-A8-patient-1';
let prepop = {};
const queryExt = standalone.item[0].extension.find((x) => x.valueExpression?.language === 'application/x-fhir-query');
async function prepopulate(patient, bundle) {
  const env = { patient: [patient], eduSurgery: [bundle] };
  const got = {};
  walkQ(standalone.item, (it) => {
    const ie = it.extension?.find((x) => x.url.endsWith('initialExpression'));
    if (ie) got[it.linkId] = evaluate(patient, ie.valueExpression.expression, env)[0];
  });
  return got;
}
if (BASE !== 'offline') {
  try {
    const patient = await (await fetch(`${BASE}/Patient/${PID}`, { headers: { Accept: 'application/fhir+json' } })).json();
    if (patient.resourceType !== 'Patient') throw new Error(`no ${PID} on ${BASE} (load test-data.json)`);
    const bundle = await runQuery(BASE, queryExt.valueExpression.expression, PID);
    evaluated.add(queryExt.valueExpression.expression);
    prepop = await prepopulate(patient, bundle);
    const today = new Date().toLocaleDateString('en-CA');
    const want = { 'pam-edu-patient': 'Evan Edutest', 'pam-edu-unit': 'Orthopaedics (A8 test unit)', 'pam-edu-consultant': 'Dr Nora Testsurgeon',
      'pam-edu-procedure': 'Total knee replacement', 'pam-edu-surgery-ref': 'ServiceRequest/soln-A8-patient-1-surgery' };
    const bad = Object.keys(want).filter((k) => prepop[k] !== want[k]);
    check('prepopulation', bad.length === 0, bad.length ? `got ${JSON.stringify(prepop)}` : JSON.stringify(want));
    check('prepop-date', String(prepop['pam-edu-date']) === today, `today() -> ${prepop['pam-edu-date']}`);
    // a synthetic PAM patient too (read only): the shared surgeon/unit resources
    const p1 = await (await fetch(`${BASE}/Patient/pam-001`, { headers: { Accept: 'application/fhir+json' } })).json();
    const g1 = await prepopulate(p1, await runQuery(BASE, queryExt.valueExpression.expression, 'pam-001'));
    check('prepop-pam-001', g1['pam-edu-unit'] && g1['pam-edu-consultant'], `${g1['pam-edu-patient']}: ${g1['pam-edu-unit']}, ${g1['pam-edu-consultant']}`);
  } catch (e) { fail('prepopulation', e.message); }
}
// offline fallback for the expressions: a fabricated bundle
if (!prepop['pam-edu-unit']) {
  const bundle = { resourceType: 'Bundle', type: 'searchset', entry: [
    { search: { mode: 'match' }, resource: { resourceType: 'ServiceRequest', id: 'sr1', code: { text: 'Total knee replacement' }, requester: { reference: 'Practitioner/pr1' }, performer: [{ reference: 'Organization/o1' }] } },
    { search: { mode: 'include' }, resource: { resourceType: 'Organization', id: 'o1', name: 'Unit' } },
    { search: { mode: 'include' }, resource: { resourceType: 'Practitioner', id: 'pr1', name: [{ given: ['A'], family: 'B' }] } }] };
  prepop = await prepopulate({ resourceType: 'Patient', id: 'x', name: [{ given: ['C'], family: 'D' }] }, bundle);
  check('prepopulation-offline', prepop['pam-edu-unit'] === 'Unit' && prepop['pam-edu-consultant'] === 'A B', JSON.stringify(prepop));
}

// --- 3. extraction --------------------------------------------------------------------------------
const MODE = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode';
const MAT = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/education-material';
const c = (system, code, display) => ({ system, code, display });
const base = { 'pam-edu-patient': [prepop['pam-edu-patient']], 'pam-edu-unit': [prepop['pam-edu-unit']], 'pam-edu-consultant': [prepop['pam-edu-consultant']],
  'pam-edu-procedure': [prepop['pam-edu-procedure']], 'pam-edu-surgery-ref': [prepop['pam-edu-surgery-ref']], 'pam-edu-date': ['2026-10-28'] };
const CASES = {
  multiple: { ...base,
    'pam-edu-method': [c(MODE, 'FACE', 'Face-to-face'), c(MODE, 'WRITTEN', 'Written information (printed)'), c(MODE, 'EMAILWRIT', 'Email')],
    'pam-edu-material': [c(MAT, 'anaemia-surgery', 'Anaemia and iron deficiency before surgery (patient information)'),
      c(MAT, 'iv-iron', 'Intravenous (IV) iron infusion: what to expect'), c(MAT, 'iron-diet', 'Iron-rich foods (dietary advice)'), c(MAT, 'other', 'Other')],
    'pam-edu-material-other': ['Hospital PBM fact sheet'], 'pam-edu-notes': ['Understood; will bring questions to the infusion.'] },
  single: { ...base, 'pam-edu-method': [c(MODE, 'PHONE', 'Telephone')] },
  none: { ...base },
};
const extractLib = load('@aehrc/sdc-template-extract');
const qrs = Object.fromEntries(Object.entries(CASES).map(([k, e]) => [k, buildResponse(standalone, e, { patientRef: `Patient/${PID}` }).qr]));
check('enableWhen-other', qrs.multiple.item[0].item.some((i) => i.linkId === 'pam-edu-material-other') && !qrs.single.item[0].item.some((i) => i.linkId === 'pam-edu-material-other'), 'Other material only when "Other" is ticked');
if (!extractLib) {
  console.log('SKIP extraction  (npm install --no-save @aehrc/sdc-template-extract@1.0.16)');
} else {
  for (const x of allExpressions(standalone).filter((x) => !x.url.endsWith('/variable') && !x.url.includes('Expression'))) {
    try { evaluate(qrs.multiple, x.expression, { resource: qrs.multiple, eduProcedureId: ['00000000-0000-4000-8000-000000000002'] }); } catch (e) { fail('template-expr', `${x.expression}: ${e.message}`); }
  }
  const run = async (qr) => {
    const out = await extractLib.inAppExtract(structuredClone(qr), standalone, null);
    if (!out.extractSuccess) throw new Error(JSON.stringify(out.extractResult));
    return out.extractResult.extractedBundle;
  };
  const b = await run(qrs.multiple);
  const proc = b.entry.find((e) => e.resource.resourceType === 'Procedure');
  const comm = b.entry.find((e) => e.resource.resourceType === 'Communication');
  check('extract-entries', b.entry.length === 2 && proc && comm, b.entry.map((e) => `${e.request.method} ${e.request.url}`).join(', '));
  const p = proc.resource;
  check('procedure-b3', p.category.coding[0].code === '409073007' && p.code.coding[0].code === '311401005' && p.performedDateTime === '2026-10-28' && p.status === 'completed' && p.subject.reference === `Patient/${PID}`,
    `category ${p.category.coding[0].code}, code ${p.code.coding[0].code}, performed ${p.performedDateTime}`);
  check('procedure-usedCode', JSON.stringify(p.usedCode.map((u) => u.coding?.[0]?.code ?? `text:${u.text}`)) === JSON.stringify(['anaemia-surgery', 'iv-iron', 'iron-diet', 'text:Hospital PBM fact sheet']),
    p.usedCode.map((u) => u.text).join(' | '));
  check('procedure-no-reason-to-servicerequest', !p.reasonReference, 'R4 Procedure.reasonReference cannot reference a ServiceRequest (Meld: HAPI-0931)');
  const m = comm.resource;
  check('communication-medium-multiple', JSON.stringify(m.medium.map((x) => x.coding[0].code)) === JSON.stringify(['FACE', 'WRITTEN', 'EMAILWRIT']) && m.medium.every((x) => x.coding.length === 1),
    `${m.medium.length} media: ${m.medium.map((x) => x.text).join(', ')}`);
  check('communication-payload-multiple', m.payload.length === 4 && m.payload[3].contentString === 'Hospital PBM fact sheet', m.payload.map((x) => x.contentString).join(' | '));
  check('communication-links', m.partOf[0].reference === proc.fullUrl && m.about[0].reference === 'ServiceRequest/soln-A8-patient-1-surgery' && m.sent === '2026-10-28' && m.category[0].coding[0].code === 'instruction',
    `partOf ${m.partOf[0].reference} (= Procedure fullUrl), about ${m.about[0].reference}, sent ${m.sent}`);
  check('communication-not-counted-by-b3', !JSON.stringify(m.category).includes('409073007') && !JSON.stringify(m.category).includes('311401005'), 'Communication.category is HL7 "instruction", so B3 counts the session once (the Procedure)');
  const b1 = await run(qrs.single);
  const m1 = b1.entry.find((e) => e.resource.resourceType === 'Communication').resource;
  const p1 = b1.entry.find((e) => e.resource.resourceType === 'Procedure').resource;
  check('extract-single', m1.medium.length === 1 && m1.medium[0].coding[0].code === 'PHONE' && !m1.payload && !p1.usedCode && !p1.note,
    `1 medium, no payload/usedCode/note: ${JSON.stringify(m1.medium)}`);
  const b0 = await run(qrs.none);
  check('extract-none', b0.entry.length === 0, `${b0.entry.length} entries with no delivery method`);
}

// --- 4. every FHIRPath expression evaluated -----------------------------------------------------
for (const q of [module_, standalone]) {
  const all = allExpressions(q);
  const isTemplate = (x) => !x.url.includes('Expression') && !x.url.endsWith('/variable');
  const missed = all.filter((x) => !evaluated.has(x.expression) && (extractLib || !isTemplate(x))
    && !(BASE === 'offline' && x.language === 'application/x-fhir-query'));
  check(`all-expressions-${q.id}`, missed.length === 0, missed.length ? `not evaluated: ${missed.map((x) => x.expression).join(' ; ')}` : `${all.length} evaluated`);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
