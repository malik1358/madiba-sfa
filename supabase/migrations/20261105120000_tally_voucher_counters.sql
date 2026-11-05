-- Move Tally voucher counters to the last numbers used on 5 Nov 2026.
-- Next issue is one higher. Never move a counter backwards.

INSERT INTO public.tally_voucher_sequences (series_key, prefix, last_number)
VALUES
  ('dammam_cash', 'DC', 72),
  ('dammam_credit', 'DNFD', 137),
  ('jeddah_cash', 'JC', 7),
  ('jeddah_credit', 'JNFD', 13),
  ('riyadh_cash', 'RC', 147),
  ('riyadh_retail', 'RNFR', 1),
  ('riyadh_store', 'RS', 289),
  ('riyadh_credit', 'RNFD', 679),
  ('non_food', 'NFD', 2174)
ON CONFLICT (series_key) DO UPDATE
SET prefix = EXCLUDED.prefix,
    last_number = GREATEST(public.tally_voucher_sequences.last_number, EXCLUDED.last_number),
    updated_at = now();
