-- Allow prospect writes when salesman codes match after normalization,
-- and when a head salesman registers for a subordinate.

CREATE OR REPLACE FUNCTION public.normalized_salesman_code(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(trim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.is_subordinate_salesman_code(target_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    INNER JOIN public.profiles p ON p.id = u.id
    WHERE public.normalized_salesman_code(u.raw_user_meta_data->>'head_salesman_code')
        = public.normalized_salesman_code(public.current_salesman_code())
      AND public.normalized_salesman_code(p.salesman_code)
        = public.normalized_salesman_code(target_code)
  );
$$;

DROP POLICY IF EXISTS "prospects_insert" ON public.prospects;
DROP POLICY IF EXISTS "prospects_select" ON public.prospects;
DROP POLICY IF EXISTS "prospects_update" ON public.prospects;

CREATE POLICY "prospects_insert" ON public.prospects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_management()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );

CREATE POLICY "prospects_select" ON public.prospects
  FOR SELECT TO authenticated
  USING (
    public.is_management()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );

CREATE POLICY "prospects_update" ON public.prospects
  FOR UPDATE TO authenticated
  USING (
    public.is_management()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  )
  WITH CHECK (
    public.is_management()
    OR public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code(public.current_salesman_code())
    OR public.is_subordinate_salesman_code(salesman_code)
  );
