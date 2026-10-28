-- PAM KPIs as plain SQL over the SQL on FHIR views (views/*.json), run by run-views.py on Spark SQL (Pathling).
-- Each statement is one KPI; the "-- name:" line names its output in results/kpis/.
-- ${period_start} / ${period_end} are substituted by run-views.py (default FY 2025-26).
-- The cohort is "patients with a referral to blood management" (pam_referral); helper views
-- (referral_in_period, waitlist_latest, hb_series) are created first by run-views.py from the "-- view:" blocks.

-- view: waitlist_latest
SELECT * FROM (
  SELECT w.*, row_number() OVER (PARTITION BY patient_id ORDER BY authored_on DESC) AS rn FROM pam_waitlist w
) WHERE rn = 1;

-- view: referral_in_period
SELECT r.*, to_date(r.authored_on) AS referral_date
FROM pam_referral r
WHERE to_date(r.authored_on) BETWEEN DATE '${period_start}' AND DATE '${period_end}'
  AND r.patient_id IN (SELECT patient_id FROM pam_waitlist);

-- view: hb_series
SELECT patient_id, value, effective,
       row_number() OVER (PARTITION BY patient_id ORDER BY effective ASC)  AS n_first,
       row_number() OVER (PARTITION BY patient_id ORDER BY effective DESC) AS n_last,
       count(*)     OVER (PARTITION BY patient_id)                         AS n_results
FROM lab_result WHERE loinc = '718-7';

-- name: pam06_being_managed_now
-- PAM 6: patients currently being managed (active episode), regardless of period
SELECT count(DISTINCT patient_id) AS patients_being_managed FROM pam_episode WHERE status = 'active';

-- name: pam07_days_with_team
-- PAM 7: days with the team for episodes that started in the period and have finished
SELECT count(*) AS finished_episodes,
       percentile(datediff(to_date(period_end), to_date(period_start)), 0.5) AS median_days,
       min(datediff(to_date(period_end), to_date(period_start))) AS min_days,
       max(datediff(to_date(period_end), to_date(period_start))) AS max_days,
       sum(CASE WHEN datediff(to_date(period_end), to_date(period_start)) <= 42 THEN 1 ELSE 0 END) AS within_42_days
FROM pam_episode
WHERE status = 'finished' AND period_end IS NOT NULL
  AND to_date(period_start) BETWEEN DATE '${period_start}' AND DATE '${period_end}';

-- name: pam09_referrals_by_quarter_and_category
-- PAM 9: referrals per financial-year quarter by waitlist category
SELECT concat('FY', CAST(year(referral_date) + CASE WHEN month(referral_date) >= 7 THEN 0 ELSE -1 END AS STRING), '-',
              lpad(CAST((year(referral_date) + CASE WHEN month(referral_date) >= 7 THEN 1 ELSE 0 END) % 100 AS STRING), 2, '0'),
              ' Q', CAST(floor(((month(referral_date) + 5) % 12) / 3) + 1 AS STRING)) AS fy_quarter,
       w.category, count(*) AS referrals
FROM referral_in_period r JOIN waitlist_latest w USING (patient_id)
GROUP BY 1, 2 ORDER BY 1, 2;

-- name: pam10_diagnoses
-- PAM 10: diagnoses of patients referred in the period
SELECT d.code, d.display, count(DISTINCT d.patient_id) AS patients
FROM pam_diagnosis d JOIN referral_in_period r USING (patient_id)
GROUP BY 1, 2 ORDER BY patients DESC, code;

-- name: pam12_referrals_by_unit
SELECT w.unit_id, count(*) AS referrals
FROM referral_in_period r JOIN waitlist_latest w USING (patient_id)
GROUP BY 1 ORDER BY referrals DESC, unit_id;

-- name: pam13_referrals_by_source
SELECT referral_source, count(*) AS referrals FROM referral_in_period GROUP BY 1 ORDER BY referrals DESC, referral_source;

-- name: pam14_iv_iron
-- PAM 14: recommended treatment (IV iron product) for patients referred in the period
SELECT i.product, count(*) AS orders, percentile(i.dose_mg, 0.5) AS median_dose_mg
FROM iv_iron i JOIN referral_in_period r USING (patient_id)
GROUP BY 1 ORDER BY orders DESC;

-- name: pam15_hb_initial_vs_post
-- PAM 15: first vs latest Hb by sex (patients referred in the period); anaemia thresholds 130 g/L male, 120 g/L female
SELECT p.gender,
       count(*) AS patients_with_hb,
       percentile(f.value, 0.5) AS median_initial_hb,
       sum(CASE WHEN f.n_results >= 2 THEN 1 ELSE 0 END) AS with_post_hb,
       percentile(CASE WHEN f.n_results >= 2 THEN l.value END, 0.5) AS median_post_hb,
       sum(CASE WHEN f.n_results >= 2 AND f.value < CASE p.gender WHEN 'female' THEN 120 ELSE 130 END THEN 1 ELSE 0 END) AS anaemic_with_post_hb,
       sum(CASE WHEN f.n_results >= 2 AND f.value < CASE p.gender WHEN 'female' THEN 120 ELSE 130 END
                 AND l.value >= CASE p.gender WHEN 'female' THEN 120 ELSE 130 END THEN 1 ELSE 0 END) AS anaemia_corrected
FROM referral_in_period r
JOIN patient_demographics p USING (patient_id)
JOIN hb_series f ON f.patient_id = r.patient_id AND f.n_first = 1
JOIN hb_series l ON l.patient_id = r.patient_id AND l.n_last = 1
GROUP BY p.gender ORDER BY p.gender;

-- name: pam17_18_age_bands_by_sex
-- PAM 17, 18: age at referral in bands, by sex
SELECT CASE WHEN age < 50 THEN '<50' WHEN age < 60 THEN '50-59' WHEN age < 70 THEN '60-69' WHEN age < 80 THEN '70-79' ELSE '80+' END AS age_band,
       gender, count(*) AS patients
FROM (SELECT p.gender, floor(months_between(r.referral_date, to_date(p.birth_date)) / 12) AS age
      FROM referral_in_period r JOIN patient_demographics p USING (patient_id))
GROUP BY 1, 2 ORDER BY 1, 2;

-- name: pam19_postcodes
SELECT p.postcode, p.suburb, count(*) AS patients
FROM referral_in_period r JOIN patient_demographics p USING (patient_id)
GROUP BY 1, 2 ORDER BY patients DESC, postcode;
