-- One-time / ops: promote GPS from visit_report_latest onto customers missing a pin.
-- App path: fetchOutstandingNoGpsCustomers -> backfillCustomerGpsFromLastVisits.
-- Safe to re-run: only updates rows with null/zero latitude or longitude.

WITH visit_gps AS (
  SELECT
    upper(trim(coalesce(setting_value::jsonb->>'customer_code', replace(setting_key, 'visit_report_latest:', '')))) AS customer_code,
    (setting_value::jsonb->'location'->>'latitude')::double precision AS latitude,
    (setting_value::jsonb->'location'->>'longitude')::double precision AS longitude,
    coalesce(setting_value::jsonb->>'captured_at', setting_value::jsonb->>'saved_at') AS visit_at
  FROM system_settings
  WHERE setting_key LIKE 'visit_report_latest:%'
    AND setting_value::jsonb->'location'->>'latitude' IS NOT NULL
    AND setting_value::jsonb->'location'->>'longitude' IS NOT NULL
),
ranked AS (
  SELECT DISTINCT ON (customer_code)
    customer_code, latitude, longitude, visit_at
  FROM visit_gps
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    AND latitude <> 0 AND longitude <> 0
  ORDER BY customer_code, visit_at DESC NULLS LAST
),
targets AS (
  SELECT c.customer_code AS stored_code,
         c.latitude AS previous_latitude,
         c.longitude AS previous_longitude,
         r.latitude,
         r.longitude
  FROM customers c
  JOIN ranked r ON r.customer_code = upper(trim(c.customer_code))
  WHERE c.latitude IS NULL OR c.longitude IS NULL OR c.latitude = 0 OR c.longitude = 0
),
updated AS (
  UPDATE customers c
  SET latitude = t.latitude,
      longitude = t.longitude,
      gps_updated_at = now(),
      gps_update_source = 'visit',
      gps_updated_by_name = 'Visit GPS backfill',
      updated_at = now()
  FROM targets t
  WHERE c.customer_code = t.stored_code
  RETURNING c.customer_code, c.latitude, c.longitude, t.previous_latitude, t.previous_longitude
)
INSERT INTO customer_gps_history (
  customer_code, latitude, longitude, previous_latitude, previous_longitude, source, updated_by_name
)
SELECT customer_code, latitude, longitude, previous_latitude, previous_longitude, 'visit', 'Visit GPS backfill'
FROM updated;
