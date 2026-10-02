-- Payment collection receipt/payment copy uploads (Supabase Storage)
-- Run in Supabase SQL Editor if auto-create from the API fails.
-- PRIVATE bucket: the app uploads with the service role and serves files through
-- /api/attachments/.../url signed URLs. No browser storage policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-collections',
  'payment-collections',
  false,
  20971520,
  ARRAY['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;
