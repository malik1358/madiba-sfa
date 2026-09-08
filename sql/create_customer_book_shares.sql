-- Manual apply (Supabase SQL editor) if migration has not run yet.
-- Same as supabase/migrations/20260908120000_customer_book_shares.sql

CREATE TABLE IF NOT EXISTS public.customer_book_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_salesman_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_salesman_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT customer_book_shares_distinct_pair CHECK (source_salesman_id <> viewer_salesman_id),
  CONSTRAINT customer_book_shares_unique_pair UNIQUE (source_salesman_id, viewer_salesman_id)
);

CREATE INDEX IF NOT EXISTS customer_book_shares_viewer_idx
  ON public.customer_book_shares (viewer_salesman_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS customer_book_shares_source_idx
  ON public.customer_book_shares (source_salesman_id)
  WHERE is_active;

ALTER TABLE public.customer_book_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_book_shares_select_management ON public.customer_book_shares;
CREATE POLICY customer_book_shares_select_management
  ON public.customer_book_shares
  FOR SELECT
  TO authenticated
  USING (public.is_management());

DROP POLICY IF EXISTS customer_book_shares_write_management ON public.customer_book_shares;
CREATE POLICY customer_book_shares_write_management
  ON public.customer_book_shares
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_book_shares TO authenticated;
GRANT ALL ON public.customer_book_shares TO service_role;
