-- One-off / production apply helper for New SKUs to repeat customers KPI targets.
ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS new_skus_to_repeat_customers_target integer DEFAULT 0 NOT NULL;
