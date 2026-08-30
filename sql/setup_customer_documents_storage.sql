-- Customer master document uploads. Run in Supabase SQL Editor.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('customer-documents', 'customer-documents', true, 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read customer document files" ON storage.objects;
CREATE POLICY "Public read customer document files"
ON storage.objects FOR SELECT
USING (bucket_id = 'customer-documents');

DROP POLICY IF EXISTS "Authenticated upload customer document files" ON storage.objects;
CREATE POLICY "Authenticated upload customer document files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'customer-documents');
