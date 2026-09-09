-- Audit trail for stock-take scan edits and deletes.

ALTER TABLE public.stock_take_lines
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_name text;

CREATE TABLE IF NOT EXISTS public.stock_take_line_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid,
  session_id uuid,
  warehouse_name text,
  warehouse_key text,
  item_code text,
  item_name text,
  action text NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL DEFAULT '',
  diffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb
);

CREATE INDEX IF NOT EXISTS stock_take_line_changes_line_idx
  ON public.stock_take_line_changes (line_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS stock_take_line_changes_warehouse_idx
  ON public.stock_take_line_changes (warehouse_key, changed_at DESC);

ALTER TABLE public.stock_take_line_changes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.stock_take_line_changes TO service_role;
