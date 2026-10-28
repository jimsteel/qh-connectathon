// B3 calculations, free of the DOM so verify.mjs can run them in Node.
(function (root) {
  const LOCAL = 'https://aehrc.github.io/qh-connectathon/track1/CodeSystem';
  const SCT = 'http://snomed.info/sct';
  // Education: SNOMED CT 409073007 |Education| and its child 311401005 |Patient education|
  const EDUCATION = ['409073007', '311401005'];

  // The searches (| written as %7C: Meld rejects a raw '|')
  const sct = EDUCATION.map((c) => `${SCT}%7C${c}`).join(',');
  const QUERIES = {
    episodes: `EpisodeOfCare?type=${LOCAL}/episode-type%7Cpam&_count=200`,
    eduProcByCode: `Procedure?code=${sct}&_count=200`,
    eduProcByCategory: `Procedure?category=${sct}&_count=200`,
    eduComm: `Communication?category=${sct}&_count=200`,
  };

  const day = (s) => (s || '').substring(0, 10);
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
  const daysBetween = (a, b) => {
    const t = (s) => Date.UTC(+s.substring(0, 4), +s.substring(5, 7) - 1, +s.substring(8, 10));
    return Math.round((t(b) - t(a)) / 86400000);
  };
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const refId = (ref) => (ref?.reference || '').split('/').pop();
  const hasEducationCode = (ccs) => (ccs || []).flatMap((cc) => cc?.coding || []).some((c) => c.system === SCT && EDUCATION.includes(c.code));

  // Education session -> { id, date, patient } or null if it isn't one
  function educationSession(r) {
    if (r.resourceType === 'Procedure') {
      if (['entered-in-error', 'not-done', 'preparation'].includes(r.status)) return null;
      if (!hasEducationCode([r.code, r.category])) return null;
      return { key: 'Procedure/' + r.id, date: day(r.performedDateTime || r.performedPeriod?.start), patient: refId(r.subject) };
    }
    if (r.resourceType === 'Communication') {
      if (['entered-in-error', 'not-done', 'preparation'].includes(r.status)) return null;
      if (!hasEducationCode(r.category)) return null;
      return { key: 'Communication/' + r.id, date: day(r.sent || r.received), patient: refId(r.subject) };
    }
    return null;
  }

  // Months YYYY-MM from a to b inclusive
  function months(a, b) {
    const out = [];
    let [y, m] = a.split('-').map(Number);
    const [y2, m2] = b.split('-').map(Number);
    while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }

  // resources: everything the QUERIES returned. from / to: YYYY-MM-DD or '' (open). today: YYYY-MM-DD.
  function kpis(resources, from, to, today) {
    const episodes = resources.filter((r) => r.resourceType === 'EpisodeOfCare' && !['entered-in-error', 'cancelled'].includes(r.status));
    const pamPatients = new Set(episodes.map((e) => refId(e.patient)));
    // PAM 6: referrals in the timeframe (by EpisodeOfCare.period.start) and where they stand now
    const inFrame = episodes.filter((e) => inRange(day(e.period?.start), from, to));
    const cleared = inFrame.filter((e) => e.status === 'finished');
    const managed = inFrame.filter((e) => ['planned', 'waitlist', 'active', 'onhold'].includes(e.status));
    // PAM 7: days with the team = period.end - period.start (cleared); today - start (still being managed)
    const clearedDays = cleared.filter((e) => e.period?.end).map((e) => daysBetween(day(e.period.start), day(e.period.end)));
    const managedDays = managed.map((e) => daysBetween(day(e.period.start), today));
    // PAM 8 / 8a: education sessions in the timeframe, for patients with a PAM episode, per month
    const seen = new Set();
    const sessions = [];
    for (const r of resources) {
      const s = educationSession(r);
      if (!s || seen.has(s.key)) continue;  // the two Procedure searches can return the same resource
      seen.add(s.key);
      if (pamPatients.has(s.patient) && inRange(s.date, from, to)) sessions.push(s);
    }
    const firstMonth = (from || [...inFrame.map((e) => day(e.period.start)), ...sessions.map((s) => s.date)].sort()[0] || today).substring(0, 7);
    const lastMonth = (to && to < today ? to : today).substring(0, 7);
    const perMonth = Object.fromEntries(months(firstMonth, lastMonth).map((m) => [m, 0]));
    for (const s of sessions) { const m = s.date.substring(0, 7); if (m in perMonth) perMonth[m]++; }
    return {
      referred: inFrame.length,
      patients: new Set(inFrame.map((e) => refId(e.patient))).size,
      managed: managed.length,
      cleared: cleared.length,
      medianDaysCleared: median(clearedDays),
      medianDaysManaged: median(managedDays),
      education: sessions.length,
      patientsEducated: new Set(sessions.map((s) => s.patient)).size,
      perMonth,
      educationPerMonth: Object.keys(perMonth).length ? sessions.length / Object.keys(perMonth).length : null,
    };
  }

  const api = { QUERIES, EDUCATION, kpis, median, daysBetween, months, educationSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PamKpi = api;
})(this);
