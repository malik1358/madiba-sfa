-- One-off production recovery (already applied 2026-10-28).
-- Restores 2026-09-13 Dammam vouchers that survived only on failed batch 64
-- after a partial date wipe of the active sales batch:
--   1183 DC/0017, 1563 DNFD/096, 1428 DNFD/097, 1495 DNFD/098,
--   1118 DNFD/099, 1569 DNFD/100, 1025 DNFD/101.
-- Do not re-run unless those vouchers are missing from the active batch again.

WITH active AS (
  SELECT NULLIF(TRIM(BOTH '"' FROM setting_value::text), '')::bigint AS id
  FROM system_settings
  WHERE setting_key = 'active_sales_batch_id'
  LIMIT 1
),
to_restore AS (
  SELECT s.id
  FROM sales_raw s
  CROSS JOIN active
  WHERE s.import_batch_id = 64
    AND s.transaction_date = '2026-09-13'
    AND UPPER(TRIM(s.voucher_number)) IN (
      'DC/0017', 'DNFD/096', 'DNFD/097', 'DNFD/098',
      'DNFD/099', 'DNFD/100', 'DNFD/101'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM sales_raw a
      WHERE a.import_batch_id = active.id
        AND a.transaction_date = s.transaction_date
        AND UPPER(TRIM(a.customer_code)) = UPPER(TRIM(s.customer_code))
        AND UPPER(TRIM(a.voucher_number)) = UPPER(TRIM(s.voucher_number))
    )
)
UPDATE sales_raw s
SET import_batch_id = (SELECT id FROM active)
FROM to_restore t
WHERE s.id = t.id;
