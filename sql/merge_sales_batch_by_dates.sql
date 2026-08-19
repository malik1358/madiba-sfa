-- Run in Supabase SQL Editor to enable incremental sales uploads by date.
-- After applying, uploads replace only the transaction dates found in the Excel file.

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
    DELETE FROM public.sales_raw
    WHERE import_batch_id = v_active_batch_id
      AND transaction_date = ANY (p_dates);
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

CREATE OR REPLACE FUNCTION public.refresh_import_batch_stats(p_batch_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  UPDATE public.import_batches
  SET
    total_rows = (
      SELECT count(*)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
    ),
    customer_count = (
      SELECT count(DISTINCT customer_code)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
        AND customer_code IS NOT NULL
    ),
    item_count = (
      SELECT count(DISTINCT item_code)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
        AND item_code IS NOT NULL
    ),
    salesman_count = (
      SELECT count(DISTINCT salesman_code)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
        AND salesman_code IS NOT NULL
    ),
    min_transaction_date = (
      SELECT min(transaction_date)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
    ),
    max_transaction_date = (
      SELECT max(transaction_date)
      FROM public.sales_raw
      WHERE import_batch_id = p_batch_id
    )
  WHERE id = p_batch_id;
END;
$$;
