-- Apply separately in local/dev and production Supabase. Git deployment does not apply SQL.
CREATE TABLE IF NOT EXISTS public.product_catalogue_photos (
  id uuid PRIMARY KEY,
  item_code text NOT NULL,
  file_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_catalogue_photos_item_idx
  ON public.product_catalogue_photos (item_code, created_at, id);

ALTER TABLE public.product_catalogue_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_catalogue_photos FROM anon, authenticated;
GRANT ALL ON public.product_catalogue_photos TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-catalogue', 'product-catalogue', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No browser Storage policies: authenticated API checks precede service-role access.
