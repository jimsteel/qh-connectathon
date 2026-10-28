/*
 * pam-filters.js — shared dashboard filters (scenario B8) as FHIR search parameters.
 *
 * Plain script, no build step: in a page, <script src="pam-filters.js"></script> gives window.PamFilters;
 * in Node, require('./pam-filters.js'). Nothing here talks to a server directly: every function that
 * needs data takes a `search(query)` function returning a flat array of resources, e.g. in a SMART app
 *     const search = (q) => client.request(q, { pageLimit: 0, flat: true });
 *
 * Filter state (all optional; empty / missing = no filter):
 *     { directorate: 'surgical', unit: 'pam-unit-orthopaedics', category: '1',
 *       source: 'surgeon', from: '2025-07-01', to: '2026-06-30' }
 *
 * Where each filter lives in the data (see ../../FHIR-Mapping-DRAFT.md and ../../data/generate.py):
 *   timeframe        referral ServiceRequest (code SNOMED 3457005).authoredOn  -> `authored`
 *   referral source  referral ServiceRequest.category (local referral-source)   -> `category`
 *   waitlist cat.    waitlist ServiceRequest.category (local elective-category) -> `category`
 *   unit             waitlist ServiceRequest.performer (Organization)          -> `performer`
 *   directorate      not in the data: a lookup of units per directorate below, expanded to `performer`
 *                    (with directorate Organizations as Organization.partOf of the units, it would be
 *                    `performer:Organization.partof=Organization/<directorate>`, which Meld supports)
 */
(function (root) {
  'use strict';

  const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';
  const SYS = {
    category: `${LOCAL}/elective-category`,
    source: `${LOCAL}/referral-source`,
    sct: 'http://snomed.info/sct',
  };
  const REFERRAL_CODE = '3457005'; // SNOMED CT "Patient referral": the referral to blood management

  const UNITS = [
    { id: 'pam-unit-orthopaedics', label: 'Orthopaedics' },
    { id: 'pam-unit-colorectal', label: 'Colorectal' },
    { id: 'pam-unit-gynaecology', label: 'Gynaecology' },
    { id: 'pam-unit-cardiothoracic', label: 'Cardiothoracic' },
    { id: 'pam-unit-urology', label: 'Urology' },
  ];
  // PLACEHOLDER: the synthetic data has no directorates. This grouping is made up for the demo;
  // replace it with the real one (or with Organization.partOf in the data).
  const DIRECTORATES = [
    { id: 'surgical', label: 'Surgical and Perioperative Services', units: ['pam-unit-orthopaedics', 'pam-unit-colorectal', 'pam-unit-urology'] },
    { id: 'womens', label: "Women's and Newborn Services", units: ['pam-unit-gynaecology'] },
    { id: 'heart-lung', label: 'Heart and Lung', units: ['pam-unit-cardiothoracic'] },
  ];
  const CATEGORIES = [
    { code: '1', label: 'Category 1' }, { code: '2', label: 'Category 2' }, { code: '3', label: 'Category 3' },
  ];
  const SOURCES = [
    { code: 'surgeon', label: 'Surgeon' }, { code: 'preadmission', label: 'Pre-admission clinic' },
    { code: 'anaesthetist', label: 'Anaesthetist' }, { code: 'gp', label: 'General practitioner' },
  ];

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** Timeframe presets: Australian financial years (1 July – 30 June) and their quarters, plus "all". */
  function timeframes(today = new Date()) {
    const out = [{ id: 'all', label: 'All time', from: '', to: '' }];
    const fyStart = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    for (let y = fyStart; y >= fyStart - 1; y--) {
      const fy = `FY ${y}–${String(y + 1).slice(2)}`;
      out.push({ id: `fy${y}`, label: fy + (y === fyStart ? ' (to date)' : ''), from: `${y}-07-01`, to: `${y + 1}-06-30` });
      for (let q = 0; q < 4; q++) {
        const s = new Date(y, 6 + 3 * q, 1), e = new Date(y, 9 + 3 * q, 0);
        if (s > today) break;
        out.push({ id: `fy${y}q${q + 1}`, label: `${fy} Q${q + 1}`, from: iso(s), to: iso(e) });
      }
    }
    const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
    out.push({ id: 'last90', label: 'Last 90 days', from: iso(d90), to: iso(today) });
    return out;
  }

  const KEYS = ['directorate', 'unit', 'category', 'source', 'from', 'to'];
  const clean = (f) => Object.fromEntries(KEYS.filter((k) => f && f[k]).map((k) => [k, String(f[k])]));

  /** Filter state from / to URL query parameters (so a filtered view can be bookmarked or shared). */
  function fromUrl(search = (typeof location !== 'undefined' ? location.search : '')) {
    const p = new URLSearchParams(search);
    return clean(Object.fromEntries(KEYS.map((k) => [k, p.get(k)])));
  }
  function toUrl(f, search = (typeof location !== 'undefined' ? location.search : '')) {
    const p = new URLSearchParams(search);
    KEYS.forEach((k) => p.delete(k));
    Object.entries(clean(f)).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }

  /** Units allowed by the directorate and unit filters, or null when neither is set. */
  function performerIds(f) {
    let ids = null;
    if (f.directorate) {
      const d = DIRECTORATES.find((x) => x.id === f.directorate);
      ids = d ? [...d.units] : [];
    }
    if (f.unit) ids = ids ? ids.filter((u) => u === f.unit) : [f.unit];
    return ids;
  }

  const enc = (s) => s.replaceAll('|', '%7C'); // Meld rejects a raw '|' in a query string

  /**
   * Search parameters for the two ServiceRequests that carry the filters. Every one of these is a
   * standard R4 search parameter that Meld (HAPI 6) supports — see README for the test results.
   * Returns { waitlist: [[name, value]...], referral: [[name, value]...], empty: bool }.
   * `empty` is true when the filters can't match anything (a unit outside the chosen directorate).
   */
  function searchParams(f) {
    f = clean(f);
    // A system-only token (`system|`) selects every waitlist entry, whatever its category
    const waitlist = [['category', `${SYS.category}|${f.category || ''}`]];
    const referral = [['code', `${SYS.sct}|${REFERRAL_CODE}`]];
    const perf = performerIds(f);
    if (perf) waitlist.push(['performer', perf.map((u) => `Organization/${u}`).join(',')]);
    if (f.source) referral.push(['category', `${SYS.source}|${f.source}`]);
    if (f.from) referral.push(['authored', `ge${f.from}`]);
    if (f.to) referral.push(['authored', `le${f.to}`]);
    return { waitlist, referral, empty: !!perf && perf.length === 0 };
  }

  const qs = (pairs) => pairs.map(([k, v]) => `${k}=${enc(v)}`).join('&');

  /** The FHIR searches that resolve the filtered cohort (exact semantics; see cohort()). */
  function cohortQueries(f) {
    const p = searchParams(f);
    const q = {
      referral: `ServiceRequest?${qs(p.referral)}&_count=200`,
      waitlist: `ServiceRequest?${qs(p.waitlist)}&_count=200`,
    };
    return { ...q, empty: p.empty };
  }

  /**
   * One-search alternative: `_has` parameters that restrict any patient-linked search to the cohort,
   * e.g. 'Patient?' + hasParams(f) or 'Observation?code=718-7&' + hasParams(f, 'patient:Patient.').
   * Caveat (documented in the README): each `_has` is matched independently, so the timeframe can match
   * the *waitlist* entry's authoredOn rather than the referral's. Use cohort() when that matters.
   */
  function hasParams(f, prefix = '') {
    const p = searchParams(f);
    const has = (name, value) => `${prefix}_has:ServiceRequest:subject:${name}=${enc(value)}`;
    return [...p.referral, ...p.waitlist].map(([k, v]) => has(k, v)).join('&');
  }

  const subjectId = (r) => (r.subject?.reference || '').split('/').pop();

  /**
   * Resolve the filtered cohort with two ServiceRequest searches (all filtering on the server)
   * and a client-side join on the patient. Returns
   *   { patientIds: Set, referrals: Map(patientId -> referral SR), waitlist: Map(patientId -> waitlist SR) }.
   * With no filters, the cohort is every patient with a blood-management referral.
   */
  async function cohort(search, f) {
    const q = cohortQueries(f);
    if (q.empty) return { patientIds: new Set(), referrals: new Map(), waitlist: new Map(), queries: q };
    const [refs, wl] = await Promise.all([search(q.referral), search(q.waitlist)]);
    // A patient matches if ANY of their referrals and ANY of their waitlist entries match (as with `_has`);
    // for display, each patient keeps their most recent matching referral / waitlist entry (by authoredOn).
    const latest = (list) => {
      const m = new Map();
      list.filter((r) => r.resourceType === 'ServiceRequest').forEach((r) => {
        const prev = m.get(subjectId(r));
        if (!prev || (r.authoredOn || '') > (prev.authoredOn || '')) m.set(subjectId(r), r);
      });
      return m;
    };
    const referrals = latest(refs);
    const waitlist = latest(wl.filter((r) => !isReferral(r)));
    const patientIds = new Set([...referrals.keys()].filter((id) => waitlist.has(id)));
    return { patientIds, referrals, waitlist, queries: q };
  }

  const isReferral = (sr) => (sr.code?.coding || []).some((c) => c.code === REFERRAL_CODE);

  /**
   * Split a patient-scoped search into chunks of `patient=` (or `subject=`) id lists, so views can fetch
   * only the cohort's data on the server. Returns query strings. For the patients themselves use
   * { param: '_id', prefix: '' }.
   */
  function scoped(base, ids, { param = 'patient', chunk = 40, prefix = 'Patient/' } = {}) {
    const list = [...ids];
    if (!list.length) return [];
    const out = [];
    for (let i = 0; i < list.length; i += chunk) {
      out.push(`${base}${base.includes('?') ? '&' : '?'}${param}=${list.slice(i, i + chunk).map((id) => prefix + id).join(',')}&_count=500`);
    }
    return out;
  }
  async function searchScoped(search, base, ids, opts) {
    const pages = await Promise.all(scoped(base, ids, opts).map((q) => search(q)));
    return pages.flat();
  }

  /** Plain-language summary of the active filters. */
  function describe(f) {
    f = clean(f);
    const parts = [];
    if (f.directorate) parts.push(DIRECTORATES.find((d) => d.id === f.directorate)?.label || f.directorate);
    if (f.unit) parts.push(UNITS.find((u) => u.id === f.unit)?.label || f.unit);
    if (f.category) parts.push(`waitlist category ${f.category}`);
    if (f.source) parts.push(`referred by ${SOURCES.find((s) => s.code === f.source)?.label.toLowerCase() || f.source}`);
    if (f.from || f.to) parts.push(`referred ${f.from || '…'} to ${f.to || '…'}`);
    return parts.length ? parts.join(' · ') : 'All referrals';
  }

  /**
   * Render a filter bar into `el` (a page element). Calls onChange(filters) on every change and keeps
   * the filters in the page URL. Returns { get(), set(f) }.
   */
  function renderBar(el, onChange, { today } = {}) {
    const tfs = timeframes(today);
    const opt = (v, l) => `<option value="${v}">${l}</option>`;
    el.classList.add('pam-filters');
    el.innerHTML = `
      <label>Directorate <select data-k="directorate">${opt('', 'All')}${DIRECTORATES.map((d) => opt(d.id, d.label)).join('')}</select></label>
      <label>Unit <select data-k="unit">${opt('', 'All')}${UNITS.map((u) => opt(u.id, u.label)).join('')}</select></label>
      <label>Waitlist category <select data-k="category">${opt('', 'All')}${CATEGORIES.map((c) => opt(c.code, c.label)).join('')}</select></label>
      <label>Referral source <select data-k="source">${opt('', 'All')}${SOURCES.map((s) => opt(s.code, s.label)).join('')}</select></label>
      <label>Timeframe <select data-k="timeframe">${tfs.map((t) => opt(t.id, t.label)).join('')}${opt('custom', 'Custom…')}</select></label>
      <span class="pam-filters-custom" hidden>
        <input type="date" data-k="from" aria-label="From"> – <input type="date" data-k="to" aria-label="To">
      </span>`;
    const $ = (k) => el.querySelector(`[data-k="${k}"]`);
    const custom = el.querySelector('.pam-filters-custom');
    let state = {};

    function set(f) {
      state = clean(f);
      ['directorate', 'unit', 'category', 'source'].forEach((k) => { $(k).value = state[k] || ''; });
      const tf = tfs.find((t) => t.from === (state.from || '') && t.to === (state.to || ''));
      $('timeframe').value = tf ? tf.id : 'custom';
      custom.hidden = !!tf;
      $('from').value = state.from || ''; $('to').value = state.to || '';
    }
    function changed(e) {
      const k = e.target.dataset.k;
      if (k === 'timeframe') {
        const tf = tfs.find((t) => t.id === e.target.value);
        custom.hidden = !!tf;
        if (tf) { state.from = tf.from; state.to = tf.to; }
      } else {
        state[k] = e.target.value;
      }
      // Keep unit consistent with directorate
      if (k === 'directorate' && state.unit && performerIds({ directorate: state.directorate }) &&
          !performerIds({ directorate: state.directorate }).includes(state.unit)) state.unit = '';
      set(state);
      if (typeof history !== 'undefined') history.replaceState(null, '', `?${toUrl(state)}`);
      onChange(get());
    }
    function get() { return clean(state); }
    el.addEventListener('change', changed);
    set(fromUrl());
    return { get, set };
  }

  const api = {
    SYS, REFERRAL_CODE, UNITS, DIRECTORATES, CATEGORIES, SOURCES,
    timeframes, fromUrl, toUrl, performerIds, searchParams, cohortQueries, hasParams,
    cohort, scoped, searchScoped, describe, renderBar, isReferral,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PamFilters = api;
})(typeof window !== 'undefined' ? window : globalThis);
