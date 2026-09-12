-- Collectors need to read their own collection_visits so WhatsApp Est. waiting /
-- distance-from-previous use the same prior visits as Collection Report.
-- RLS was enabled without policies, so client SELECTs returned no rows.

ALTER TABLE public.collection_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collection_visits_select_own_or_management" ON public.collection_visits;
CREATE POLICY "collection_visits_select_own_or_management"
  ON public.collection_visits
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_management()
  );

DROP POLICY IF EXISTS "collection_visits_insert_own" ON public.collection_visits;
CREATE POLICY "collection_visits_insert_own"
  ON public.collection_visits
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());
