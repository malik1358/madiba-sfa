-- Payment collection receipt/payment copy uploads (Supabase Storage)
-- Run in Supabase SQL Editor if auto-create from the API fails.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-collections',
  'payment-collections',
  true,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Public read for uploaded copies (URLs use /object/public/payment-collections/...)
CREATE POLICY IF NOT EXISTS "Public read payment collection files"
ON storage.objects FOR SELECT
USING (bucket_id = 'payment-collections');

-- Authenticated users can upload collection copies
CREATE POLICY IF NOT EXISTS "Authenticated upload payment collection files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'payment-collections');
