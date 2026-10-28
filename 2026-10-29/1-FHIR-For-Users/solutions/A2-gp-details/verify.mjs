#!/usr/bin/env node
// Evaluate every FHIRPath expression in the A2 module with fhirpath.js (R4 model); print PASS/FAIL.
//   node verify.mjs     (fhirpath is resolved from ../../decks/node_modules)
// Data: fixtures-searchsets.json = the real Meld responses to the module's three x-fhir-queries for
// soln-A2-patient-1 (GP on record + referral + admission), soln-A2-patient-2 (nothing) and pam-001
// (synthetic starter data: no GP, referral requested by a Practitioner, no admission).
// Pre-population: variables evaluated in declaration order, as Smart Forms does; then every
// initialExpression. Write-back: the calculated display and every templateExtractValue /
// templateExtractContext / resourceId / patchRequestUrl expression over QuestionnaireResponses
// for each source choice. Finally a coverage check: every expression in the module was evaluated.
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
const Q = load('pam-gp-details.json');
const fixtures = load('fixtures-searchsets.json');

let failures = 0;
const covered = new Set();
function ev(expr, base, vars, typeBase) {
  covered.add(expr);
  const r = typeBase ? fhirpath.evaluate(base, { base: typeBase, expression: expr }, vars, r4)
    : fhirpath.evaluate(base, expr, vars, r4);
  return JSON.parse(JSON.stringify(r));
}
function check(id, got, expected) {
  const ok = isDeepStrictEqual(got, expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${JSON.stringify(got)}${ok ? '' : `  expected ${JSON.stringify(expected)}`}`);
}

const group = Q.item[0];
const byLink = {};
(function walk(items) { for (const i of items || []) { byLink[i.linkId] = i; walk(i.item); } })(Q.item);
const exprOf = (l, kind) => byLink[l].extension?.find((e) => e.url.endsWith(kind))?.valueExpression.expression;

// --- Pre-population ------------------------------------------------------------------------------
const P1 = {
  'pam-gp-current-name': 'Dr Ruth Ambrose', 'pam-gp-current-practice': 'Chermside Family Practice (synthetic)',
  'pam-gp-current-phone': '07 3000 0101', 'pam-gp-current-provider': '0000001A', 'pam-gp-current-ref': 'PractitionerRole/soln-A2-role-ambrose',
  'pam-gp-source': 'current',
  'pam-gp-referring-name': 'Dr Lucy Tran', 'pam-gp-referring-practice': 'Aspley Road Surgery (synthetic)',
  'pam-gp-referring-phone': '07 3000 0303', 'pam-gp-referring-provider': '0000003C', 'pam-gp-referring-ref': 'PractitionerRole/soln-A2-role-tran',
  'pam-gp-referring-date': '2026-10-01',
  'pam-gp-admission-name': 'Dr Omar Haddad', 'pam-gp-admission-practice': 'Kedron Medical Centre (synthetic)',
  'pam-gp-admission-phone': '07 3000 0202', 'pam-gp-admission-provider': '0000002B', 'pam-gp-admission-ref': 'PractitionerRole/soln-A2-role-haddad',
  'pam-gp-admission-date': '2026-08-10',
};
const NONE = Object.fromEntries(Object.keys(P1).map((k) => [k, null]));
const PAM001 = { ...NONE, 'pam-gp-referring-name': 'Dr Alan Pierce', 'pam-gp-referring-ref': 'Practitioner/pam-surgeon-orthopaedics',
  'pam-gp-referring-date': fixtures['pam-001'].gpReferral.entry[0].resource.authoredOn };
const expected = { 'soln-A2-patient-1': P1, 'soln-A2-patient-2': NONE, 'pam-001': PAM001 };

const prepopulated = {};
for (const [pid, exp] of Object.entries(expected)) {
  const f = fixtures[pid];
  const vars = { patient: f.patient, gpCurrent: f.gpCurrent, gpReferral: f.gpReferral, gpAdmission: f.gpAdmission };
  for (const e of group.extension.filter((x) => x.valueExpression?.language === 'text/fhirpath')) {
    vars[e.valueExpression.name] = ev(e.valueExpression.expression, {}, vars);
  }
  prepopulated[pid] = {};
  for (const [linkId, value] of Object.entries(exp)) {
    const expr = exprOf(linkId, 'initialExpression');
    const got = ev(expr, {}, vars);
    prepopulated[pid][linkId] = got[0] ?? null;
    check(`${pid} ${linkId}`, got, value === null ? [] : [value]);
  }
}
check('pam-001: referring practice/phone/provider empty (surgeon has none)', [prepopulated['pam-001']['pam-gp-referring-practice']], [null]);

// --- QuestionnaireResponses for each choice --------------------------------------------------------
const SRC = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem/gp-source';
const VALUE_KEY = { string: 'valueString', date: 'valueDate', choice: 'valueCoding' };
function buildQR(pid, source, manual = {}) {
  const pre = prepopulated[pid];
  const leaf = (l) => {
    const v = l === 'pam-gp-source' ? (source ? { system: SRC, code: source } : null) : (pre[l] ?? manual[l] ?? null);
    return v === null ? null : { linkId: l, answer: [{ [VALUE_KEY[byLink[l].type]]: v }] };
  };
  const enabled = (i) => !i.enableWhen || i.enableWhen.every((w) => w.answerCoding?.code === source);
  const items = (qi) => (qi || []).filter((i) => i.type !== 'display' && enabled(i)).map((i) => {
    if (i.type === 'group') { const it = items(i.item); return it.length ? { linkId: i.linkId, item: it } : null; }
    return leaf(i.linkId);
  }).filter(Boolean);
  return { resourceType: 'QuestionnaireResponse', status: 'in-progress', subject: { reference: `Patient/${pid}` },
    item: [{ linkId: 'pam-gp', item: items(group.item) }] };
}
const MANUAL = { 'pam-gp-manual-given': 'Kim', 'pam-gp-manual-family': 'Testmanual', 'pam-gp-manual-provider': '0000009Z',
  'pam-gp-manual-practice': 'Nundah Test Clinic', 'pam-gp-manual-phone': '07 3000 0909' };
const cases = [
  ['patient-1 keep', buildQR('soln-A2-patient-1', 'current'), 'PractitionerRole/soln-A2-role-ambrose', 'Dr Ruth Ambrose', 'replace'],
  ['patient-1 referring', buildQR('soln-A2-patient-1', 'referring'), 'PractitionerRole/soln-A2-role-tran', 'Dr Lucy Tran', 'replace'],
  ['patient-1 admission', buildQR('soln-A2-patient-1', 'admission'), 'PractitionerRole/soln-A2-role-haddad', 'Dr Omar Haddad', 'replace'],
  ['patient-2 manual', buildQR('soln-A2-patient-2', 'manual', MANUAL), 'PractitionerRole/soln-A2-gp-testmanual-kim-0000009z-role', 'Dr Kim Testmanual', 'add'],
  ['pam-001 referring (Practitioner ref)', buildQR('pam-001', 'referring'), 'Practitioner/pam-surgeon-orthopaedics', 'Dr Alan Pierce', 'add'],
  ['patient-2 nothing chosen', buildQR('soln-A2-patient-2', null), null, null, 'add'],
];
const calcDisplay = exprOf('pam-gp-new-display', 'calculatedExpression');
const contained = Object.fromEntries(Q.contained.map((c) => [c.id, c]));
const tevs = (t) => {
  const out = [];
  (function w(n, p) {
    if (Array.isArray(n)) n.forEach((x, i) => w(x, `${p}[${i}]`));
    else if (n && typeof n === 'object') {
      if (n.url?.endsWith('templateExtractValue') || n.url?.endsWith('templateExtractContext')) out.push([p, n.valueString]);
      for (const [k, v] of Object.entries(n)) w(v, `${p}.${k}`);
    }
  })(t, t.id);
  return out;
};
const slices = (linkId) => byLink[linkId].extension.filter((e) => e.url.endsWith('templateExtract'))
  .map((e) => Object.fromEntries(e.extension.map((s) => [s.url.split('/').pop(), s.valueString ?? s.valueReference.reference])));
const patchTevs = Object.fromEntries(tevs(contained.PAMGpPatchTemplate).map(([p, e]) => [p.replace(/^PAMGpPatchTemplate\.parameter\[0\]\./, ''), e]));
const [patchSlice] = slices('pam-gp');

for (const [name, qr, ref, display, type] of cases) {
  const vars = { resource: qr };
  check(`${name}: calculated display`, ev(calcDisplay, qr, vars), display ? [display] : []);
  const ctx = qr.item[0]; // the pam-gp group: context of the PATCH template
  const at = (k) => ev(patchTevs[k], ctx, vars, 'QuestionnaireResponse.item');
  check(`${name}: PATCH type`, at('part[0]._valueCode.extension[0]'), [type]);
  check(`${name}: PATCH path`, at('part[1]._valueString.extension[0]'), [type === 'add' ? 'Patient' : 'Patient.generalPractitioner']);
  check(`${name}: PATCH value reference`, at('part[3].valueReference._reference.extension[0]'), ref ? [ref] : []);
  check(`${name}: PATCH value display`, at('part[3].valueReference._display.extension[0]'), display ? [display] : []);
  check(`${name}: PATCH url`, ev(patchSlice.TemplateExtractExtensionPatchRequestUrl, ctx, vars, 'QuestionnaireResponse.item'), [qr.subject.reference]);
}

// Manual entry templates: context = the pam-gp-manual group
{
  const qr = cases[3][1];
  const vars = { resource: qr };
  const ctx = qr.item[0].item.find((i) => i.linkId === 'pam-gp-manual');
  const id = 'soln-A2-gp-testmanual-kim-0000009z';
  const [pracSlice, roleSlice] = slices('pam-gp-manual');
  check('manual: Practitioner resourceId', ev(pracSlice.resourceId, ctx, vars, 'QuestionnaireResponse.item'), [id]);
  check('manual: PractitionerRole resourceId', ev(roleSlice.resourceId, ctx, vars, 'QuestionnaireResponse.item'), [`${id}-role`]);
  const nameCtx = ctx.item.find((i) => i.linkId === 'pam-gp-manual-name');
  const exp = {
    "item.where(linkId='pam-gp-manual-provider').answer": [{ valueString: '0000009Z' }],
    "item.where(linkId='pam-gp-manual-phone').answer": [{ valueString: '07 3000 0909' }],
    "item.where(linkId='pam-gp-manual-name')": [nameCtx],
    "item.where(linkId='pam-gp-manual-practice').answer.value": ['Nundah Test Clinic'],
  };
  for (const tid of ['PAMGpPractitionerTemplate', 'PAMGpRoleTemplate']) {
    for (const [p, expr] of tevs(contained[tid])) {
      if (expr === 'value') {
        const answerCtx = p.includes('identifier') ? exp["item.where(linkId='pam-gp-manual-provider').answer"][0]
          : exp["item.where(linkId='pam-gp-manual-phone').answer"][0];
        check(`${p} (relative to its context answer)`, ev(expr, answerCtx, vars, 'QuestionnaireResponse.item.answer'),
          [answerCtx.valueString]);
      } else if (p.includes('_family') || p.includes('_given')) {
        check(p, ev(expr, nameCtx, vars, 'QuestionnaireResponse.item'), [p.includes('_family') ? 'Testmanual' : 'Kim']);
      } else if (exp[expr]) {
        check(p, ev(expr, ctx, vars, 'QuestionnaireResponse.item'), exp[expr]);
      } else {
        const want = { 'PAMGpRoleTemplate.practitioner._reference.extension[0]': [`Practitioner/${id}`],
          'PAMGpRoleTemplate.practitioner._display.extension[0]': ['Dr Kim Testmanual'] }[p];
        check(p, ev(expr, ctx, vars, 'QuestionnaireResponse.item'), want);
      }
    }
  }
}

// --- Coverage -------------------------------------------------------------------------------------
const all = [];
(function w(n) {
  if (Array.isArray(n)) n.forEach(w);
  else if (n && typeof n === 'object') {
    if (n.valueExpression?.language === 'text/fhirpath') all.push(n.valueExpression.expression);
    if (/templateExtract(Value|Context)$/.test(n.url ?? '') || ['resourceId', 'fullUrl'].includes(n.url) || n.url?.endsWith('PatchRequestUrl')) all.push(n.valueString);
    Object.values(n).forEach(w);
  }
})(Q);
const missed = all.filter((e) => !covered.has(e));
if (missed.length) { failures++; console.log(`FAIL coverage  not evaluated: ${JSON.stringify(missed)}`); }
else console.log(`PASS coverage  all ${all.length} FHIRPath expressions in the module evaluated`);
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
