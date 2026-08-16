-- Create invoices table for tracking customer invoices
CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" bigint NOT NULL,
    "invoice_number" "text" NOT NULL UNIQUE,
    "customer_code" "text" NOT NULL,
    "salesman_code" "text",
    "due_date" "date" NOT NULL,
    "pending_amount" numeric(16,4) DEFAULT 0 NOT NULL,
    "ref_no" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_customer_code_fkey" FOREIGN KEY ("customer_code") REFERENCES "public"."customers" ("customer_code") ON DELETE CASCADE
);

ALTER TABLE "public"."invoices" OWNER TO "postgres";

ALTER TABLE "public"."invoices" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."invoices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- Create collection_visits table for tracking payment collection attempts
CREATE TABLE IF NOT EXISTS "public"."collection_visits" (
    "id" bigint NOT NULL,
    "customer_code" "text" NOT NULL,
    "visit_outcome" "text" NOT NULL,
    "payment_status" "text",
    "amount_received" numeric(16,4) DEFAULT 0 NOT NULL,
    "receipt_mode" "text",
    "next_visit_at" "date",
    "remark_arabic" "text",
    "remark_english" "text",
    "non_payment_reason" "text",
    "payment_copy_url" "text",
    "receipt_copy_url" "text",
    "created_by" "uuid",
    "saved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collection_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "collection_visits_customer_code_fkey" FOREIGN KEY ("customer_code") REFERENCES "public"."customers" ("customer_code") ON DELETE CASCADE,
    CONSTRAINT "collection_visits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users" ("id") ON DELETE SET NULL
);

ALTER TABLE "public"."collection_visits" OWNER TO "postgres";

ALTER TABLE "public"."collection_visits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."collection_visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- Create legal_transfers table for customers escalated to legal collections
CREATE TABLE IF NOT EXISTS "public"."legal_transfers" (
    "customer_code" "text" NOT NULL,
    "is_transferred" boolean DEFAULT true NOT NULL,
    "transferred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transferred_by" "uuid",
    "note" "text",
    CONSTRAINT "legal_transfers_pkey" PRIMARY KEY ("customer_code"),
    CONSTRAINT "legal_transfers_customer_code_fkey" FOREIGN KEY ("customer_code") REFERENCES "public"."customers" ("customer_code") ON DELETE CASCADE,
    CONSTRAINT "legal_transfers_transferred_by_fkey" FOREIGN KEY ("transferred_by") REFERENCES "auth"."users" ("id") ON DELETE SET NULL
);

ALTER TABLE "public"."legal_transfers" OWNER TO "postgres";

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_invoices_customer_code" ON "public"."invoices" ("customer_code");
CREATE INDEX IF NOT EXISTS "idx_invoices_due_date" ON "public"."invoices" ("due_date");
CREATE INDEX IF NOT EXISTS "idx_collection_visits_customer_code" ON "public"."collection_visits" ("customer_code");
CREATE INDEX IF NOT EXISTS "idx_collection_visits_saved_at" ON "public"."collection_visits" ("saved_at" DESC);

-- Enable RLS if needed
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."collection_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."legal_transfers" ENABLE ROW LEVEL SECURITY;
