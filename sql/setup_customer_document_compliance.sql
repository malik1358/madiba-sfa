-- Customer document compliance fields (CR matching, extracted PDF data)
-- Run in Supabase SQL Editor if the migration has not been applied.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS cr_number text;

ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS extracted_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parsed_cr_number text,
  ADD COLUMN IF NOT EXISTS parsed_vat_number text,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS link_status text,
  ADD COLUMN IF NOT EXISTS link_message text,
  ADD COLUMN IF NOT EXISTS original_file_name text;

CREATE INDEX IF NOT EXISTS customer_documents_customer_code_idx
  ON public.customer_documents (customer_code);

CREATE INDEX IF NOT EXISTS customer_documents_type_idx
  ON public.customer_documents (customer_code, document_type, created_at DESC);
