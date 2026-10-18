-- Speed recent-order lists and the app-performance two-day order count.
-- Management home and pending-order paths order by updated_at; the speed check filters by created_at.
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at
  ON public.sales_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_updated_at
  ON public.sales_orders (updated_at DESC);
