-- Tally item master unit + name for sales voucher Excel export.
-- Units can be seeded from ITEM MASTER.xlsx and later refreshed from invoice PDFs.

ALTER TABLE public.items_master
  ADD COLUMN IF NOT EXISTS tally_unit text,
  ADD COLUMN IF NOT EXISTS tally_item_name text,
  ADD COLUMN IF NOT EXISTS tally_unit_source text,
  ADD COLUMN IF NOT EXISTS tally_unit_updated_at timestamptz;

COMMENT ON COLUMN public.items_master.tally_unit IS 'Master unit for Tally sales voucher Excel export (from ITEM MASTER upload or invoice PDF).';
COMMENT ON COLUMN public.items_master.tally_item_name IS 'Tally stock item name (usually CODE_Name).';
COMMENT ON COLUMN public.items_master.tally_unit_source IS 'excel_import | invoice_pdf | manual';

CREATE INDEX IF NOT EXISTS idx_items_master_tally_unit
  ON public.items_master (item_code)
  WHERE tally_unit IS NOT NULL AND btrim(tally_unit) <> '';
