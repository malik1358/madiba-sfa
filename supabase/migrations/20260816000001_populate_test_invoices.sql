-- Populate test invoices for collection testing
-- This creates invoices for the first 50 active customers to test collection workflow

INSERT INTO "public"."invoices" (
    "invoice_number",
    "customer_code",
    "salesman_code",
    "due_date",
    "pending_amount",
    "ref_no"
) 
SELECT
    'INV-' || ROW_NUMBER() OVER (ORDER BY c.customer_code),
    c.customer_code,
    c.current_salesman_code,
    CURRENT_DATE - (ROW_NUMBER() OVER (ORDER BY c.customer_code) % 120),
    (ROW_NUMBER() OVER (ORDER BY c.customer_code) % 5 + 1) * 1000 + (ROW_NUMBER() OVER (ORDER BY c.customer_code) % 500),
    'REF-' || ROW_NUMBER() OVER (ORDER BY c.customer_code)
FROM "public"."customers" c
WHERE c.is_active = true
LIMIT 50
ON CONFLICT DO NOTHING;
