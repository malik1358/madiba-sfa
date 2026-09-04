ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS collection_target numeric(16,2) DEFAULT 0 NOT NULL;

ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS updated_by uuid;
