#!/usr/bin/env node
// Assemble the full PAM form with the A5 and A6 solution modules in place of pam-pathology and
// pam-diagnosis 0.1.0, and the new root variables from root-variables.json added to pam-root.
// Uses @aehrc/sdc-assemble (the library behind the Smart Forms $assemble service), as
// questionnaires/assemble.mjs does.
//
//   (cd ../../questionnaires && npm install)   # once; or set SDC_ASSEMBLE_DIR to a folder with it installed
//   node assemble-check.mjs                     # writes soln-A6-pam-assembled.json
//
// The output (id soln-A6-pam-assembled) is a test form, to check in the playground that the two
// modules work together inside the whole PAM form (pathology answers feed the diagnosis rules).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QDIR = path.join(HERE, '../../questionnaires');
const req = createRequire(path.join(process.env.SDC_ASSEMBLE_DIR ?? QDIR, 'package.json'));
const { assemble } = await import(pathToFileURL(req.resolve('@aehrc/sdc-assemble')).href);
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));

const SOLN = {
  'https://aehrc.github.io/qh-connectathon/track1/Questionnaire/pam-pathology': load(path.join(HERE, '../A5-pathology/soln-pam-pathology.json')),
  'https://aehrc.github.io/qh-connectathon/track1/Questionnaire/pam-diagnosis': load(path.join(HERE, 'soln-pam-diagnosis.json')),
};
const root = load(path.join(QDIR, 'pam-root.json'));
const rootVars = load(path.join(HERE, 'root-variables.json'));
root.extension.push(...rootVars.new);
for (const sub of root.item[0].item) {
  const e = sub.extension.find((x) => x.url.endsWith('sdc-questionnaire-subQuestionnaire'));
  const url = e.valueCanonical.split('|')[0];
  if (SOLN[url]) e.valueCanonical = `${SOLN[url].url}|${SOLN[url].version}`;
}
const modules = [...readdirSync(path.join(QDIR, 'modules')).map((f) => load(path.join(QDIR, 'modules', f))), ...Object.values(SOLN)];
const fetchQuestionnaire = async (canonical) => {
  const [url, version] = canonical.split('&version=');
  const found = modules.filter((m) => m.url === url && (!version || m.version === version));
  return { resourceType: 'Bundle', type: 'searchset', total: found.length, entry: found.map((resource) => ({ resource })) };
};
const result = await assemble({ resourceType: 'Parameters', parameter: [{ name: 'questionnaire', resource: root }] }, fetchQuestionnaire, {});
const assembled = result.resourceType === 'Parameters'
  ? result.parameter.find((p) => p.name === 'response')?.resource ?? result.parameter[0].resource : result;
const issues = result.resourceType === 'Parameters' ? result.parameter.find((p) => p.name === 'outcome')?.resource : null;
if (assembled.resourceType !== 'Questionnaire') {
  console.error('FAIL assemble', JSON.stringify(assembled, null, 2).slice(0, 3000));
  process.exit(1);
}
if (issues) console.log('Assemble issues:', JSON.stringify(issues.issue));
Object.assign(assembled, {
  id: 'soln-A6-pam-assembled',
  url: 'https://aehrc.github.io/qh-connectathon/track1/solutions/Questionnaire/A6-pam-assembled',
  version: '0.2.0-assembled',
  title: 'PAM form assembled with the A5 + A6 solution modules (test)',
});
const varNames = [];
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (n && typeof n === 'object') {
    if (n.url === 'http://hl7.org/fhir/StructureDefinition/variable') varNames.push(n.valueExpression.name);
    Object.values(n).forEach(walk);
  }
})(assembled);
const dups = varNames.filter((v, i) => varNames.indexOf(v) !== i);
writeFileSync(path.join(HERE, 'soln-A6-pam-assembled.json'), JSON.stringify(assembled, null, 2) + '\n');
console.log(`${dups.length ? 'FAIL' : 'PASS'} assembled: ${assembled.item[0].item.length} sections, ${assembled.contained?.length ?? 0} templates (${assembled.contained?.map((c) => c.id).join(', ')}), ${varNames.length} variables${dups.length ? `, duplicates: ${dups}` : ', no duplicates'}`);
process.exit(dups.length ? 1 : 0);
