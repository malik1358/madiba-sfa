ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS gps_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS gps_updated_by uuid,
  ADD COLUMN IF NOT EXISTS gps_updated_by_name text,
  ADD COLUMN IF NOT EXISTS gps_update_source text;

CREATE TABLE IF NOT EXISTS public.customer_gps_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL,
  latitude double precision,
  longitude double precision,
  previous_latitude double precision,
  previous_longitude double precision,
  source text NOT NULL DEFAULT 'unknown',
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_gps_history_customer
  ON public.customer_gps_history (customer_code, created_at DESC);

ALTER TABLE public.customer_gps_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_gps_history_select" ON public.customer_gps_history;
CREATE POLICY "customer_gps_history_select" ON public.customer_gps_history
  FOR SELECT TO authenticated
  USING (public.is_management());
