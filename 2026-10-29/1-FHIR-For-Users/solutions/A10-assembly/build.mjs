#!/usr/bin/env node
// A10 Modular assembly: build the solution root form (soln-pam-root) and assemble the full PAM form
// (soln-pam-assembled) from the A1–A9 (+ A11 nurse-side) solution modules, with @aehrc/sdc-assemble
// (the library behind the Smart Forms $assemble service), as questionnaires/assemble.mjs does.
//
//   node build.mjs            # reads the modules from ../A*-*/, writes soln-pam-root.json,
//                             # soln-pam-assembled.json and build-output.txt; exit 1 on a clash
//
// @aehrc/sdc-assemble is resolved from $SDC_ASSEMBLE_DIR, else ../../questionnaires (after
// `npm install` there), else this folder.
//
// Before assembling it checks the modules against each other and reports (build-output.txt):
//   * module identity (canonical, version 0.2.0, assemble-child)
//   * duplicated linkIds across modules (the assembler would silently prefix them)
//   * duplicated variable / population-context names (the assembler rejects duplicate top-level ones)
//   * contained resource id clashes: the assembler keeps the first resource with an id and drops the
//     rest silently. Identical copies are merged; different resources with the same id are renamed
//     `<id>-<module>` in the clashing module, with every "#<id>" reference in it rewritten
//   * module-level extensions the assembler drops (extractAllocateId): lifted to the root
//   * every %variable a module uses is defined: built-in, in the module, or on the root
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLN = path.join(HERE, '..');
const QDIR = path.join(HERE, '../../questionnaires');
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
let problems = 0;
const problem = (s) => { problems++; log(`CLASH ${s}`); };

async function loadAssembler() {
  for (const dir of [process.env.SDC_ASSEMBLE_DIR, QDIR, HERE].filter(Boolean)) {
    try {
      const req = createRequire(path.join(dir, 'package.json'));
      return (await import(pathToFileURL(req.resolve('@aehrc/sdc-assemble')).href)).assemble;
    } catch { /* try next */ }
  }
  console.error('Cannot find @aehrc/sdc-assemble: (cd ../../questionnaires && npm install), or set SDC_ASSEMBLE_DIR');
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// The modules, in tab order. A11's patient-facing form is not a module of the nurse's form; its
// nurse-side reader (pam-patient-reported) is, after History.
const SB = 'https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire';
export const MODULES = [
  { key: 'patient-details', scenario: 'A1', file: 'A1-patient-details/pam-patient-details.json', text: 'Patient details' },
  { key: 'gp-details', scenario: 'A2', file: 'A2-gp-details/pam-gp-details.json', text: 'GP details' },
  { key: 'proposed-surgery', scenario: 'A3', file: 'A3-proposed-surgery/soln-pam-proposed-surgery.json', text: 'Proposed surgery' },
  { key: 'history', scenario: 'A4', file: 'A4-history/soln-pam-history.json', text: 'Past medical and surgical history' },
  { key: 'patient-reported', scenario: 'A11', file: 'A11-pre-admission/A11-nurse-import.json', text: 'Patient-reported (pre-admission form)' },
  { key: 'pathology', scenario: 'A5', file: 'A5-pathology/soln-pam-pathology.json', text: 'Pathology results' },
  { key: 'diagnosis', scenario: 'A6', file: 'A6-diagnosis/soln-pam-diagnosis.json', text: 'Diagnosis' },
  { key: 'treatment', scenario: 'A7', file: 'A7-treatment/soln-pam-treatment.json', text: 'Treatment and iron dose' },
  { key: 'education', scenario: 'A8', file: 'A8-education/soln-pam-education.json', text: 'Patient education' },
  { key: 'follow-up', scenario: 'A9', file: 'A9-follow-up/pam-follow-up.json', text: 'Follow-up and status' },
];

// Shared root variables: the union of the 0.1.0 root and what the module READMEs ask for, with the
// proposed corrections (A6 hbThreshold, A7 weight / targetHb / ironStores). Order matters (later ones
// use earlier ones). `source` is where the definition comes from.
const fp = (name, expression, source) => ({ name, expression, source });
const answer = (linkId, suffix = '') => `%resource.repeat(item).where(linkId='${linkId}').answer.value${suffix}`;
export const ROOT_VARIABLES = [
  fp('sexCode', answer('pam-sex', '.code'), '0.1.0 root'),
  fp('dob', answer('pam-dob'), '0.1.0 root'),
  fp('heightCm', answer('pam-height'), '0.1.0 root'),
  fp('weightKg', answer('pam-weight'), '0.1.0 root'),
  fp('hb', answer('pam-hb'), '0.1.0 root'),
  fp('ferritin', answer('pam-ferritin'), '0.1.0 root'),
  fp('tsat', answer('pam-tsat'), '0.1.0 root'),
  fp('crp', answer('pam-crp'), '0.1.0 root'),
  fp('mcv', answer('pam-mcv'), 'new (A6)'),
  fp('egfr', answer('pam-egfr'), 'new (A6)'),
  fp('surgeryDate', answer('pam-surgery-date'), 'new (A3)'),
  fp('hbThreshold', "iif(%sexCode = 'male', 130, iif(%sexCode = 'female', 120, {}))", 'changed (A6 proposal; 0.1.0 used 120 for any non-male sex)'),
  fp('anaemia', '%hb <= %hbThreshold', 'new (A6)'),
  fp('ironDeficiency', '%ferritin < 100 or (%tsat < 20 and %ferritin >= 100 and %ferritin <= 300)', 'new (A6)'),
  fp('inflammation', '%crp > 10', 'new (A6)'),
  fp('pathway', "iif(%anaemia.empty() or %ironDeficiency.empty(), {}, iif(%anaemia, iif(%ferritin < 100, 'ida', iif(%ironDeficiency, iif(%inflammation, 'acd', 'ida'), 'anaemia')), iif(%ironDeficiency, 'id', 'none')))", 'new (A6)'),
  fp('suggestedDxCode', "iif(%pathway = 'ida', '87522002', iif(%pathway = 'acd', '234347009', iif(%pathway = 'id', '35240004', iif(%pathway = 'anaemia', '271737000', {}))))", 'new (A6)'),
  fp('actualHb', '%hb', '0.1.0 root'),
  fp('idealWeight', "iif(%sexCode = 'male', 50, 45.5) + 0.9 * (%heightCm - 152.4)", '0.1.0 root'),
  fp('weight', 'iif(%idealWeight.exists() and %idealWeight < %weightKg, %idealWeight, %weightKg)', 'changed (A7: actual weight when there is no height)'),
  fp('targetHb', 'iif(%weightKg < 35, 130, 150)', 'changed (A7: 35 kg rule on actual body weight)'),
  fp('ironStores', 'iif(%weightKg < 35, 15 * %weight, 500)', 'changed (A7: 35 kg rule on actual body weight)'),
];

// linkId clashes between modules, resolved here by renaming the item in one module (and every
// reference to it inside that module: enableWhen.question and quoted linkIds in expressions).
// pam-target-hb: A6 = the requested target Hb (Goal), A7 = Ganzoni's target Hb (calculated, read by
// A7's MedicationRequest note via %resource.repeat(item), which would also pick up A6's answer).
export const RENAMES = [
  { module: 'treatment', from: 'pam-target-hb', to: 'pam-ganzoni-target-hb' },
];

// Applied to a module (as JSON text) before assembling; verify.mjs applies the same to compare.
//  * RENAMES
//  * the hidden "pam-<module>-module" item's initial value is "pam-<module>|0.2.0" in most modules
//    but "soln-pam-<module>|0.2.0" in A7 and A8: normalised to "pam-<module>|0.2.0"
export function prepareModule(key, text) {
  const notes = [];
  for (const r of RENAMES.filter((x) => x.module === key)) {
    const n = text.split(`"${r.from}"`).length - 1 + text.split(`'${r.from}'`).length - 1;
    text = text.split(`"${r.from}"`).join(`"${r.to}"`).split(`'${r.from}'`).join(`'${r.to}'`);
    notes.push(`linkId ${r.from} -> ${r.to} (${n} occurrences)`);
  }
  const q = JSON.parse(text);
  const fix = (items) => {
    for (const i of items || []) {
      if (/^pam-.*-module$/.test(i.linkId)) {
        for (const init of i.initial || []) {
          if (init.valueString?.startsWith('soln-pam-')) {
            notes.push(`hidden ${i.linkId} value ${init.valueString} -> ${init.valueString.slice(5)}`);
            init.valueString = init.valueString.slice(5);
          }
        }
      }
      fix(i.item);
    }
  };
  fix(q.item);
  return { q, notes };
}

const EXT = {
  variable: 'http://hl7.org/fhir/StructureDefinition/variable',
  launchContext: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext',
  expectation: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-assemble-expectation',
  allocateId: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-extractAllocateId',
  subQ: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-subQuestionnaire',
  itemControl: 'http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl',
};
// Module-level extensions @aehrc/sdc-assemble carries over (others are dropped)
const PROPAGATED = new Set([EXT.variable, EXT.launchContext, EXT.expectation,
  'http://hl7.org/fhir/StructureDefinition/cqf-library',
  'http://hl7.org/fhir/StructureDefinition/questionnaire-constraint',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-itemPopulationContext',
  'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-itemExtractionContext']);
export const BUILTINS = new Set(['resource', 'rootResource', 'context', 'questionnaire', 'qitem', 'patient',
  'user', 'encounter', 'location', 'study', 'ucum', 'sct', 'loinc', 'factory', 'terminologies', 'server', 'this']);

// ---------------------------------------------------------------------------------------------
const walk = (n, f, p = []) => {
  if (Array.isArray(n)) return n.forEach((x, i) => walk(x, f, [...p, i]));
  if (n && typeof n === 'object') { f(n, p); for (const [k, v] of Object.entries(n)) walk(v, f, [...p, k]); }
};
// %names used in a module's expressions (FHIRPath, x-fhir-query {{ }} and template strings)
export function usedVars(json) {
  const s = new Set();
  walk(json, (n) => {
    for (const [k, v] of Object.entries(n)) {
      if (typeof v !== 'string' || !(k === 'expression' || k === 'valueString')) continue;
      for (const m of v.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)/g)) if (!/^[0-9A-F]{2}/.test(m[1])) s.add(m[1]);
    }
  });
  return s;
}
// names defined in a module: variables, population / extraction contexts (any named valueExpression),
// extractAllocateId
export function definedVars(json) {
  const s = new Set();
  walk(json, (n) => {
    if (n.valueExpression?.name) s.add(n.valueExpression.name);
    if (n.url === EXT.allocateId && n.valueString) s.add(n.valueString);
  });
  return s;
}
const linkIds = (items, acc = []) => { for (const i of items || []) { acc.push(i.linkId); linkIds(i.item, acc); } return acc; };

// ---------------------------------------------------------------------------------------------
export async function build({ write = true, tamper } = {}) {
  const assemble = await loadAssembler();
  out.length = 0; problems = 0;
  const starterRoot = load(path.join(QDIR, 'pam-root.json'));
  const modules = MODULES.map((m) => ({ ...m, q: load(path.join(SOLN, m.file)) }));

  for (const m of modules) {
    const { q, notes } = prepareModule(m.key, JSON.stringify(m.q));
    m.q = q; m.renamed = notes;
  }
  if (tamper) tamper(modules);
  log(`# A10 build ${new Date().toISOString()}`);
  log('');
  log('## Modules');
  for (const m of modules) {
    const exp = m.q.extension?.find((e) => e.url === EXT.expectation)?.valueCode;
    const ok = m.q.url === `${SB}/pam-${m.key}` && m.q.version === '0.2.0' && exp === 'assemble-child';
    if (!ok) problem(`${m.scenario} ${m.file}: url ${m.q.url} version ${m.q.version} expectation ${exp}`);
    log(`${ok ? 'OK   ' : 'BAD  '} ${m.scenario.padEnd(4)} ${m.q.id.padEnd(26)} ${m.q.url}|${m.q.version}  (${m.file})`);
    for (const r of m.renamed || []) log(`      changed in the assembly (${m.scenario}): ${r}`);
  }

  // --- linkIds ------------------------------------------------------------------------------
  log('');
  log('## linkIds');
  const owner = {};
  const rootLinkIds = ['pam-tabs', ...modules.map((m) => `pam-sub-${m.key}`)];
  for (const l of rootLinkIds) owner[l] = 'root';
  let nLinkIds = 0;
  for (const m of modules) {
    for (const l of linkIds(m.q.item)) {
      nLinkIds++;
      if (owner[l] && owner[l] !== m.scenario) problem(`linkId ${l} in ${m.scenario} and ${owner[l]}`);
      else if (owner[l]) problem(`linkId ${l} twice in ${m.scenario}`);
      owner[l] = m.scenario;
    }
  }
  log(`${nLinkIds} linkIds in the modules, ${problems ? 'see clashes above' : 'all unique'}`);

  // --- variable names -----------------------------------------------------------------------
  log('');
  log('## Variable and context names');
  const rootNames = new Set(ROOT_VARIABLES.map((v) => v.name));
  const nameOwner = {};
  for (const m of modules) {
    for (const n of definedVars(m.q)) {
      if (rootNames.has(n)) problem(`${m.scenario} defines ${n}, which is also a root variable`);
      if (nameOwner[n]) problem(`${n} defined in ${m.scenario} and ${nameOwner[n]}`);
      nameOwner[n] = m.scenario;
    }
  }
  log(`${Object.keys(nameOwner).length} module-level names, ${rootNames.size} root variables: ${Object.keys(nameOwner).length ? 'no duplicates found' : ''}`.trim());

  // --- contained resources -------------------------------------------------------------------
  log('');
  log('## Contained resources (templates)');
  const containedOwner = {};
  for (const m of modules) {
    for (const r of [...(m.q.contained || [])]) {
      const prev = containedOwner[r.id];
      if (!prev) { containedOwner[r.id] = { m, r }; continue; }
      if (isDeepStrictEqual(prev.r, r)) { log(`same  ${r.id} in ${prev.m.scenario} and ${m.scenario}: identical, merged`); continue; }
      const newId = `${r.id}-${m.key}`;
      problem(`contained id ${r.id} in ${prev.m.scenario} and ${m.scenario} differ: renamed to ${newId} in ${m.scenario}`);
      let s = JSON.stringify(m.q);
      s = s.split(`"#${r.id}"`).join(`"#${newId}"`).split(`"id":"${r.id}"`).join(`"id":"${newId}"`);
      m.q = JSON.parse(s);
      containedOwner[newId] = { m, r: m.q.contained.find((c) => c.id === newId) };
      problems--; // resolved by renaming: report, don't fail
    }
  }
  for (const [id, { m }] of Object.entries(containedOwner)) log(`      ${m.scenario.padEnd(4)} ${id}`);

  // --- extensions the assembler would drop ---------------------------------------------------
  log('');
  log('## Module-level extensions lifted to the root');
  const lifted = [];
  for (const m of modules) {
    for (const e of m.q.extension || []) {
      if (PROPAGATED.has(e.url)) continue;
      const same = lifted.find((x) => isDeepStrictEqual(x.e, e));
      if (same) { same.by.push(m.scenario); continue; }
      if (e.url === EXT.allocateId && lifted.some((x) => x.e.url === EXT.allocateId && x.e.valueString === e.valueString)) problem(`allocateId ${e.valueString} twice`);
      lifted.push({ e, by: [m.scenario] });
    }
  }
  for (const x of lifted) log(`      ${x.e.url.split('/').pop()} ${x.e.valueString ?? JSON.stringify(x.e)}  (${x.by.join(', ')})`);

  // --- %variables ----------------------------------------------------------------------------
  log('');
  log('## Variables used vs defined');
  const allocIds = new Set(lifted.filter((x) => x.e.url === EXT.allocateId).map((x) => x.e.valueString));
  const rootUses = {};
  for (const v of ROOT_VARIABLES) rootUses[v.name] = [...usedVars({ expression: v.expression })].filter((n) => rootNames.has(n));
  const closure = (names) => { const s = new Set(); const add = (n) => { if (s.has(n)) return; s.add(n); (rootUses[n] || []).forEach(add); }; names.forEach(add); return s; };
  const neededBy = Object.fromEntries(ROOT_VARIABLES.map((v) => [v.name, { direct: [], via: [] }]));
  for (const m of modules) {
    const used = usedVars(m.q);
    const local = definedVars(m.q);
    const undefinedNames = [...used].filter((n) => !BUILTINS.has(n) && !local.has(n) && !rootNames.has(n) && !allocIds.has(n));
    if (undefinedNames.length) problem(`${m.scenario} uses undefined %${undefinedNames.join(', %')}`);
    const direct = [...used].filter((n) => rootNames.has(n) && !local.has(n));
    for (const n of direct) neededBy[n].direct.push(m.scenario);
    for (const n of closure(direct)) if (!direct.includes(n)) neededBy[n].via.push(m.scenario);
    log(`${m.scenario.padEnd(4)} root variables: ${direct.join(', ') || '(none)'}`);
  }
  const unused = ROOT_VARIABLES.filter((v) => !neededBy[v.name].direct.length && !neededBy[v.name].via.length);
  if (unused.length) log(`note: root variables no module uses: ${unused.map((v) => v.name).join(', ')}`);

  // Cross-check against the standalone forms (drift between the modules' own copy and ours)
  log('');
  log('## Root variables vs the standalone forms');
  const standalones = ['A1-patient-details/A1-standalone.json', 'A3-proposed-surgery/soln-A3-standalone.json',
    'A4-history/soln-A4-standalone.json', 'A6-diagnosis/soln-A6-standalone.json', 'A7-treatment/soln-A7-standalone.json'];
  let diffs = 0;
  for (const f of standalones) {
    let sq; try { sq = load(path.join(SOLN, f)); } catch { log(`skip ${f}`); continue; }
    for (const e of sq.extension || []) {
      if (e.url !== EXT.variable) continue;
      const mine = ROOT_VARIABLES.find((v) => v.name === e.valueExpression.name);
      if (!mine) log(`note ${f}: root-level ${e.valueExpression.name} not in soln-pam-root (module-specific?)`);
      else if (mine.expression !== e.valueExpression.expression && ++diffs) log(`DIFF ${f}: ${mine.name} = ${e.valueExpression.expression}  (root: ${mine.expression})`);
    }
  }

  log(diffs ? `${diffs} difference(s)` : `${standalones.length} standalone forms: every root-level variable they define has the same expression here`);

  // --- the root ------------------------------------------------------------------------------
  const tabs = starterRoot.item[0];
  const root = {
    resourceType: 'Questionnaire',
    id: 'soln-pam-root',
    extension: [
      { url: EXT.expectation, valueCode: 'assemble-root' },
      ...starterRoot.extension.filter((e) => e.url === EXT.launchContext),
      ...ROOT_VARIABLES.map((v) => ({ url: EXT.variable, valueExpression: { name: v.name, language: 'text/fhirpath', expression: v.expression } })),
      ...lifted.map((x) => x.e),
    ],
    url: `${SB}/pam-root`,
    version: '0.2.0',
    name: 'PreoperativeAnaemiaManagementSolution',
    title: 'Preoperative Anaemia Management (connectathon full solution)',
    status: 'draft',
    experimental: true,
    date: '2026-10-29',
    publisher: starterRoot.publisher,
    description: 'Root of the full-solution PAM form (scenario A10): shared variables and one subQuestionnaire per solution module (A1–A9, plus the A11 nurse-side reader of the patient-reported form). Assembled version: 0.2.0-assembled (id soln-pam-assembled).',
    item: [{
      linkId: tabs.linkId,
      text: tabs.text,
      type: 'group',
      extension: tabs.extension,
      item: modules.map((m) => ({
        linkId: `pam-sub-${m.key}`,
        type: 'display',
        text: `PAM module — ${m.text}`,
        extension: [{ url: EXT.subQ, valueCanonical: `${m.q.url}|${m.q.version}` }],
      })),
    }],
  };
  // module launchContexts other than patient
  for (const m of modules) {
    for (const e of m.q.extension || []) {
      if (e.url !== EXT.launchContext) continue;
      if (!root.extension.some((x) => isDeepStrictEqual(x, e))) { root.extension.splice(1, 0, e); log(`launchContext from ${m.scenario} added to the root`); }
    }
  }

  // --- assemble ------------------------------------------------------------------------------
  const fetchQuestionnaire = async (canonical) => {
    const [url, version] = canonical.split('&version=');
    const found = modules.map((m) => m.q).filter((q) => q.url === url && (!version || q.version === version));
    return { resourceType: 'Bundle', type: 'searchset', total: found.length, entry: found.map((resource) => ({ resource })) };
  };
  const result = await assemble({ resourceType: 'Parameters', parameter: [{ name: 'questionnaire', resource: structuredClone(root) }] }, fetchQuestionnaire, {});
  const assembled = result.resourceType === 'Parameters'
    ? result.parameter.find((p) => p.name === 'response')?.resource ?? result.parameter[0].resource : result;
  const issues = result.resourceType === 'Parameters' ? result.parameter.find((p) => p.name === 'outcome')?.resource : null;
  log('');
  log('## Assemble');
  if (assembled.resourceType !== 'Questionnaire') {
    problem(`assemble failed: ${JSON.stringify(assembled).slice(0, 2000)}`);
    writeFileSync(path.join(HERE, 'build-output.txt'), out.join('\n') + '\n');
    process.exit(1);
  }
  if (issues) log(`assembler issues: ${JSON.stringify(issues.issue)}`);
  Object.assign(assembled, {
    id: 'soln-pam-assembled',
    version: '0.2.0-assembled',
    title: 'Preoperative Anaemia Management (connectathon full solution, assembled)',
  });
  // the assembler may prefix duplicated linkIds: report any change
  const before = new Set([...rootLinkIds, ...modules.flatMap((m) => linkIds(m.q.item))]);
  const after = linkIds(assembled.item);
  const changed = after.filter((l) => !before.has(l));
  if (changed.length) problem(`assembler renamed linkIds: ${changed.join(', ')}`);
  const lost = (root.extension.filter((e) => e.url === EXT.allocateId)).filter((e) => !assembled.extension.some((x) => isDeepStrictEqual(x, e)));
  if (lost.length) problem(`assembled form lost root extensions ${JSON.stringify(lost)}`);
  log(`assembled: ${assembled.item[0].item.length} sections (${assembled.item[0].item.map((i) => i.linkId).join(', ')}), ` +
    `${after.length} linkIds, ${assembled.contained?.length ?? 0} contained, ` +
    `${assembled.extension.filter((e) => e.url === EXT.variable).length} root-level variables`);

  // --- root-variable table (for the README) -------------------------------------------------
  log('');
  log('## Root variables and who needs them');
  log('');
  log('| Variable | Needed by (directly) | Needed by (through another root variable) | Source |');
  log('|---|---|---|---|');
  for (const v of ROOT_VARIABLES) log(`| \`${v.name}\` | ${neededBy[v.name].direct.join(', ') || '—'} | ${neededBy[v.name].via.join(', ') || '—'} | ${v.source} |`);
  for (const x of lifted) log(`| \`${x.e.valueString}\` (extractAllocateId) | ${x.by.join(', ')} | — | lifted from the module (the assembler drops it) |`);

  log('');
  log(problems ? `RESULT: ${problems} unresolved clash(es)` : 'RESULT: OK, no unresolved clashes');
  if (write) {
    writeFileSync(path.join(HERE, 'soln-pam-root.json'), JSON.stringify(root, null, 2) + '\n');
    writeFileSync(path.join(HERE, 'soln-pam-assembled.json'), JSON.stringify(assembled, null, 2) + '\n');
    writeFileSync(path.join(HERE, 'build-output.txt'), out.join('\n') + '\n');
  }
  return { root, assembled, problems, modules };
}

// --selftest: inject one clash of each kind into copies of the modules and check they are reported
async function selftest() {
  const tamper = (modules) => {
    const [a1, a2, , , , a5] = modules;
    a2.q.contained.push({ ...structuredClone(a1.q.contained[0]), status: 'preliminary' }); // same id, different content
    a2.q.item[0].item[0].extension = [...(a2.q.item[0].item[0].extension || []),
      { url: 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-templateExtract', extension: [{ url: 'template', valueReference: { reference: `#${a1.q.contained[0].id}` } }] }];
    a5.q.item[0].item.push({ linkId: 'pam-weight', type: 'decimal', text: 'duplicate' }); // linkId clash
    a5.q.item[0].extension.push({ url: EXT.variable, valueExpression: { name: 'obsHeight', language: 'text/fhirpath', expression: '1' } }); // name clash
    a5.q.item[0].extension.push({ url: EXT.variable, valueExpression: { name: 'probe', language: 'text/fhirpath', expression: '%notDefinedAnywhere' } }); // undefined %var
  };
  const { problems: p, assembled } = await build({ write: false, tamper });
  const want = [/contained id .* renamed/, /linkId pam-weight in A5 and A1/, /obsHeight defined in/, /uses undefined %notDefinedAnywhere/];
  const text = out.join('\n');
  let bad = 0;
  for (const w of want) { const ok = w.test(text); if (!ok) bad++; console.error(`${ok ? 'PASS' : 'FAIL'} selftest detects ${w}`); }
  const renamed = assembled?.contained?.some((c) => c.id.endsWith('-gp-details'));
  if (!renamed) bad++;
  console.error(`${renamed ? 'PASS' : 'FAIL'} selftest: clashing template renamed and kept (${assembled?.contained?.length} contained)`);
  console.error(`selftest: ${p} unresolved clash(es) reported; ${bad ? 'FAILED' : 'ALL PASS'}`);
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) process.exit((await selftest()) ? 1 : 0);
  const { problems: p } = await build();
  process.exit(p ? 1 : 0);
}
