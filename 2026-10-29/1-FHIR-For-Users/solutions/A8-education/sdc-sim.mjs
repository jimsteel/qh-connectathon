// A small SDC form simulator for verify.mjs: builds a QuestionnaireResponse from a Questionnaire
// and a set of entered answers, evaluating root variables, calculatedExpressions, enableWhen and
// enableWhenExpression with fhirpath.js (R4 model) the way Smart Forms does (iterating until the
// calculated answers stop changing; disabled items are left out of the response).
//
// Module resolution: fhirpath (and optionally @aehrc/sdc-template-extract) are looked up in
// ./node_modules, ../../decks/node_modules and every NODE_PATH entry.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEARCH = [join(HERE, 'node_modules'), resolve(HERE, '../../decks/node_modules'),
  ...(process.env.NODE_PATH || '').split(':').filter(Boolean)];

export function load(name) {
  for (const dir of SEARCH) {
    if (existsSync(join(dir, ...name.split('/')))) return createRequire(join(dir, 'noop.js'))(name);
  }
  return null;
}

export const fhirpath = load('fhirpath');
export const r4 = load('fhirpath/fhir-context/r4');
if (!fhirpath || !r4) throw new Error(`fhirpath not found in ${SEARCH.join(', ')}`);

const SDC = 'http://hl7.org/fhir/uv/sdc/StructureDefinition';
const VAR = 'http://hl7.org/fhir/StructureDefinition/variable';
const extOf = (n, url) => (n.extension || []).filter((e) => e.url === url);
const exprOf = (n, name) => extOf(n, `${SDC}/sdc-questionnaire-${name}`)[0]?.valueExpression?.expression;

// Every expression evaluated, so verify.mjs can check that none was missed.
export const evaluated = new Set();

export function evaluate(base, expr, env) {
  evaluated.add(expr);
  return fhirpath.evaluate(base, expr, env, r4);
}

const valueKey = { decimal: 'valueDecimal', integer: 'valueInteger', string: 'valueString', text: 'valueString',
  boolean: 'valueBoolean', date: 'valueDate', dateTime: 'valueDateTime', choice: 'valueCoding' };

function toAnswers(type, values) {
  return values.map((v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('value'))) return v;
    if (type === 'integer') v = Math.round(Number(v));
    if (type === 'decimal' && typeof v === 'number') v = Number(v.toFixed(10));
    if (v && typeof v === 'object' && type === 'string') v = String(v);
    return { [valueKey[type]]: v };
  });
}

function enableWhenOk(item, qr) {
  if (!item.enableWhen) return true;
  const results = item.enableWhen.map((ew) => {
    const answers = findAll(qr, ew.question).flatMap((i) => i.answer || []);
    const key = Object.keys(ew).find((k) => k.startsWith('answer'));
    const want = ew[key];
    if (ew.operator === 'exists') return (answers.length > 0) === want;
    const vals = answers.map((a) => a[Object.keys(a).find((k) => k.startsWith('value'))]);
    const eq = vals.some((v) => (typeof want === 'object' ? v?.code === want.code && v?.system === want.system : v === want));
    return ew.operator === '=' ? eq : !eq;
  });
  return item.enableBehavior === 'any' ? results.some(Boolean) : results.every(Boolean);
}

function findAll(node, linkId, out = []) {
  for (const i of node.item || []) {
    if (i.linkId === linkId) out.push(i);
    findAll(i, linkId, out);
  }
  return out;
}

// Build the response. `entered`: { linkId: [values] } for answers the user (or prepopulation) gave.
export function buildResponse(q, entered, { patientRef = 'Patient/soln-test', env: extraEnv = {} } = {}) {
  const calculated = {};
  let qr;
  for (let pass = 0; pass < 20; pass++) {
    qr = { resourceType: 'QuestionnaireResponse', status: 'in-progress', subject: { reference: patientRef }, item: [] };
    const fill = (items, target) => {
      for (const it of items) {
        if (it.type === 'display') continue;
        const node = { linkId: it.linkId, text: it.text };
        if (it.type === 'group') {
          node.item = [];
          fill(it.item || [], node);
          if (node.item.length) target.item.push(node);
          continue;
        }
        const vals = it.linkId in calculated ? calculated[it.linkId]
          : it.linkId in entered ? entered[it.linkId]
            : (it.initial || []).map((x) => x);
        if (vals && vals.length) node.answer = toAnswers(it.type, vals);
        if (node.answer) target.item.push(node);
      }
    };
    fill(q.item, qr);
    // drop disabled items (enableWhen / enableWhenExpression)
    const env = { ...extraEnv, resource: qr, ...rootVars(q, qr, extraEnv) };
    const prune = (items, qNode) => {
      for (const it of items) {
        const qi = findQ(q, it.linkId);
        const ewe = exprOf(qi, 'enableWhenExpression');
        const on = enableWhenOk(qi, qr) && (!ewe || evaluate(qr, ewe, env)[0] === true);
        if (!on) qNode.item = qNode.item.filter((x) => x !== it);
        else if (it.item) prune([...it.item], it);
      }
    };
    prune([...qr.item], qr);
    // recalculate
    const env2 = { ...extraEnv, resource: qr, ...rootVars(q, qr, extraEnv) };
    let changed = false;
    walkQ(q.item, (it) => {
      const ce = exprOf(it, 'calculatedExpression');
      if (!ce) return;
      const res = evaluate(qr, ce, env2);
      const prev = JSON.stringify(calculated[it.linkId] ?? []);
      calculated[it.linkId] = res;
      if (JSON.stringify(res) !== prev) changed = true;
    });
    if (!changed) return { qr, env: env2 };
  }
  throw new Error('calculatedExpressions did not converge');
}

export function rootVars(q, qr, extraEnv = {}) {
  const env = { ...extraEnv, resource: qr };
  for (const v of extOf(q, VAR)) {
    const { name, expression, language } = v.valueExpression;
    if (language !== 'text/fhirpath') continue;
    env[name] = evaluate(qr, expression, env);
  }
  delete env.resource;
  return env;
}

export function walkQ(items, fn) {
  for (const it of items || []) { fn(it); walkQ(it.item, fn); }
}

export function findQ(q, linkId) {
  let found;
  walkQ(q.item, (it) => { if (it.linkId === linkId) found = it; });
  return found;
}

export function answerOf(qr, linkId) {
  const a = findAll(qr, linkId).flatMap((i) => i.answer || []);
  return a.map((x) => x[Object.keys(x).find((k) => k.startsWith('value'))]);
}

// Every FHIRPath expression in a Questionnaire, with where it sits.
export function allExpressions(q) {
  const out = [];
  (function walk(n, path) {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!n || typeof n !== 'object') return;
    if (n.valueExpression?.expression) out.push({ path, url: n.url, language: n.valueExpression.language, expression: n.valueExpression.expression });
    if (typeof n.url === 'string' && /templateExtract(Value|Context)$/.test(n.url)) out.push({ path, url: n.url, language: 'text/fhirpath', expression: n.valueString });
    if (n.url === 'fullUrl' && n.valueString) out.push({ path, url: 'fullUrl', language: 'text/fhirpath', expression: n.valueString });
    for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  })(q, 'Questionnaire');
  return out;
}

// Substitute {{%patient.id}} and encode | for a Meld x-fhir-query.
export async function runQuery(base, q, patientId) {
  const url = `${base}/${q.replace('{{%patient.id}}', patientId).replace(/\|/g, '%7C')}`;
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}
