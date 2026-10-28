#!/usr/bin/env node
// Capture the module's three x-fhir-query results from Meld (test data loaded) into
// fixtures-searchsets.json, so verify.mjs runs offline on real server responses.
//   ./load.sh && node capture-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const OPEN = 'https://gw.interop.community/QHConnectathon2026/open';
const q = JSON.parse(readFileSync(new URL('./pam-gp-details.json', import.meta.url)));
const vars = q.item[0].extension.filter((e) => e.valueExpression?.language === 'application/x-fhir-query');
const out = {};
for (const pid of ['soln-A2-patient-1', 'soln-A2-patient-2', 'pam-001']) {
  out[pid] = {};
  for (const v of vars) {
    const url = `${OPEN}/${v.valueExpression.expression.replace('{{%patient.id}}', pid).replace(/\|/g, '%7C')}`;
    const b = await (await fetch(url, { headers: { Accept: 'application/fhir+json' } })).json();
    for (const e of b.entry || []) delete e.resource.meta;
    delete b.meta; delete b.id; delete b.link;
    out[pid][v.valueExpression.name] = b;
  }
  const p = await (await fetch(`${OPEN}/Patient/${pid}`, { headers: { Accept: 'application/fhir+json' } })).json();
  delete p.meta;
  out[pid].patient = p;
}
writeFileSync(new URL('./fixtures-searchsets.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote fixtures-searchsets.json', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, b]) => [n, b.entry?.length ?? b.resourceType]))])));
