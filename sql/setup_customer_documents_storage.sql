-- Customer master document uploads. Run in Supabase SQL Editor.
-- PRIVATE bucket: the app uploads with the service role and serves files through
-- /api/attachments/.../url signed URLs. No browser storage policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('customer-documents', 'customer-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;
