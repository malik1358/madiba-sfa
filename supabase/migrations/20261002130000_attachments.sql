-- Provider-independent attachment metadata. Files stay in Supabase Storage in Phase 1;
-- object_key is `${bucket}/${path}` so the same key can later point at R2.
CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL
    CHECK (category IN ('receipt_copy', 'payment_copy', 'order_invoice', 'customer_document')),
  storage_provider text NOT NULL
    CHECK (storage_provider IN ('supabase', 'r2')),
  object_key text NOT NULL,
  content_type text,
  size_bytes bigint,
  sha256 text,
  md5 text,
  original_file_name text,
  customer_code text,
  entity_type text,
  entity_id text,
  uploaded_by uuid,
  legacy_bucket text,
  legacy_path text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_provider_object_key_key UNIQUE (storage_provider, object_key)
);

CREATE INDEX IF NOT EXISTS attachments_entity_idx
  ON public.attachments (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS attachments_customer_code_idx
  ON public.attachments (customer_code);

-- Service role only: no browser policies.
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.collection_visits
  ADD COLUMN IF NOT EXISTS receipt_attachment_id uuid REFERENCES public.attachments (id),
  ADD COLUMN IF NOT EXISTS payment_attachment_id uuid REFERENCES public.attachments (id);

CREATE INDEX IF NOT EXISTS collection_visits_receipt_attachment_id_idx
  ON public.collection_visits (receipt_attachment_id)
  WHERE receipt_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS collection_visits_payment_attachment_id_idx
  ON public.collection_visits (payment_attachment_id)
  WHERE payment_attachment_id IS NOT NULL;

ALTER TABLE public.customer_documents
  ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES public.attachments (id);

CREATE INDEX IF NOT EXISTS customer_documents_attachment_id_idx
  ON public.customer_documents (attachment_id)
  WHERE attachment_id IS NOT NULL;
