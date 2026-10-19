-- Create invoices table (simplified)
DROP TABLE IF EXISTS "public"."invoices" CASCADE;

CREATE TABLE "public"."invoices" (
    "id" bigserial PRIMARY KEY,
    "invoice_number" text NOT NULL UNIQUE,
    "customer_code" text NOT NULL REFERENCES "public"."customers"("customer_code") ON DELETE CASCADE,
    "salesman_code" text,
    "due_date" date NOT NULL,
    "pending_amount" numeric(16,4) NOT NULL DEFAULT 0,
    "ref_no" text,
    "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_invoices_customer_code ON "public"."invoices"("customer_code");
CREATE INDEX idx_invoices_due_date ON "public"."invoices"("due_date");

-- Create collection_visits table (simplified)
DROP TABLE IF EXISTS "public"."collection_visits" CASCADE;

CREATE TABLE "public"."collection_visits" (
    "id" bigserial PRIMARY KEY,
    "customer_code" text NOT NULL REFERENCES "public"."customers"("customer_code") ON DELETE CASCADE,
    "visit_outcome" text NOT NULL,
    "payment_status" text,
    "amount_received" numeric(16,4) NOT NULL DEFAULT 0,
    "receipt_mode" text,
    "next_visit_at" date,
    "remark_arabic" text,
    "remark_english" text,
    "non_payment_reason" text,
    "payment_copy_url" text,
    "receipt_copy_url" text,
    "created_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    "saved_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_collection_visits_customer_code ON "public"."collection_visits"("customer_code");
CREATE INDEX idx_collection_visits_saved_at ON "public"."collection_visits"("saved_at" DESC);

-- Create legal_transfers table (simplified)
DROP TABLE IF EXISTS "public"."legal_transfers" CASCADE;

CREATE TABLE "public"."legal_transfers" (
    "customer_code" text PRIMARY KEY REFERENCES "public"."customers"("customer_code") ON DELETE CASCADE,
    "is_transferred" boolean NOT NULL DEFAULT true,
    "transferred_at" timestamp with time zone DEFAULT now(),
    "transferred_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    "note" text
);
