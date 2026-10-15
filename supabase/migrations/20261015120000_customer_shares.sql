-- Selective one-way customer shares: viewer can see specific customers
-- without changing ownership (current_salesman_code stays with the owner).
-- Used by My Day, Collection, Visit without order, and New order via sales-scope.

CREATE TABLE IF NOT EXISTS public.customer_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL,
  viewer_salesman_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT customer_shares_customer_code_nonempty CHECK (length(trim(customer_code)) > 0),
  CONSTRAINT customer_shares_unique_pair UNIQUE (customer_code, viewer_salesman_id)
);

CREATE INDEX IF NOT EXISTS customer_shares_viewer_idx
  ON public.customer_shares (viewer_salesman_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS customer_shares_customer_code_idx
  ON public.customer_shares (customer_code)
  WHERE is_active;

ALTER TABLE public.customer_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_shares_select_management ON public.customer_shares;
CREATE POLICY customer_shares_select_management
  ON public.customer_shares
  FOR SELECT
  TO authenticated
  USING (public.is_management());

DROP POLICY IF EXISTS customer_shares_write_management ON public.customer_shares;
CREATE POLICY customer_shares_write_management
  ON public.customer_shares
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_shares TO authenticated;
GRANT ALL ON public.customer_shares TO service_role;
