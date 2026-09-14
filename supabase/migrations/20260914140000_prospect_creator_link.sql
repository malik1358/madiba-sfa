-- Bind prospects to the user who created them, and keep linked customers in that
-- salesman's book (current + previous) for Visit Without Order / New Order scope.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_created_by
  ON public.prospects (created_by);

-- Past: prefer the first order creator for PROSPECT-{id} rows.
UPDATE public.prospects AS p
SET created_by = src.created_by
FROM (
  SELECT DISTINCT ON (upper(trim(so.customer_code)))
    substring(upper(trim(so.customer_code)) from '^PROSPECT-([0-9]+)$')::bigint AS prospect_id,
    so.created_by
  FROM public.sales_orders AS so
  WHERE so.customer_code ~* '^PROSPECT-[0-9]+$'
    AND so.created_by IS NOT NULL
  ORDER BY upper(trim(so.customer_code)), so.created_at ASC NULLS LAST, so.id ASC
) AS src
WHERE p.id = src.prospect_id
  AND p.created_by IS NULL
  AND src.created_by IS NOT NULL;

-- Past fallback: profile that owns the prospect salesman_code.
UPDATE public.prospects AS p
SET created_by = pr.id
FROM public.profiles AS pr
WHERE p.created_by IS NULL
  AND pr.id IS NOT NULL
  AND nullif(trim(pr.salesman_code), '') IS NOT NULL
  AND upper(trim(regexp_replace(coalesce(p.salesman_code, ''), '\s+', ' ', 'g')))
    = upper(trim(regexp_replace(coalesce(pr.salesman_code, ''), '\s+', ' ', 'g')));

-- Past: move linked customers into the prospect creator's salesman book.
-- Keep the prior owner on previous_salesman_code so both can still see the account.
UPDATE public.customers AS c
SET
  previous_salesman_code = CASE
    WHEN nullif(trim(c.current_salesman_code), '') IS NULL THEN c.previous_salesman_code
    WHEN upper(trim(regexp_replace(c.current_salesman_code, '\s+', ' ', 'g')))
      = upper(trim(regexp_replace(p.salesman_code, '\s+', ' ', 'g')))
      THEN c.previous_salesman_code
    ELSE trim(c.current_salesman_code)
  END,
  current_salesman_code = trim(p.salesman_code),
  updated_at = now()
FROM public.prospects AS p
WHERE nullif(trim(p.converted_customer_code), '') IS NOT NULL
  AND nullif(trim(p.salesman_code), '') IS NOT NULL
  AND (
    upper(trim(c.customer_code)) = upper(trim(p.converted_customer_code))
    OR upper(trim(regexp_replace(coalesce(c.customer_code, ''), '\s+', ' ', 'g')))
      = upper(trim(regexp_replace(coalesce(p.converted_customer_code, ''), '\s+', ' ', 'g')))
  )
  AND upper(trim(regexp_replace(coalesce(c.current_salesman_code, ''), '\s+', ' ', 'g')))
    IS DISTINCT FROM upper(trim(regexp_replace(coalesce(p.salesman_code, ''), '\s+', ' ', 'g')));

-- RLS: creators always keep access to their own prospects.
DROP POLICY IF EXISTS "prospects_insert" ON public.prospects;
DROP POLICY IF EXISTS "prospects_select" ON public.prospects;
DROP POLICY IF EXISTS "prospects_update" ON public.prospects;

CREATE POLICY "prospects_insert" ON public.prospects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_management()
    OR created_by = auth.uid()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );

CREATE POLICY "prospects_select" ON public.prospects
  FOR SELECT TO authenticated
  USING (
    public.is_management()
    OR created_by = auth.uid()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );

CREATE POLICY "prospects_update" ON public.prospects
  FOR UPDATE TO authenticated
  USING (
    public.is_management()
    OR created_by = auth.uid()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  )
  WITH CHECK (
    public.is_management()
    OR created_by = auth.uid()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );
