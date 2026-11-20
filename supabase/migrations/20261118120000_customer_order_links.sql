-- Passwordless customer/prospect order catalog links (36-hour opaque tokens).
-- Staff create links from Customer Audit or New Customer; guests redeem via /order/<token>.
-- Access is service-role only through API routes (no anon/authenticated policies).

CREATE TABLE IF NOT EXISTS public.customer_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  customer_code text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  is_prospect boolean NOT NULL DEFAULT false,
  prospect_id bigint,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  salesman_code text NOT NULL,
  salesman_name text NOT NULL DEFAULT '',
  pricing_region text NOT NULL DEFAULT 'riyadh',
  payment_type text NOT NULL DEFAULT 'credit',
  pricing_type text NOT NULL DEFAULT 'wholesale',
  expires_at timestamptz NOT NULL,
  submitted_order_id bigint REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_order_links_token_nonempty CHECK (length(trim(token)) >= 24),
  CONSTRAINT customer_order_links_customer_code_nonempty CHECK (length(trim(customer_code)) > 0),
  CONSTRAINT customer_order_links_salesman_code_nonempty CHECK (length(trim(salesman_code)) > 0),
  CONSTRAINT customer_order_links_payment_type_check CHECK (payment_type = ANY (ARRAY['cash'::text, 'credit'::text])),
  CONSTRAINT customer_order_links_pricing_type_check CHECK (pricing_type = ANY (ARRAY['wholesale'::text, 'retail'::text])),
  CONSTRAINT customer_order_links_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS customer_order_links_customer_code_idx
  ON public.customer_order_links (customer_code);

CREATE INDEX IF NOT EXISTS customer_order_links_created_by_idx
  ON public.customer_order_links (created_by);

CREATE INDEX IF NOT EXISTS customer_order_links_expires_at_idx
  ON public.customer_order_links (expires_at);

CREATE INDEX IF NOT EXISTS customer_order_links_submitted_order_id_idx
  ON public.customer_order_links (submitted_order_id)
  WHERE submitted_order_id IS NOT NULL;

ALTER TABLE public.customer_order_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_order_links FROM PUBLIC;
REVOKE ALL ON TABLE public.customer_order_links FROM anon;
REVOKE ALL ON TABLE public.customer_order_links FROM authenticated;
GRANT ALL ON TABLE public.customer_order_links TO service_role;

DROP TRIGGER IF EXISTS customer_order_links_set_updated_at ON public.customer_order_links;
CREATE TRIGGER customer_order_links_set_updated_at
  BEFORE UPDATE ON public.customer_order_links
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
