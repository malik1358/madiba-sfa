-- Attachment storage Phase 2, STEP 1 of 2: remove browser (anon/authenticated) access policies.
-- Run manually in the Supabase SQL Editor. Do not add to supabase/migrations.
-- Safe with the current production app AND the Phase 0-2 app: every upload uses the service role
-- (bypasses RLS), and public-bucket URLs / signed URLs do not depend on these policies.

BEGIN;

-- Anyone (including anon) could SELECT/list payment-collections objects through the Storage API.
DROP POLICY IF EXISTS "Public read payment collection files" ON storage.objects;

-- Any logged-in browser could upload straight into payment-collections, bypassing /api/payment-collections checks.
DROP POLICY IF EXISTS "Authenticated upload payment collection files" ON storage.objects;

-- Same two holes for customer-documents (CR / VAT / credit application files).
DROP POLICY IF EXISTS "Public read customer document files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload customer document files" ON storage.objects;

COMMIT;

-- Verification (must return 0 rows). Lists ANY remaining storage.objects policy that mentions an attachment
-- bucket, including policies created in the dashboard under other names. Review and drop those by name.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(payment-collections|customer-documents|order-invoices)';
