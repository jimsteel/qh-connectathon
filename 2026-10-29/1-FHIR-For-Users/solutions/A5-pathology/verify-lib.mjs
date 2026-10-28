// Shared by A5-pathology/verify.mjs and A6-diagnosis/verify.mjs: fhirpath.js (R4 model) from
// decks/node_modules, an offline FHIR search over a test-data bundle (or live on Meld with --live),
// an inventory of every FHIRPath expression in a Questionnaire, and PASS/FAIL bookkeeping.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const DECKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../decks');
const require = createRequire(path.join(DECKS, 'package.json'));
export const fhirpath = require('fhirpath');
export const r4 = require('fhirpath/fhir-context/r4');
export const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
export const LIVE = process.argv.includes('--live');

let failures = 0;
let passes = 0;
export const pass = (id, msg = '') => { passes++; console.log(`PASS ${id}${msg ? `  ${msg}` : ''}`); };
export const fail = (id, msg) => { failures++; console.log(`FAIL ${id}  ${msg}`); };
export const show = (v) => JSON.stringify(v);
export function check(id, actual, expected) {
  // fhirpath.js returns decimals as JS numbers; compare as JSON
  isDeepStrictEqual(JSON.parse(JSON.stringify(actual)), expected)
    ? pass(id, show(actual).slice(0, 160)) : fail(id, `expected ${show(expected)}\n       got      ${show(actual)}`);
}
export function finish() {
  console.log(failures ? `\n${failures} failure(s), ${passes} passed` : `\nall ${passes} checks passed`);
  process.exit(failures ? 1 : 0);
}

// --- Expressions ------------------------------------------------------------------------------------
const EXPR_URLS = {
  'http://hl7.org/fhir/StructureDefinition/variable': 'variable',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression': 'initial',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression': 'calculated',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-enableWhenExpression': 'enableWhen',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-itemPopulationContext': 'populationContext',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtractValue': 'templateValue',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtractContext': 'templateContext',
};
// Every expression in a Questionnaire: {kind, language, expression, name?, linkId?, where}
export function inventory(q) {
  const out = [];
  (function walk(node, where, linkId) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, where, linkId));
    if (!node || typeof node !== 'object') return;
    const lid = node.linkId ?? linkId;
    const w = node.resourceType && node.id ? `${node.resourceType}/${node.id}` : where;
    const kind = EXPR_URLS[node.url];
    if (kind) {
      const ve = node.valueExpression;
      out.push(ve ? { kind, language: ve.language, expression: ve.expression, name: ve.name, linkId: lid, where: w }
        : { kind, language: 'text/fhirpath', expression: node.valueString, linkId: lid, where: w });
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'url') walk(v, w, lid);
  })(q, q.id, undefined);
  return out;
}

// Track which expressions were evaluated, to report any that verify.mjs never ran.
const evaluated = new Set();
export function evaluate(base, expression, env = {}, basePath) {
  evaluated.add(expression);
  const input = basePath ? { base: basePath, expression } : expression;
  return fhirpath.evaluate(base, input, env, r4);
}
export function coverage(q) {
  const missing = inventory(q).filter((e) => e.language === 'text/fhirpath' && !evaluated.has(e.expression));
  missing.length
    ? fail(`coverage ${q.id}`, `not evaluated: ${missing.map((m) => `${m.kind} ${m.name ?? m.linkId}`).join('; ')}`)
    : pass(`coverage ${q.id}`, `every FHIRPath expression evaluated (${inventory(q).filter((e) => e.language === 'text/fhirpath').length})`);
}

// --- Search ------------------------------------------------------------------------------------------
const dateOf = (r) => r.effectiveDateTime ?? r.authoredOn ?? r.occurrenceDateTime ?? '';
// Offline: the subset of FHIR search the x-fhir-queries use (code with system|code lists, patient,
// status, _sort=-date / -authoredon, _count) over the resources of a transaction bundle.
export function searchOffline(resources, q) {
  const [type, qs] = q.split('?');
  const p = new URLSearchParams(qs);
  let rs = resources.filter((r) => r.resourceType === type);
  if (p.get('patient')) rs = rs.filter((r) => (r.subject ?? r.patient)?.reference === `Patient/${p.get('patient')}`);
  if (p.get('status')) rs = rs.filter((r) => r.status === p.get('status'));
  if (p.get('code')) {
    const want = p.get('code').split(',');
    rs = rs.filter((r) => r.code?.coding?.some((c) => want.includes(`${c.system}|${c.code}`) || want.includes(c.code)));
  }
  if (p.get('_sort')?.startsWith('-')) rs = [...rs].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  if (p.get('_count')) rs = rs.slice(0, +p.get('_count'));
  return { resourceType: 'Bundle', type: 'searchset', total: rs.length, entry: rs.map((resource) => ({ resource })) };
}
export async function searchLive(q) {
  const res = await fetch(`${OPEN}/${q.replaceAll('|', '%7C')}`, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${q} -> HTTP ${res.status}`);
  const b = await res.json();
  for (const e of b.entry ?? []) delete e.resource.meta;
  return b;
}
// Run every x-fhir-query variable of a Questionnaire for a patient -> { name: Bundle }
export async function runQueries(q, patientId, resources, live = LIVE) {
  const env = {};
  for (const e of inventory(q).filter((x) => x.language === 'application/x-fhir-query')) {
    const query = e.expression.replace('{{%patient.id}}', patientId);
    env[e.name] = live ? await searchLive(query) : searchOffline(resources, query);
  }
  return env;
}

// Build a QuestionnaireResponse with the given answers (linkId -> [value[x] objects]), nested as in the
// Questionnaire (repeating groups: pass an array of answer maps under the group's linkId).
export function buildQr(q, answers, subject) {
  function items(qItems, ans) {
    const out = [];
    for (const qi of qItems ?? []) {
      if (qi.type === 'group') {
        const reps = Array.isArray(ans[qi.linkId]) ? ans[qi.linkId] : [ans];
        for (const rep of reps) {
          const children = items(qi.item, rep);
          if (children.length) out.push({ linkId: qi.linkId, text: qi.text, item: children });
        }
      } else if (qi.type !== 'display' && ans[qi.linkId] !== undefined) {
        out.push({ linkId: qi.linkId, text: qi.text, answer: [].concat(ans[qi.linkId]) });
      }
    }
    return out;
  }
  return { resourceType: 'QuestionnaireResponse', status: 'in-progress', subject: { reference: subject },
    item: items(q.item, answers) };
}

export function findItem(q, linkId) {
  let found;
  (function walk(items) { for (const i of items ?? []) { if (i.linkId === linkId) found = i; walk(i.item); } })(q.item);
  return found;
}
export const ext = (node, suffix) => (node.extension ?? []).filter((e) => e.url.endsWith(suffix));
export const exprOf = (node, suffix) => ext(node, suffix)[0]?.valueExpression?.expression;
