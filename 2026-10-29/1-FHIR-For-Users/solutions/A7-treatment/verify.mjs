#!/usr/bin/env node
// Verify the A7 solution: structure, every FHIRPath expression (fhirpath.js, R4 model), the Ganzoni
// numbers against an independent implementation, prepopulation from the test patient on Meld, and
// template extraction with @aehrc/sdc-template-extract (the library inside Smart Forms), if installed.
//
//   node verify.mjs [base]          (default base: the Meld open endpoint; "offline" skips Meld)
//
// Needs fhirpath (found in ../../decks/node_modules). For the extraction checks:
//   npm install --no-save @aehrc/sdc-template-extract@1.0.16     (in this folder; don't commit node_modules)
// Prepopulation needs the test patient: load test-data.json first (see README).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allExpressions, answerOf, buildResponse, evaluate, evaluated, findQ, load, runQuery, walkQ } from './sdc-sim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || 'https://gw.interop.community/QHConnectathon2026/open').replace(/\/$/, '');
const read = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const module_ = read('soln-pam-treatment.json');
const standalone = read('soln-A7-standalone.json');
const root = read('../../questionnaires/pam-root.json');

let failures = 0;
const pass = (id, msg = '') => console.log(`PASS ${id}  ${msg}`);
const fail = (id, msg) => { failures++; console.log(`FAIL ${id}  ${msg}`); };
const check = (id, ok, msg) => (ok ? pass(id, msg) : fail(id, msg));
const near = (a, b) => (a === undefined || b === undefined ? a === b : Math.abs(a - b) < 1e-6);

// --- 1. structure and conventions -------------------------------------------------------------
const SOLN = 'https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire';
check('module-id', module_.id === 'soln-pam-treatment' && module_.url === `${SOLN}/pam-treatment` && module_.version === '0.2.0', module_.url);
check('standalone-id', standalone.id === 'soln-A7-standalone' && standalone.url === `${SOLN}/A7-standalone`, standalone.url);
const top = module_.item[0];
check('top-group', module_.item.length === 1 && top.linkId === 'pam-treatment' && top.type === 'group', top.linkId);
const modItem = top.item[0];
check('module-item', modItem.linkId === 'pam-treatment-module' && modItem.extension?.some((e) => e.url.endsWith('questionnaire-hidden')) && modItem.initial?.length === 1, modItem.initial?.[0]?.valueString);
const linkIds = [];
walkQ(standalone.item, (it) => linkIds.push(it.linkId));
check('linkids-unique', new Set(linkIds).size === linkIds.length, `${linkIds.length} linkIds`);
check('linkids-prefix', linkIds.every((l) => l.startsWith('pam-')), 'all start with pam-');
const modLinkIds = []; walkQ(module_.item, (it) => modLinkIds.push(it.linkId));
const kept = ['pam-ganzoni-intro', 'pam-ideal-weight', 'pam-dosing-weight', 'pam-ganzoni', 'pam-iv-iron', 'pam-iron-product', 'pam-iron-dose'];
check('extends-0.1.0', kept.every((l) => modLinkIds.includes(l)), `keeps the 0.1.0 linkIds ${kept.join(', ')}`);
// Shared root variable names used by the module exist in the 0.1.0 root
const rootNames = new Set(root.extension.filter((e) => e.valueExpression).map((e) => e.valueExpression.name));
const used = new Set([...JSON.stringify(module_).matchAll(/%([a-zA-Z]+)/g)].map((m) => m[1]));
const sdcBuiltins = new Set(['resource', 'patient', 'user', 'ivIronOrderId', 'context']);
const missingVars = [...used].filter((n) => !rootNames.has(n) && !sdcBuiltins.has(n));
check('root-variables', missingVars.length === 0, missingVars.length ? `not on the root: ${missingVars}` : `uses root variables ${[...used].filter((n) => rootNames.has(n)).join(', ')}`);
walkQ(standalone.item, (it) => (it.enableWhen || []).forEach((ew) => check(`enableWhen-${it.linkId}`, linkIds.includes(ew.question), `-> ${ew.question}`)));

// --- 2. Ganzoni against an independent implementation ------------------------------------------
// Reference: NBA (2016) Ganzoni; Devine IBW; dosing weight = IBW if actual > IBW else actual;
// target 150 / stores 500 (130 / 15 mg/kg under 35 kg actual); per-infusion caps from the AU PIs.
function reference({ sex, height, weight, hb, product, manual }) {
  const ibw = height === undefined ? undefined : (sex === 'male' ? 50 : 45.5) + 0.9 * (height - 152.4);
  const dw = ibw !== undefined && ibw < weight ? ibw : weight;
  const target = weight < 35 ? 130 : 150;
  const stores = weight < 35 ? 15 * dw : 500;
  const deficit = Math.round(dw * Math.max(0, target - hb) * 0.24 + stores);
  const suggested = Math.round(deficit / 100) * 100;
  const dose = manual ?? suggested;
  const cap = product === 'fcm' ? Math.min(1000, Math.floor(20 * dw)) : Math.min(1500, Math.floor(20 * dw));
  const n = Math.ceil(dose / cap);
  const doses = Array.from({ length: Math.min(n, 3) }, (_, k) => Math.min(cap, dose - k * cap));
  return { ibw, dw, target, stores, deficit, suggested, dose, cap, n, doses };
}
const PRODUCTS = {
  fcm: { system: 'http://snomed.info/sct', code: '1312141000168105', display: 'Iron (as ferric carboxymaltose) 1 g/20 mL injection, vial' },
  fdi: { system: 'http://snomed.info/sct', code: '1086251000168104', display: 'Iron (as ferric derisomaltose) 100 mg/mL injection, vial' },
};
const IV = { system: 'http://snomed.info/sct', code: '718520009', display: 'Intravenous iron infusion' };
const CASES = [
  { id: 'test-patient', sex: 'female', height: 160, weight: 82, hb: 98, product: 'fcm', note: 'overweight: IBW; split 1000 + 200' },
  { id: 'below-ibw', sex: 'male', height: 180, weight: 70, hb: 110, product: 'fdi', note: 'actual weight below IBW; one infusion' },
  { id: 'hb-above-target', sex: 'male', height: 175, weight: 80, hb: 152, product: 'fcm', note: 'non-anaemic iron deficiency: stores only (0.1.0 gave 0)' },
  { id: 'no-height', sex: 'female', weight: 60, hb: 100, product: 'fcm', note: 'no height: actual weight' },
  { id: 'under-35kg', sex: 'female', height: 140, weight: 33, hb: 90, product: 'fcm', note: '<35 kg: target 130, stores 15 mg/kg, cap 20 mg/kg' },
  { id: 'override-3-infusions', sex: 'male', height: 190, weight: 120, hb: 80, product: 'fcm', manual: 2500, note: 'manual dose above deficit: warning, 3 infusions' },
  { id: 'override-4-infusions', sex: 'female', height: 165, weight: 70, hb: 90, product: 'fcm', manual: 3500, note: 'four infusions: note to plan by hand' },
  { id: 'fdi-cap-1500', sex: 'male', height: 185, weight: 100, hb: 85, product: 'fdi', note: 'derisomaltose capped at 1500' },
];

function entered(c) {
  const e = { 'pam-sex': [{ system: 'http://hl7.org/fhir/administrative-gender', code: c.sex, display: c.sex }],
    'pam-weight': [c.weight], 'pam-hb': [c.hb], 'pam-tx-plan': [IV], 'pam-iron-product': [PRODUCTS[c.product]],
    'pam-infusion-date': ['2026-11-03'], 'pam-infusion-notes': ['Prefers mornings'],
    'pam-iron-prescriber': ['Megan Hart'], 'pam-iron-prescriber-ref': ['Practitioner/pam-nurse-1'] };
  if (c.height !== undefined) e['pam-height'] = [c.height];
  if (c.manual !== undefined) { e['pam-iron-dose-override'] = [true]; e['pam-iron-dose-manual'] = [c.manual]; }
  return e;
}

const responses = {};
for (const c of CASES) {
  const ref = reference(c);
  const { qr, env } = buildResponse(standalone, entered(c), { env: { ivIronOrderId: ['00000000-0000-4000-8000-000000000001'] } });
  responses[c.id] = qr;
  const a = (l) => answerOf(qr, l)[0];
  const got = { dw: a('pam-dosing-weight'), target: a('pam-target-hb'), stores: a('pam-iron-stores'), deficit: a('pam-ganzoni'),
    suggested: a('pam-ganzoni-rounded'), dose: a('pam-iron-dose'), cap: a('pam-iron-max-infusion'), n: a('pam-iron-infusions'),
    doses: [1, 2, 3].map((k) => a(`pam-iron-dose-${k}`)).filter((x) => x !== undefined) };
  const want = { dw: Math.round(ref.dw * 10) / 10, target: ref.target, stores: Math.round(ref.stores), deficit: ref.deficit,
    suggested: ref.suggested, dose: ref.dose, cap: ref.cap, n: ref.n, doses: ref.doses };
  const bad = Object.keys(want).filter((k) => (Array.isArray(want[k]) ? JSON.stringify(want[k]) !== JSON.stringify(got[k]) : !near(got[k], want[k])));
  check(`ganzoni-${c.id}`, bad.length === 0, bad.length ? `mismatch ${bad.map((k) => `${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`).join('; ')}`
    : `${c.note}: deficit ${got.deficit} mg -> ${got.dose} mg as ${got.doses.join(' + ')} (dosing wt ${got.dw} kg)`);
  const warning = evaluate(qr, findQ(standalone, 'pam-iron-dose-warning').extension[0].valueExpression.expression, env)[0] === true;
  check(`warning-${c.id}`, warning === (ref.dose > ref.suggested), `dose-above-deficit warning ${warning ? 'shown' : 'hidden'}`);
  const missing = evaluate(qr, findQ(standalone, 'pam-tx-inputs-missing').extension[0].valueExpression.expression, env)[0] === true;
  const many = evaluate(qr, findQ(standalone, 'pam-iron-infusions-warning').extension[0].valueExpression.expression, env)[0] === true;
  check(`many-infusions-${c.id}`, many === (ref.n > 3), `more-than-3-infusions note ${many ? 'shown' : 'hidden'}`);
  check(`inputs-missing-${c.id}`, missing === (c.height === undefined), `missing-inputs note ${missing ? 'shown' : 'hidden'}`);
}
// IV iron order and booking hidden unless the plan includes IV iron
{
  const e = entered(CASES[0]); e['pam-tx-plan'] = [{ system: 'http://snomed.info/sct', code: '438911000124105' }];
  const { qr } = buildResponse(standalone, e);
  check('enableWhen-plan', answerOf(qr, 'pam-iron-product').length === 0 && answerOf(qr, 'pam-infusion-date').length === 0, 'oral iron only: no IV order, no booking in the response');
}

// --- 3. prepopulation from the test patient on Meld ---------------------------------------------
if (BASE !== 'offline') {
  try {
    const pid = 'soln-A7-patient-1';
    const patient = await (await fetch(`${BASE}/Patient/${pid}`, { headers: { Accept: 'application/fhir+json' } })).json();
    if (patient.resourceType !== 'Patient') throw new Error(`no ${pid} on ${BASE} (load test-data.json)`);
    // user launch context (the Prescriber items): a Practitioner from the starter data
    const user = await (await fetch(`${BASE}/Practitioner/pam-nurse-1`, { headers: { Accept: 'application/fhir+json' } })).json();
    const env = { patient: [patient], user: [user] };
    for (const v of standalone.item[0].extension.filter((x) => x.valueExpression.language === 'application/x-fhir-query')) {
      env[v.valueExpression.name] = [await runQuery(BASE, v.valueExpression.expression, pid)];
      evaluated.add(v.valueExpression.expression);
    }
    const got = {};
    walkQ(standalone.item, (it) => {
      const ie = it.extension?.find((x) => x.url.endsWith('initialExpression'));
      if (ie) got[it.linkId] = evaluate(patient, ie.valueExpression.expression, env)[0];
    });
    const want = { 'pam-name': 'Iris Ganzonitest', 'pam-sex': 'female', 'pam-height': 160, 'pam-weight': 82, 'pam-hb': 98, 'pam-hb-date': '2026-10-20', 'pam-iron-prescriber': 'Megan Hart', 'pam-iron-prescriber-ref': 'Practitioner/pam-nurse-1' };
    const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
    check('prepopulation', bad.length === 0, bad.length ? `got ${JSON.stringify(got)}` : JSON.stringify(got));
  } catch (e) { fail('prepopulation', e.message); }
}

// --- 4. template extraction ---------------------------------------------------------------------
const extractLib = load('@aehrc/sdc-template-extract');
if (!extractLib) {
  console.log('SKIP extraction  (npm install --no-save @aehrc/sdc-template-extract@1.0.16)');
} else {
  const run = async (qr) => {
    const out = await extractLib.inAppExtract(structuredClone(qr), standalone, null);
    if (!out.extractSuccess) throw new Error(JSON.stringify(out.extractResult));
    return out.extractResult.extractedBundle;
  };
  // template expressions, evaluated against the response, so section 5 sees them
  const qr = responses['test-patient'];
  for (const x of allExpressions(standalone).filter((x) => x.url !== 'http://hl7.org/fhir/StructureDefinition/variable' && !x.url.includes('Expression'))) {
    try { evaluate(qr, x.expression, { resource: qr, ivIronOrderId: ['00000000-0000-4000-8000-000000000001'] }); } catch (e) { fail('template-expr', `${x.expression}: ${e.message}`); }
  }
  const bundle = await run(qr);
  const mr = bundle.entry.find((e) => e.resource.resourceType === 'MedicationRequest');
  const sr = bundle.entry.find((e) => e.resource.resourceType === 'ServiceRequest');
  check('extract-entries', bundle.entry.length === 2 && mr && sr, bundle.entry.map((e) => `${e.request.method} ${e.request.url}`).join(', '));
  const m = mr?.resource;
  check('extract-medication', m?.medicationCodeableConcept?.coding?.[0]?.code === '1312141000168105' && m.status === 'active' && m.intent === 'order' && m.subject?.reference === 'Patient/soln-test',
    JSON.stringify(m?.medicationCodeableConcept));
  const doses = (m?.dosageInstruction || []).map((d) => `${d.sequence}:${d.doseAndRate?.[0]?.doseQuantity?.value}${d.doseAndRate?.[0]?.doseQuantity?.code}`);
  check('extract-dosage', JSON.stringify(doses) === JSON.stringify(['1:1000mg', '2:200mg']), `${doses.join(', ')}; "${m?.dosageInstruction?.[1]?.text}"`);
  // AU Core MedicationRequest.requester (1..1): the Prescriber items (pre-populated from %user)
  check('extract-requester', m?.requester?.reference === 'Practitioner/pam-nurse-1' && m.requester.display === 'Megan Hart'
    && sr?.resource?.requester?.reference === 'Practitioner/pam-nurse-1', JSON.stringify(m?.requester));
  {
    const e = entered(CASES[0]); delete e['pam-iron-prescriber-ref']; e['pam-iron-prescriber'] = ['Dr Typed Name'];
    const b = await run(buildResponse(standalone, e).qr);
    const r = b.entry.find((x) => x.resource.resourceType === 'MedicationRequest').resource.requester;
    check('extract-requester-typed', r?.display === 'Dr Typed Name' && !r.reference, `no launch user: ${JSON.stringify(r)}`);
  }
  check('extract-note', /^Total iron dose 1200 mg \(Ganzoni total iron deficit 1153 mg/.test(m?.note?.[0]?.text || ''), m?.note?.[0]?.text);
  const s = sr?.resource;
  check('extract-servicerequest', s?.code?.coding?.[0]?.code === '718520009' && s.occurrenceDateTime === '2026-11-03' && s.priority === 'routine' && s.quantityQuantity?.value === 2,
    `${s?.code?.coding?.[0]?.display}, ${s?.occurrenceDateTime}, ${s?.priority}, ${s?.quantityQuantity?.value} ${s?.quantityQuantity?.unit}`);
  check('extract-sr-notes', s?.note?.length === 2 && s.note[1].text === 'Prefers mornings' && s.note[0].text.startsWith('Iron (as ferric carboxymaltose)'), (s?.note || []).map((n) => n.text).join(' || '));
  check('extract-basedOn', s?.basedOn?.[0]?.reference && s.basedOn[0].reference === mr.fullUrl && mr.fullUrl.startsWith('urn:uuid:'), `${s?.basedOn?.[0]?.reference} = MedicationRequest fullUrl`);
  // one infusion: no second dosage; three infusions: three
  const b1 = await run(responses['below-ibw']);
  const d1 = b1.entry.find((e) => e.resource.resourceType === 'MedicationRequest').resource.dosageInstruction;
  check('extract-one-infusion', d1.length === 1 && d1[0].doseAndRate[0].doseQuantity.value === 1200, `${d1.length} dosage: ${d1[0].text}`);
  const b3 = await run(responses['override-3-infusions']);
  const d3 = b3.entry.find((e) => e.resource.resourceType === 'MedicationRequest').resource.dosageInstruction;
  check('extract-three-infusions', d3.map((d) => d.doseAndRate[0].doseQuantity.value).join('+') === '1000+1000+500', d3.map((d) => d.text).join(' | '));
  // no product chosen, no date: nothing extracted
  const e0 = entered(CASES[0]); delete e0['pam-iron-product']; delete e0['pam-infusion-date'];
  const b0 = await run(buildResponse(standalone, e0).qr);
  check('extract-nothing-ordered', b0.entry.length === 0, `${b0.entry.length} entries when no product and no date`);
  // booking without an order: ServiceRequest with no basedOn
  const e2 = entered(CASES[0]); delete e2['pam-iron-product'];
  const b2 = await run(buildResponse(standalone, e2).qr);
  check('extract-booking-only', b2.entry.length === 1 && !b2.entry[0].resource.basedOn, `${b2.entry.map((e) => e.resource.resourceType)}; basedOn ${JSON.stringify(b2.entry[0]?.resource.basedOn)}`);
}

// --- 5. every FHIRPath expression evaluated -----------------------------------------------------
for (const q of [module_, standalone]) {
  const all = allExpressions(q).filter((x) => x.language === 'text/fhirpath' || x.language === 'application/x-fhir-query');
  const missed = all.filter((x) => !evaluated.has(x.expression));
  const isTemplate = (x) => !x.url.includes('Expression') && !x.url.endsWith('/variable');
  const isPrepop = (x) => x.url.endsWith('initialExpression') || x.language === 'application/x-fhir-query';
  const skipped = missed.filter((x) => (!extractLib && isTemplate(x)) || (BASE === 'offline' && isPrepop(x)));
  const realMiss = missed.filter((x) => !skipped.includes(x));
  check(`all-expressions-${q.id}`, realMiss.length === 0, realMiss.length ? `not evaluated: ${realMiss.map((x) => x.path).join(', ')}`
    : `${all.length - skipped.length} of ${all.length} evaluated${skipped.length ? ` (${skipped.length} skipped: template expressions need the extract library, prepopulation needs Meld)` : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
