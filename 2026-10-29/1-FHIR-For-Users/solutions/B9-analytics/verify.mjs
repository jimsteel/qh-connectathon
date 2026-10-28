// Cross-checks the B9 outputs. Run after fetch-data.py, run-views.py and evaluate-measures.mjs:
//   node solutions/B9-analytics/verify.mjs
// 1. ViewDefinitions and Measures are well-formed JSON with the required elements.
// 2. Every Measure criterion compiles and evaluates with fhirpath.js (R4) on every patient bundle, returning a
//    single boolean (populations) or at most one value (stratifiers).
// 3. SQL on FHIR KPIs (Pathling, results/kpis) == MeasureReports (fhirpath.js, results/measure-reports).
// 4. SQL on FHIR KPIs == direct FHIR searches on the Meld open endpoint (read-only; soln-* test patients excluded).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../decks/package.json'));
const fhirpath = require('fhirpath');
const r4 = require('fhirpath/fhir-context/r4');
const BASE = process.env.FHIR_BASE || 'https://gw.interop.community/QHConnectathon2026/open';
const L = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const csv = (name) => {
  const [head, ...rows] = fs.readFileSync(path.join(here, 'results', 'kpis', `${name}.csv`), 'utf8').trim().split(/\r?\n/).map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};
const [periodStart, periodEnd] = fs.readFileSync(path.join(here, 'results', 'kpis', 'PERIOD.txt'), 'utf8').trim().split(' ');

// 1. Shapes
for (const f of fs.readdirSync(path.join(here, 'views'))) {
  const v = readJson(path.join(here, 'views', f));
  check(`ViewDefinition ${f}`, v.resourceType === 'ViewDefinition' && v.name && v.resource && v.status && v.select?.[0]?.column?.every((c) => c.name && c.path),
    `${v.resource}, ${v.select[0].column.length} columns`);
}
const measures = fs.readdirSync(path.join(here, 'measures')).map((f) => [f, readJson(path.join(here, 'measures', f))]);
for (const [f, m] of measures) check(`Measure ${f}`, m.resourceType === 'Measure' && m.url && m.scoring && m.group?.[0]?.population?.length, m.scoring.coding[0].code);

// 2. Every criterion on every bundle
const bundles = new Map();
const patientOf = (r) => r.resourceType === 'Patient' ? r.id : (r.subject || r.patient || r.for)?.reference?.match(/^Patient\/(.+)$/)?.[1];
for (const f of fs.readdirSync(path.join(here, 'data')).filter((x) => x.endsWith('.ndjson'))) {
  for (const line of fs.readFileSync(path.join(here, 'data', f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line), p = patientOf(r);
    if (p) (bundles.get(p) ?? bundles.set(p, { resourceType: 'Bundle', type: 'collection', entry: [] }).get(p)).entry.push({ resource: r });
  }
}
for (const [f, m] of measures) {
  for (const g of m.group) {
    for (const [kind, items] of [['population', g.population], ['stratifier', g.stratifier || []]]) {
      for (const it of items) {
        const label = it.code.coding?.[0].code || it.code.text;
        let bad = null;
        try {
          const fn = fhirpath.compile(it.criteria.expression, r4);
          for (const [pid, b] of bundles) {
            const v = fn(b, { periodStart, periodEnd });
            if (kind === 'population' ? !(v.length === 1 && typeof v[0] === 'boolean') : v.length > 1) { bad = `${pid} -> ${JSON.stringify(v)}`; break; }
          }
        } catch (e) { bad = e.message; }
        check(`${f} ${kind} ${label} evaluates on ${bundles.size} bundles`, !bad, bad || '');
      }
    }
  }
}

// 3. SQL vs MeasureReport
const report = (name) => readJson(path.join(here, 'results', 'measure-reports', `${name}.json`));
const popCount = (pops, code) => pops.find((p) => p.code.coding[0].code === code)?.count;
check('MeasureReports are for the same period as the KPIs', report('referrals').period.start === periodStart && report('referrals').period.end === periodEnd);
{
  const r = report('referrals').group[0];
  const byCat = {}; csv('pam09_referrals_by_quarter_and_category').forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + +x.referrals; });
  eq('referrals: total (MeasureReport vs SQL)', popCount(r.population, 'initial-population'), Object.values(byCat).reduce((a, b) => a + b, 0));
  const strat = (i) => Object.fromEntries(r.stratifier[i].stratum.map((s) => [s.value.text, popCount(s.population, 'initial-population')]));
  eq('referrals by waitlist category', strat(0), byCat);
  eq('referrals by unit', strat(1), Object.fromEntries(csv('pam12_referrals_by_unit').map((x) => [x.unit_id, +x.referrals]).sort()));
  eq('referrals by source', strat(2), Object.fromEntries(csv('pam13_referrals_by_source').map((x) => [x.referral_source, +x.referrals]).sort()));
}
{
  const r = report('anaemia-corrected').group[0];
  const sql = csv('pam15_hb_initial_vs_post');
  const strat = Object.fromEntries(r.stratifier[0].stratum.map((s) => [s.value.text, [popCount(s.population, 'numerator'), popCount(s.population, 'denominator')]]));
  eq('anaemia corrected by sex: [numerator, denominator]', strat, Object.fromEntries(sql.map((x) => [x.gender, [+x.anaemia_corrected, +x.anaemic_with_post_hb]])));
}
{
  const r = report('cleared-6-weeks').group[0];
  const sql = csv('pam07_days_with_team')[0];
  eq('cleared within 42 days: [numerator, denominator]', [popCount(r.population, 'numerator'), popCount(r.population, 'denominator')], [+sql.within_42_days, +sql.finished_episodes]);
}

// 4. SQL vs direct FHIR searches
async function all(q) {
  let url = `${BASE}/${q}&_format=json`, out = [];
  while (url) {
    const b = await (await fetch(url)).json();
    out.push(...(b.entry || []).map((e) => e.resource));
    url = (b.link || []).find((l) => l.relation === 'next')?.url;
  }
  return out;
}
const real = (rs) => rs.filter((r) => !/^Patient\/soln-/.test((r.subject || r.patient).reference));
eq('PAM 6 being managed: SQL vs EpisodeOfCare?status=active&type=pam', +csv('pam06_being_managed_now')[0].patients_being_managed,
  real(await all(`EpisodeOfCare?status=active&type=${L}/episode-type%7Cpam&_count=200`)).length);
for (const src of csv('pam13_referrals_by_source')) {
  const n = real(await all(`ServiceRequest?code=3457005&category=${L}/referral-source%7C${src.referral_source}&authored=ge${periodStart}&authored=le${periodEnd}&_count=200`)).length;
  eq(`PAM 13 referrals from ${src.referral_source}: SQL vs ServiceRequest search`, +src.referrals, n);
}
const hb = real(await all('Observation?code=http://loinc.org%7C718-7&status=final&_count=500'));
const labs = fs.readFileSync(path.join(here, 'results', 'views', 'lab_result.csv'), 'utf8').trim().split('\n').slice(1).filter((l) => l.split(',')[2] === '718-7');
eq('lab_result view: Hb rows vs Observation?code=718-7', labs.length, hb.length);

console.log(`\n${fails ? 'FAILED' : 'ALL PASS'}`);
process.exit(fails ? 1 : 0);
