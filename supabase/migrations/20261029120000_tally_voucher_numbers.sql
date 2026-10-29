-- Sticky Tally voucher numbers on sales orders, one sequence per city + cash/credit.

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS tally_voucher_number text,
  ADD COLUMN IF NOT EXISTS tally_voucher_assigned_at timestamptz;

COMMENT ON COLUMN public.sales_orders.tally_voucher_number IS
  'Tally import voucher number assigned on first Excel export and kept forever.';

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_tally_voucher_number_uidx
  ON public.sales_orders (tally_voucher_number)
  WHERE tally_voucher_number IS NOT NULL AND btrim(tally_voucher_number) <> '';

CREATE TABLE IF NOT EXISTS public.tally_voucher_sequences (
  series_key text PRIMARY KEY,
  prefix text NOT NULL,
  last_number integer NOT NULL CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tally_voucher_sequences IS
  'Last used numeric part for each Tally voucher series (city + cash/credit).';

INSERT INTO public.tally_voucher_sequences (series_key, prefix, last_number)
VALUES
  ('dammam_cash', 'DC', 67),
  ('dammam_credit', 'DNFD', 133),
  ('jeddah_cash', 'JC', 1),
  ('jeddah_credit', 'JNFD', 10),
  ('riyadh_cash', 'RC', 142),
  ('riyadh_credit', 'RNFD', 637)
ON CONFLICT (series_key) DO NOTHING;

ALTER TABLE public.tally_voucher_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.allocate_tally_voucher_number(
  p_order_id bigint,
  p_series_key text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing text;
  next_num integer;
  seq_prefix text;
  voucher text;
BEGIN
  IF p_order_id IS NULL OR btrim(coalesce(p_series_key, '')) = '' THEN
    RAISE EXCEPTION 'order id and series key are required';
  END IF;

  SELECT nullif(btrim(tally_voucher_number), '')
  INTO existing
  FROM public.sales_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  UPDATE public.tally_voucher_sequences
  SET last_number = last_number + 1,
      updated_at = now()
  WHERE series_key = p_series_key
  RETURNING last_number, prefix INTO next_num, seq_prefix;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown tally voucher series %', p_series_key;
  END IF;

  voucher := seq_prefix || '/' || lpad(next_num::text, 4, '0');

  UPDATE public.sales_orders
  SET tally_voucher_number = voucher,
      tally_voucher_assigned_at = now()
  WHERE id = p_order_id
    AND (tally_voucher_number IS NULL OR btrim(tally_voucher_number) = '');

  SELECT nullif(btrim(tally_voucher_number), '')
  INTO existing
  FROM public.sales_orders
  WHERE id = p_order_id;

  RETURN existing;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_tally_voucher_number(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_tally_voucher_number(bigint, text) TO service_role;
