-- Attachment storage Phase 2, STEP 2 of 2: make attachment buckets private.
-- Run manually in the Supabase SQL Editor ONLY AFTER the Phase 2 app is live in production.
-- Older app builds call updateBucket(public: true) on every collection upload and would undo this.
-- Do not add to supabase/migrations.

BEGIN;

-- Receipt and payment copies. Also pins the MIME list the old app used to refresh on every upload.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png',
      'image/webp', 'image/heic', 'image/heif', 'application/pdf'
    ]
WHERE id = 'payment-collections';

-- Customer documents. If the bucket does not exist yet, the app creates it private on first upload.
UPDATE storage.buckets
SET public = false
WHERE id = 'customer-documents';

-- Order invoices are already private; this only guards against manual drift.
UPDATE storage.buckets
SET public = false
WHERE id = 'order-invoices';

COMMIT;

-- Verification: every row must show public = false. upload-files is listed for reference only (unchanged).
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('payment-collections', 'customer-documents', 'order-invoices', 'upload-files')
ORDER BY id;
