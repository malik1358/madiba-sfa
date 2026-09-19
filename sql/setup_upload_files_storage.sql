-- Original sales / outstanding / receipt Excel uploads (Supabase Storage)
-- Run in Supabase SQL Editor if auto-create from the API fails.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'upload-files',
  'upload-files',
  false,
  52428800,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;
