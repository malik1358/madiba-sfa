-- Sales date merges used to DELETE every active-batch row whose transaction_date
-- appeared in the upload, then move the upload's rows onto the active batch.
-- A partial Excel (one salesman / one city) therefore wiped every other voucher
-- on those dates. Customer 1183 DC/0017 and the other 2026-09-13 Dammam vouchers
-- were lost that way while still living on failed batch 64.
--
-- Keep any active voucher that the upload does not re-state (same date + customer
-- + voucher number). Overlapping vouchers are still replaced by the upload.

CREATE OR REPLACE FUNCTION public.merge_sales_batch_by_dates(
  p_new_batch_id bigint,
  p_dates date[]
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_active_batch_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.import_batches
    WHERE id = p_new_batch_id
  ) THEN
    RAISE EXCEPTION 'Import batch does not exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.import_batches
    WHERE id = p_new_batch_id
      AND status = 'FAILED'
  ) THEN
    RAISE EXCEPTION 'Cannot merge failed import batch';
  END IF;

  SELECT NULLIF(setting_value, '')::bigint
  INTO v_active_batch_id
  FROM public.system_settings
  WHERE setting_key = 'active_sales_batch_id'
  LIMIT 1;

  IF v_active_batch_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.import_batches
    WHERE id = v_active_batch_id
      AND status = 'ACTIVE'
  ) THEN
    PERFORM public.activate_sales_batch(p_new_batch_id);
    RETURN p_new_batch_id;
  END IF;

  IF p_dates IS NOT NULL AND array_length(p_dates, 1) > 0 THEN
    DELETE FROM public.sales_raw AS old
    WHERE old.import_batch_id = v_active_batch_id
      AND old.transaction_date = ANY (p_dates)
      AND EXISTS (
        SELECT 1
        FROM public.sales_raw AS incoming
        WHERE incoming.import_batch_id = p_new_batch_id
          AND incoming.transaction_date = old.transaction_date
          AND upper(trim(coalesce(incoming.customer_code, '')))
            = upper(trim(coalesce(old.customer_code, '')))
          AND upper(trim(coalesce(incoming.voucher_number, '')))
            = upper(trim(coalesce(old.voucher_number, '')))
      );
  END IF;

  UPDATE public.sales_raw
  SET import_batch_id = v_active_batch_id
  WHERE import_batch_id = p_new_batch_id;

  UPDATE public.import_batches
  SET
    status = 'ARCHIVED',
    completed_at = COALESCE(completed_at, now())
  WHERE id = p_new_batch_id;

  UPDATE public.import_batches
  SET
    completed_at = now()
  WHERE id = v_active_batch_id;

  RETURN v_active_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM anon;
REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) TO service_role;
