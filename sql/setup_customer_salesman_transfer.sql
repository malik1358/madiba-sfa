-- Customer salesman transfer: keep the previous salesman so both can see the account.
-- Run in Supabase SQL Editor if the migration has not been applied.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS previous_salesman_code text;

CREATE INDEX IF NOT EXISTS idx_customers_previous_salesman
  ON public.customers (previous_salesman_code);

DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.is_management()
    OR current_salesman_code = public.current_salesman_code()
    OR previous_salesman_code = public.current_salesman_code()
  );
