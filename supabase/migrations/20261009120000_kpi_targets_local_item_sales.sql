ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS local_item_sales_target numeric(16,2) DEFAULT 0 NOT NULL;