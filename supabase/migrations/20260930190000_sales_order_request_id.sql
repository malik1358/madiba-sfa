ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_request_id_key
  ON public.sales_orders (request_id)
  WHERE request_id IS NOT NULL;