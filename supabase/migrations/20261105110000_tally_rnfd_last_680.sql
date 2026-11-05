-- Riyadh wholesale credit last used voucher is RNFD/680. Next issue is RNFD/0681.

UPDATE public.tally_voucher_sequences
SET last_number = GREATEST(last_number, 680),
    updated_at = now()
WHERE series_key = 'riyadh_credit';
