ALTER TABLE public.collection_visits
  ADD COLUMN IF NOT EXISTS client_submission_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS collection_visits_client_submission_id_key
  ON public.collection_visits (client_submission_id)
  WHERE client_submission_id IS NOT NULL;
