#!/usr/bin/env node
// Verify the assembled PAM form (soln-pam-assembled.json) with fhirpath.js (R4 model).
//
//   node verify.mjs            # offline: x-fhir-query results from fixtures-xfhirquery.json
//   node verify.mjs --live     # run the x-fhir-queries against Meld (test data loaded) and
//                              # refresh the fixtures
//
// Run from anywhere; fhirpath is resolved from ../../decks/node_modules. Prints PASS/FAIL per check
// and exits 1 on any FAIL. Checks:
//   structure   unique linkIds; every enableWhen.question and every linkId='…' an expression reads
//               exists; every "#id" reference (template, answerValueSet) resolves to a contained
//               resource; contained ids unique; the root's variables / extractAllocateIds are in the
//               assembled form; each module's item tree is in the assembled form unchanged (apart from
//               the documented linkId renames)
//   variables   every %name used is defined in scope: built-in, root variable, extractAllocateId, or
//               a variable / population context on the item or an ancestor (templates: the scope of
//               the item that references them)
//   FHIRPath    every expression parses, and evaluates without error against realistic data: the
//               QuestionnaireResponse the playground pre-populated for soln-A10-patient-1
//               (playground-results/qr-prepopulated.json), the test Patient, and the real
//               x-fhir-query results; templates are evaluated item by item with their
//               templateExtractContext, like the extractor does
//   values      fhirpath.js gives the same answer as the playground for every calculatedExpression
//               and every pre-populated initialExpression (cross-module root variables included)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { MODULES, RENAMES, BUILTINS, prepareModule } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(HERE, '../../decks/package.json'));
const fhirpath = req('fhirpath');
const r4 = req('fhirpath/fhir-context/r4');
const load = (f) => JSON.parse(readFileSync(path.join(HERE, f), 'utf8'));
const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const LIVE = process.argv.includes('--live');
const VERBOSE = process.argv.includes('-v');
const P = 'soln-A10-patient-1';

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };

const Q = load('soln-pam-assembled.json');
const ROOT = load('soln-pam-root.json');
const QR = load('playground-results/qr-prepopulated.json');
const EXT = {
  variable: 'http://hl7.org/fhir/StructureDefinition/variable',
  allocateId: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-extractAllocateId',
  popContext: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-itemPopulationContext',
  templateExtract: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtract',
  tValue: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtractValue',
  tContext: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtractContext',
  calc: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression',
  initial: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression',
};
const allItems = (items, acc = [], parents = []) => {
  for (const i of items || []) { acc.push({ item: i, parents }); allItems(i.item, acc, [...parents, i]); }
  return acc;
};
const ITEMS = allItems(Q.item);
const byLinkId = Object.fromEntries(ITEMS.map((x) => [x.item.linkId, x]));
const usedNames = (s) => [...s.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((n) => !/^[0-9A-F]{2}/.test(n));

// ---------------------------------------------------------------------------------------------
console.log('## Structure');
const ids = ITEMS.map((x) => x.item.linkId);
const dupIds = ids.filter((l, i) => ids.indexOf(l) !== i);
check('linkIds unique', !dupIds.length, `${ids.length} linkIds${dupIds.length ? `; duplicates ${[...new Set(dupIds)]}` : ''}`);

const badEnableWhen = ITEMS.flatMap((x) => (x.item.enableWhen || []).filter((e) => !byLinkId[e.question]).map((e) => `${x.item.linkId} -> ${e.question}`));
check('every enableWhen.question exists', !badEnableWhen.length, badEnableWhen.join(', '));

const allStrings = [];
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (typeof v === 'string') allStrings.push([k, v]); else walk(v); }
})(Q);
const readLinkIds = new Set(allStrings.flatMap(([, s]) => [...s.matchAll(/linkId\s*=\s*'([^']+)'/g)].map((m) => m[1])));
// A11's nurse module reads pam-pa-* items from the patient's own response (the A11 patient form), not this form
const A11 = JSON.parse(readFileSync(path.join(HERE, '../A11-pre-admission/A11-pre-admission.json'), 'utf8'));
const a11Ids = new Set(allItems(A11.item).map((x) => x.item.linkId));
const fromA11 = [...readLinkIds].filter((l) => !byLinkId[l] && l.startsWith('pam-pa-'));
const missingRead = [...readLinkIds].filter((l) => !byLinkId[l] && !(l.startsWith('pam-pa-') && a11Ids.has(l)));
check("every linkId='…' read by an expression exists", !missingRead.length, `${readLinkIds.size} linkIds read (${fromA11.length} of them pam-pa-* items of the A11 patient form, all found there)${missingRead.length ? `; missing ${missingRead}` : ''}`);
for (const r of RENAMES) check(`renamed ${r.from} -> ${r.to}: nothing reads the old linkId expecting the ${r.module} item`, !!byLinkId[r.to] && byLinkId[r.from]?.parents[1]?.linkId !== `pam-${r.module}`);

const containedIds = (Q.contained || []).map((c) => c.id);
check('contained ids unique', new Set(containedIds).size === containedIds.length, `${containedIds.length} contained`);
const refs = allStrings.filter(([k, v]) => (k === 'reference' || k === 'answerValueSet') && v.startsWith('#')).map(([, v]) => v.slice(1));
const unresolved = refs.filter((r) => !containedIds.includes(r));
check('every "#id" reference resolves', !unresolved.length, `${refs.length} references${unresolved.length ? `; unresolved ${unresolved}` : ''}`);
const unused = containedIds.filter((c) => !refs.includes(c));
check('every contained resource is used', !unused.length, unused.join(', '));

const rootExt = ROOT.extension.filter((e) => e.url === EXT.variable || e.url === EXT.allocateId);
const lost = rootExt.filter((e) => !Q.extension.some((x) => isDeepStrictEqual(x, e)));
check('root variables and extractAllocateIds carried into the assembled form', !lost.length, `${rootExt.length} extensions${lost.length ? `; lost ${JSON.stringify(lost)}` : ''}`);

// each module's item tree (as in its folder now), unchanged apart from the documented changes (prepareModule)
for (const m of MODULES) {
  const mod = prepareModule(m.key, readFileSync(path.join(HERE, '..', m.file), 'utf8')).q;
  const top = mod.item[0];
  const inQ = Q.item[0].item.find((i) => i.linkId === top.linkId);
  // the assembler moves module-level variables onto the module's top-level group
  const strip = (i) => ({ ...i, extension: (i.extension || []).filter((e) => !(mod.extension || []).some((x) => isDeepStrictEqual(x, e))) });
  check(`${m.scenario} module item tree assembled unchanged (${top.linkId})`, !!inQ && isDeepStrictEqual(strip(inQ), strip(top)));
  for (const c of mod.contained || []) check(`${m.scenario} template ${c.id} carried over unchanged`, isDeepStrictEqual(Q.contained.find((x) => x.id === c.id), c));
}

// ---------------------------------------------------------------------------------------------
// Data: QR from the playground, Patient, x-fhir-query results
const FIXTURES = 'fixtures-xfhirquery.json';
const fixtures = existsSync(path.join(HERE, FIXTURES)) ? load(FIXTURES) : {};
async function getJson(url) {
  if (!LIVE) {
    if (!(url in fixtures)) throw new Error(`no fixture for ${url} (run with --live once, test data loaded)`);
    return fixtures[url];
  }
  const r = await fetch(`${OPEN}/${url.replaceAll('|', '%7C')}${url.includes('?') ? '&' : '?'}_format=json`, { headers: { Accept: 'application/fhir+json' } });
  const j = await r.json();
  const strip = (b) => { if (b.resourceType === 'Bundle') { delete b.meta; delete b.id; delete b.link; for (const e of b.entry || []) delete e.resource.meta; } else delete b.meta; return b; };
  fixtures[url] = strip(j);
  return fixtures[url];
}
const patient = await getJson(`Patient/${P}`);

// QR items by linkId, in document order (first instance used as the item's context)
const qrItems = {};
(function walk(items) {
  for (const i of items || []) { (qrItems[i.linkId] ??= []).push(i); walk(i.item); for (const a of i.answer || []) walk(a.item); }
})(QR.item);

const opts = { model: r4 };
let nExpr = 0; let nNonEmpty = 0; const errors = [];
const evalFp = (ctx, expr, env, where) => {
  nExpr++;
  try {
    const r = fhirpath.evaluate(ctx, expr, { ...env }, r4);
    if (r.length) nNonEmpty++;
    if (VERBOSE) console.log(`  ${where}: ${expr.slice(0, 80)} -> ${JSON.stringify(r).slice(0, 120)}`);
    return r;
  } catch (e) {
    errors.push(`${where}: ${e.message.split('\n')[0]}  [${expr.slice(0, 120)}]`);
    return [];
  }
};
const parseErrors = [];
const fpStrings = [];
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (!n || typeof n !== 'object') return;
  if (n.valueExpression?.expression) fpStrings.push(n.valueExpression.expression);
  if ((n.url === EXT.tValue || n.url === EXT.tContext) && n.valueString) fpStrings.push(n.valueString);
  if (n.url === EXT.templateExtract) for (const s of n.extension || []) if (s.url !== 'template' && s.valueString) fpStrings.push(s.valueString);
  Object.values(n).forEach(walk);
})(Q);
for (const s of fpStrings) {
  // x-fhir-query: the {{ }} parts are FHIRPath
  const exprs = s.includes('{{') ? [...s.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1]) : [s];
  for (const e of exprs) {
    try { fhirpath.parse(e); } catch (err) { parseErrors.push(`${e.slice(0, 80)}: ${err.message.split('\n')[0]}`); }
  }
}

console.log('');
console.log('## Variables in scope and FHIRPath evaluation');
const baseEnv = { resource: QR, rootResource: QR, context: QR, questionnaire: Q, patient, ucum: 'http://unitsofmeasure.org', sct: 'http://snomed.info/sct', loinc: 'http://loinc.org' };
const allocIds = Q.extension.filter((e) => e.url === EXT.allocateId).map((e) => e.valueString);
for (const a of allocIds) baseEnv[a] = `urn:uuid:test-${a}`;
const scopeErrors = [];
const checkScope = (expr, scope, where) => {
  for (const n of usedNames(expr)) if (!BUILTINS.has(n) && !(n in scope)) scopeErrors.push(`${where}: %${n}`);
};

// root variables, in order
const rootEnv = { ...baseEnv };
for (const e of Q.extension.filter((x) => x.url === EXT.variable)) {
  checkScope(e.valueExpression.expression, rootEnv, `root ${e.valueExpression.name}`);
  rootEnv[e.valueExpression.name] = evalFp(QR, e.valueExpression.expression, rootEnv, `root ${e.valueExpression.name}`);
}
if (VERBOSE) console.log(Object.fromEntries(Object.entries(rootEnv).filter(([k]) => !(k in baseEnv))));

const answersOf = (qi) => (qi?.answer || []).map((a) => { const k = Object.keys(a).find((x) => x.startsWith('value')); return k ? a[k] : undefined; });
const same = (fp, qr) => {
  const norm = (v) => (v && typeof v === 'object' ? (v.code ?? v.value ?? JSON.stringify(v)) : v);
  const a = fp.map(norm); const b = qr.map(norm);
  return a.length === b.length && a.every((x, i) => x === b[i] || (typeof x === 'number' && Math.abs(x - b[i]) < 1e-9) || String(x) === String(b[i]));
};
const valueMismatches = []; let nCompared = 0;

async function evalTemplate(node, ctx, env, where) {
  if (Array.isArray(node)) { for (const x of node) await evalTemplate(x, ctx, env, where); return; }
  if (!node || typeof node !== 'object') return;
  let c = ctx;
  for (const [k, v] of Object.entries(node)) {
    if (k !== 'extension' || !Array.isArray(v)) continue;
    for (const e of v) {
      if (e.url === EXT.tContext) {
        checkScope(e.valueString, env, where);
        const r = evalFp(ctx, e.valueString, env, `${where} context`);
        c = r[0] ?? ctx; // evaluate the rest with the first context instance
      }
    }
    for (const e of v) {
      if (e.url === EXT.tValue) { checkScope(e.valueString, env, where); evalFp(c, e.valueString, env, `${where} value`); }
    }
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'extension') await evalTemplate(v, c, env, where);
}

async function evalItem(item, env) {
  const qi = qrItems[item.linkId]?.[0];
  const ctx = qi ?? { linkId: item.linkId };
  const scope = { ...env, context: ctx };
  for (const e of item.extension || []) {
    const ve = e.valueExpression;
    if (!ve) continue;
    const where = `${item.linkId} ${e.url.split('/').pop()}${ve.name ? ` ${ve.name}` : ''}`;
    checkScope(ve.expression, scope, where);
    if (ve.language === 'application/x-fhir-query') {
      let url = ve.expression;
      for (const m of ve.expression.matchAll(/\{\{(.+?)\}\}/g)) url = url.replace(m[0], String(evalFp(ctx, m[1], scope, `${where} {{}}`)[0] ?? ''));
      try { scope[ve.name] = [await getJson(url)]; } catch (err) { errors.push(`${where}: ${err.message}`); scope[ve.name] = []; }
      continue;
    }
    const r = evalFp(ctx, ve.expression, scope, where);
    if (e.url === EXT.variable) scope[ve.name] = r;
    if (e.url === EXT.popContext) scope[ve.name] = r.slice(0, 1);
    if ((e.url === EXT.calc || e.url === EXT.initial) && qi && !item.repeats && (e.url === EXT.calc || !(item.extension || []).some((x) => x.url === EXT.popContext))) {
      // compare with the playground (initialExpressions only outside population contexts)
      if (e.url === EXT.initial && (qrItems[item.linkId]?.length ?? 0) > 1) continue;
      nCompared++;
      if (!same(r, answersOf(qi))) valueMismatches.push(`${where}: fhirpath.js ${JSON.stringify(r).slice(0, 100)} vs playground ${JSON.stringify(answersOf(qi)).slice(0, 100)}`);
    }
  }
  for (const e of item.extension || []) {
    if (e.url !== EXT.templateExtract) continue;
    for (const s of e.extension || []) {
      if (s.url === 'template') {
        const t = Q.contained.find((c) => `#${c.id}` === s.valueReference.reference);
        if (t) await evalTemplate(t, ctx, scope, `${item.linkId} template ${t.id}`);
      } else if (typeof s.valueString === 'string') {
        checkScope(s.valueString, scope, `${item.linkId} templateExtract ${s.url}`);
        evalFp(ctx, s.valueString, scope, `${item.linkId} templateExtract ${s.url.split('/').pop()}`);
      }
    }
  }
  for (const child of item.item || []) await evalItem(child, scope);
}
for (const item of Q.item) await evalItem(item, rootEnv);

check('every FHIRPath expression parses', !parseErrors.length, `${fpStrings.length} expressions${parseErrors.length ? `; ${parseErrors.slice(0, 5).join(' | ')}` : ''}`);
check('every %variable is defined in scope', !scopeErrors.length, scopeErrors.slice(0, 10).join(' | '));
check('every FHIRPath expression evaluates without error (fhirpath.js, R4)', !errors.length,
  `${nExpr} evaluations, ${nNonEmpty} non-empty${errors.length ? `; ${errors.length} errors: ${errors.slice(0, 5).join(' | ')}` : ''}`);
check('fhirpath.js = playground for calculated / pre-populated answers', !valueMismatches.length,
  `${nCompared} items compared${valueMismatches.length ? `; ${valueMismatches.length} differ: ${valueMismatches.slice(0, 6).join(' | ')}` : ''}`);

// a few cross-module values, computed by fhirpath.js from the root variables
const v = (n) => JSON.stringify(rootEnv[n]);
check('cross-module: sexCode (A1) + hb/ferritin/tsat/crp (A5) -> pathway (A6)', v('sexCode') === '["female"]' && v('hb') === '[121]' && v('pathway') === '["none"]', `sex ${v('sexCode')}, Hb ${v('hb')}, pathway ${v('pathway')}`);
check('cross-module: height/weight (A1) + Hb (A5) -> Ganzoni inputs (A7)', Math.abs(rootEnv.weight[0] - 54.14) < 1e-6 && v('targetHb') === '[150]' && v('ironStores') === '[500]', `weight ${v('weight')}, target ${v('targetHb')}, stores ${v('ironStores')}`);
check('cross-module: surgeryDate (A3)', v('surgeryDate') === '["2026-11-18"]', v('surgeryDate'));

if (LIVE) { writeFileSync(path.join(HERE, FIXTURES), JSON.stringify(fixtures, null, 1) + '\n'); console.log(`wrote ${FIXTURES} (${Object.keys(fixtures).length} responses)`); }
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
