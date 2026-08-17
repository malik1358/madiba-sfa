-- Test data for collections feature
-- Run this in Supabase SQL Editor to populate test data

-- 1. Check if customers exist for your salesman
SELECT customer_code, customer_name, current_salesman_code 
FROM customers 
WHERE current_salesman_code ILIKE '%AHMED%' OR current_salesman_code ILIKE '%NABIL%'
LIMIT 10;

-- 2. If no customers, check what customers exist
SELECT DISTINCT current_salesman_code, COUNT(*) as count
FROM customers
WHERE is_active = true
GROUP BY current_salesman_code
ORDER BY count DESC
LIMIT 10;

-- 3. Add test invoices for the first active customer assigned to AHMED NABIL
-- Replace 'C001' with an actual customer_code from the customers table
INSERT INTO invoices (invoice_number, customer_code, salesman_code, due_date, pending_amount, ref_no)
VALUES 
  ('INV-TEST-001', 'C001', 'AHMED NABIL', CURRENT_DATE - INTERVAL '5 days', 5000, 'INV-001'),
  ('INV-TEST-002', 'C001', 'AHMED NABIL', CURRENT_DATE - INTERVAL '15 days', 8500, 'INV-002'),
  ('INV-TEST-003', 'C002', 'AHMED NABIL', CURRENT_DATE - INTERVAL '45 days', 12000, 'INV-003'),
  ('INV-TEST-004', 'C002', 'AHMED NABIL', CURRENT_DATE - INTERVAL '75 days', 15000, 'INV-004-C')
ON CONFLICT (invoice_number) DO NOTHING;

-- 4. Verify invoices were inserted
SELECT customer_code, invoice_number, due_date, pending_amount, ref_no
FROM invoices
WHERE salesman_code ILIKE '%AHMED%'
ORDER BY due_date DESC;
