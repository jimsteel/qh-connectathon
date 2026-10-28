// B5 calculations, free of the DOM so verify.mjs can run them in Node.
(function (root) {
  const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';
  const SCT = 'http://snomed.info/sct';
  const REFERRAL_CODE = '3457005'; // SNOMED CT |Patient referral|

  // The searches (| written as %7C: Meld rejects a raw '|')
  const QUERIES = {
    // Referrals to blood management (PAM 13: referral source is their category)
    referrals: `ServiceRequest?code=${SCT}%7C${REFERRAL_CODE}&_count=200`,
    // Surgical waitlist entries (any elective category) with the surgical unit (performer Organization)
    waitlist: `ServiceRequest?category=${LOCAL}/elective-category%7C&_include=ServiceRequest:performer&_count=200`,
    // Treatment ordered (PAM 14) and the episode's outcome when nothing was ordered
    meds: `MedicationRequest?_count=200`,
    episodes: `EpisodeOfCare?type=${LOCAL}/episode-type%7Cpam&_count=200`,
  };

  // Short names for the AMT products in the data; anything else shows its own text
  const PRODUCTS = {
    '1312141000168105': 'IV iron: ferric carboxymaltose',
    '1086251000168104': 'IV iron: ferric derisomaltose',
  };
  const NOT_RECORDED = 'Not recorded';
  const NO_IRON_CLEARED = 'No iron: cleared without it';
  const UNDECIDED = 'None yet: still being managed';

  const day = (s) => (s || '').substring(0, 10);
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
  const refId = (ref) => (ref?.reference || '').split('/').pop();
  const ccText = (cc) => cc?.text || cc?.coding?.[0]?.display || cc?.coding?.[0]?.code || '';
  const localCoding = (ccs, cs) => (ccs || []).flatMap((c) => c.coding || []).find((c) => c.system === `${LOCAL}/${cs}`);
  const live = (r) => !['entered-in-error', 'cancelled', 'revoked'].includes(r.status);

  function treatmentLabel(mr) {
    const cc = mr.medicationCodeableConcept;
    const code = (cc?.coding || []).find((c) => c.system === SCT && PRODUCTS[c.code]);
    return code ? PRODUCTS[code.code] : ccText(cc) || mr.medicationReference?.display || 'Other medication';
  }

  // resources: everything the QUERIES returned. Returns one row per referral and the three tallies.
  function profile(resources, from, to) {
    const by = (type) => resources.filter((r) => r.resourceType === type);
    const orgs = Object.fromEntries(by('Organization').map((o) => [o.id, (o.name || o.id).replace(' (synthetic)', '')]));
    const srById = Object.fromEntries(by('ServiceRequest').map((s) => [s.id, s]));
    const referrals = by('ServiceRequest').filter((s) => live(s) && (s.code?.coding || []).some((c) => c.system === SCT && c.code === REFERRAL_CODE));
    const waitlist = by('ServiceRequest').filter((s) => live(s) && localCoding(s.category, 'elective-category'));
    const meds = by('MedicationRequest').filter(live);
    const episodes = by('EpisodeOfCare').filter(live);

    const rows = referrals.filter((r) => inRange(day(r.authoredOn), from, to)).map((r) => {
      const patient = refId(r.subject);
      // PAM 12 Surgical unit: the waitlist entry the referral points to (supportingInfo), else the patient's latest
      const linked = (r.supportingInfo || []).map((ref) => srById[refId(ref)]).find((s) => s && localCoding(s.category, 'elective-category'));
      const surgery = linked || waitlist.filter((w) => refId(w.subject) === patient).sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))[0];
      const perf = surgery?.performer?.[0];
      const unit = perf ? orgs[refId(perf)] || perf.display || refId(perf) : NOT_RECORDED;
      // PAM 13 Referral source: the referral's category (local referral-source code)
      const source = localCoding(r.category, 'referral-source')?.display || NOT_RECORDED;
      // PAM 14 Treatment: the latest MedicationRequest for the patient on or after the referral date;
      // without one, the episode for this referral says whether they were cleared or are still being managed
      const mr = meds.filter((m) => refId(m.subject) === patient && day(m.authoredOn) >= day(r.authoredOn))
        .sort((a, b) => (b.authoredOn || '').localeCompare(a.authoredOn || ''))[0];
      const ep = episodes.find((e) => (e.referralRequest || []).some((ref) => refId(ref) === r.id)) ||
        episodes.filter((e) => refId(e.patient) === patient).sort((a, b) => (b.period?.start || '').localeCompare(a.period?.start || ''))[0];
      const treatment = mr ? treatmentLabel(mr) : ep?.status === 'finished' ? NO_IRON_CLEARED : ep ? UNDECIDED : NOT_RECORDED;
      return { referral: r.id, patient, date: day(r.authoredOn), unit, source, treatment };
    });

    const tally = (key) => {
      const t = {};
      for (const row of rows) t[row[key]] = (t[row[key]] || 0) + 1;
      // Biggest first; "Not recorded" always last
      return Object.entries(t).sort((a, b) => (a[0] === NOT_RECORDED) - (b[0] === NOT_RECORDED) || b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    return { rows, unit: tally('unit'), source: tally('source'), treatment: tally('treatment') };
  }

  const api = { QUERIES, PRODUCTS, NOT_RECORDED, NO_IRON_CLEARED, UNDECIDED, profile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PamReferrals = api;
})(this);
