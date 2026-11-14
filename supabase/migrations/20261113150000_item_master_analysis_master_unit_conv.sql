-- Base units per master unit (Power BI T_Master Unit Converation).
-- Divide stock/sales qty by this to express quantities in the master unit.

ALTER TABLE public.item_master_analysis
  ADD COLUMN IF NOT EXISTS tally_master_unit_conv numeric;

COMMENT ON COLUMN public.item_master_analysis.tally_master_unit_conv IS
  'Tally Master Unit Conversion (Power BI T_Master Unit Converation): base units per master unit. Stock/sales in master unit = qty / this value.';
