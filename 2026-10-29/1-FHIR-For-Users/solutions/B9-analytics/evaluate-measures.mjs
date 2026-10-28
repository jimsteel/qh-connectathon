// Evaluates the Measures in measures/ against data/*.ndjson (from fetch-data.py) with fhirpath.js (R4 model)
// and writes summary MeasureReports to results/measure-reports/.
//   node solutions/B9-analytics/evaluate-measures.mjs [periodStart periodEnd]   (default FY 2025-26)
// Each population / stratifier criterion is FHIRPath evaluated once per patient, with the context set to a
// Bundle of that patient's resources and %periodStart / %periodEnd set (see Measure.usage).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../decks/package.json'));
const fhirpath = require('fhirpath');
const r4 = require('fhirpath/fhir-context/r4');

const [periodStart = '2025-07-01', periodEnd = '2026-06-30'] = process.argv.slice(2);
const dataDir = path.join(here, 'data');
const outDir = path.join(here, 'results', 'measure-reports');
fs.mkdirSync(outDir, { recursive: true });

// Group every resource by patient into one Bundle per patient
const bundles = new Map();
const patientOf = (r) => r.resourceType === 'Patient' ? r.id : (r.subject || r.patient || r.for)?.reference?.match(/^Patient\/(.+)$/)?.[1];
for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith('.ndjson'))) {
  for (const line of fs.readFileSync(path.join(dataDir, f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line), p = patientOf(r);
    if (!p) continue;
    if (!bundles.has(p)) bundles.set(p, { resourceType: 'Bundle', type: 'collection', entry: [] });
    bundles.get(p).entry.push({ fullUrl: `${r.resourceType}/${r.id}`, resource: r });
  }
}

const env = { periodStart, periodEnd };
const compiled = new Map();
function evaluate(expr, bundle) {
  if (!compiled.has(expr)) compiled.set(expr, fhirpath.compile(expr, r4));
  return compiled.get(expr)(bundle, env);
}
const truthy = (v) => v.length === 1 && v[0] === true;
const code = (p) => p.code.coding[0].code;

const summary = [];
for (const file of fs.readdirSync(path.join(here, 'measures')).filter((f) => f.endsWith('.json')).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(here, 'measures', file), 'utf8'));
  const report = {
    resourceType: 'MeasureReport', id: `soln-B9-report-${file.replace('.json', '')}-${periodStart}-${periodEnd}`,
    status: 'complete', type: 'summary', measure: `${m.url}|${m.version}`,
    date: new Date().toISOString(), period: { start: periodStart, end: periodEnd },
    group: [],
  };
  for (const g of m.group) {
    const members = {};                                     // population code -> [patient ids]
    for (const p of g.population) members[code(p)] = [];
    const strata = g.stratifier?.map(() => new Map()) ?? []; // per stratifier: value -> {pop code -> count}
    for (const [pid, bundle] of bundles) {
      const inPops = {};
      for (const p of g.population) inPops[code(p)] = truthy(evaluate(p.criteria.expression, bundle));
      if (!inPops['initial-population']) continue;          // every other population is a subset of it
      for (const [c, isIn] of Object.entries(inPops)) if (isIn) members[c].push(pid);
      g.stratifier?.forEach((s, i) => {
        const value = String(evaluate(s.criteria.expression, bundle)[0] ?? 'unknown');
        const counts = strata[i].get(value) ?? Object.fromEntries(Object.keys(inPops).map((c) => [c, 0]));
        for (const [c, isIn] of Object.entries(inPops)) if (isIn) counts[c]++;
        strata[i].set(value, counts);
      });
    }
    const score = (counts) => (counts.denominator ? { value: Math.round(1000 * counts.numerator / counts.denominator) / 1000 } : undefined);
    const counts = Object.fromEntries(Object.entries(members).map(([c, ids]) => [c, ids.length]));
    const pops = (cs) => Object.entries(cs).map(([c, n]) => ({ code: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/measure-population', code: c }] }, count: n }));
    const scoring = m.scoring.coding[0].code;
    report.group.push({
      population: pops(counts),
      ...(scoring === 'proportion' && score(counts) ? { measureScore: score(counts) } : {}),
      stratifier: g.stratifier?.map((s, i) => ({
        code: [s.code],
        stratum: [...strata[i].entries()].sort().map(([v, cs]) => ({
          value: { text: v }, population: pops(cs),
          ...(scoring === 'proportion' && score(cs) ? { measureScore: score(cs) } : {}),
        })),
      })),
    });
    summary.push({ measure: m.title, ...counts, score: scoring === 'proportion' ? score(counts)?.value : undefined,
      strata: Object.fromEntries((g.stratifier || []).map((s, i) => [s.code.text, Object.fromEntries([...strata[i].entries()].sort().map(([v, cs]) => [v, scoring === 'proportion' ? `${cs.numerator}/${cs.denominator}` : cs['initial-population']]))])) });
  }
  fs.writeFileSync(path.join(outDir, `${file.replace('.json', '')}.json`), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Measurement period ${periodStart} to ${periodEnd}, ${bundles.size} patient bundles`);
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ periodStart, periodEnd, summary }, null, 2) + '\n');
