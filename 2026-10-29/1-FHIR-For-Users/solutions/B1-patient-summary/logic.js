// B1 decision logic, kept free of the DOM so verify.mjs can test it in Node.
// Rules from FHIR-Mapping-DRAFT.md ("Decision rules used in calculations", to confirm with Metro North).
(function (root) {
  const LOINC = {
    hb: '718-7',        // Hemoglobin [Mass/volume] in Blood, g/L
    ferritin: '2276-4', // Ferritin [Mass/volume] in Serum or Plasma, ug/L
    tsat: '2502-3',     // Iron saturation [Mass Fraction] in Serum or Plasma, %
    crp: '1988-5',      // C reactive protein [Mass/volume] in Serum or Plasma, mg/L
  };
  // Anaemia: Hb below 130 g/L (male) or 120 g/L (female). Other / unknown sex: the female threshold
  // is NOT assumed; we say we can't classify Hb without a sex.
  const HB_THRESHOLD = { male: 130, female: 120 };
  const FERRITIN_LOW = 100, FERRITIN_HIGH = 300, TSAT_LOW = 20, CRP_HIGH = 10;

  const dateOf = (o) => (o.effectiveDateTime || o.effectivePeriod?.start || o.issued || '').substring(0, 10);

  // Observations -> { hb: [{date, value, unit, id}], ferritin: [...], ... } sorted oldest first
  function seriesByTest(observations) {
    const out = { hb: [], ferritin: [], tsat: [], crp: [] };
    for (const o of observations) {
      if (o.resourceType !== 'Observation' || o.valueQuantity?.value == null) continue;
      if (['entered-in-error', 'cancelled'].includes(o.status)) continue;
      const loinc = (o.code?.coding || []).find((c) => c.system === 'http://loinc.org')?.code;
      const key = Object.keys(LOINC).find((k) => LOINC[k] === loinc);
      if (!key) continue;
      out[key].push({ date: dateOf(o), value: o.valueQuantity.value, unit: o.valueQuantity.unit || o.valueQuantity.code, id: o.id });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }

  // Classify one set of values. Any may be undefined.
  function classify({ sex, hb, ferritin, tsat, crp }) {
    const t = HB_THRESHOLD[sex];
    const anaemia = hb == null || t == null ? null : hb < t;
    let ironDeficiency = null;
    if (ferritin != null) {
      if (ferritin < FERRITIN_LOW) ironDeficiency = true;
      else if (ferritin <= FERRITIN_HIGH) ironDeficiency = tsat == null ? null : tsat < TSAT_LOW;
      else ironDeficiency = false;
    }
    const inflammation = crp == null ? null : crp > CRP_HIGH;
    let pathway, tone;
    if (anaemia === null || ironDeficiency === null) {
      const missing = [];
      if (hb == null) missing.push('Hb');
      if (hb != null && t == null) missing.push('sex (for the Hb threshold)');
      if (ferritin == null) missing.push('ferritin');
      if (ferritin != null && ironDeficiency === null) missing.push('TSAT (ferritin is 100–300)');
      pathway = 'Can’t classify yet: needs ' + missing.join(', ');
      tone = 'unknown';
    } else if (anaemia && ironDeficiency) {
      pathway = 'Iron deficiency anaemia: iron replacement pathway'; tone = 'serious';
    } else if (!anaemia && ironDeficiency) {
      pathway = 'Iron deficiency without anaemia: consider iron replacement'; tone = 'warning';
    } else if (anaemia && !ironDeficiency) {
      pathway = inflammation
        ? 'Anaemia without iron deficiency, with inflammation: likely anaemia of chronic disease'
        : 'Anaemia without iron deficiency: investigate other causes';
      tone = 'warning';
    } else {
      pathway = 'No anaemia or iron deficiency: can be cleared'; tone = 'good';
    }
    return { anaemia, ironDeficiency, inflammation, hbThreshold: t ?? null, pathway, tone };
  }

  // Values as they stood on a date: the latest result of each test on or before it
  function valuesAt(series, date) {
    const pick = (xs) => { const ys = xs.filter((x) => !date || x.date <= date); return ys.length ? ys[ys.length - 1].value : undefined; };
    return { hb: pick(series.hb), ferritin: pick(series.ferritin), tsat: pick(series.tsat), crp: pick(series.crp) };
  }
  // "At referral": the earliest result of each test
  function initialValues(series) {
    const first = (xs) => (xs.length ? xs[0].value : undefined);
    return { hb: first(series.hb), ferritin: first(series.ferritin), tsat: first(series.tsat), crp: first(series.crp) };
  }

  // Whole days from a to b (YYYY-MM-DD), b - a, ignoring time zones
  function daysBetween(a, b) {
    const d = (s) => Date.UTC(+s.substring(0, 4), +s.substring(5, 7) - 1, +s.substring(8, 10));
    return Math.round((d(b) - d(a)) / 86400000);
  }

  const api = { LOINC, HB_THRESHOLD, FERRITIN_LOW, FERRITIN_HIGH, TSAT_LOW, CRP_HIGH, seriesByTest, classify, valuesAt, initialValues, daysBetween };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PamLogic = api;
})(this);
