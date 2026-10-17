-- Master barcode from the price sheet column AP (BARCODE Master).
-- Refreshed by /api/cron/tally-barcodes every 8 hours. Excel export reads this column.

ALTER TABLE public.items_master
  ADD COLUMN IF NOT EXISTS tally_barcode text,
  ADD COLUMN IF NOT EXISTS tally_barcode_synced_at timestamptz;

COMMENT ON COLUMN public.items_master.tally_barcode IS 'Master barcode from price sheet column AP, refreshed every 8 hours.';

CREATE INDEX IF NOT EXISTS idx_items_master_tally_barcode
  ON public.items_master (item_code)
  WHERE tally_barcode IS NOT NULL AND btrim(tally_barcode) <> '';
