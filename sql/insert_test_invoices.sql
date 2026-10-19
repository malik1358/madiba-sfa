-- Insert test invoices using EXACT customer codes from the customers table
INSERT INTO invoices (invoice_number, customer_code, salesman_code, due_date, pending_amount, ref_no)
VALUES 
  ('INV-TEST-1055-001', '1055', 'AHMED NABIL', CURRENT_DATE - INTERVAL '5 days', 5000, 'INV-001'),
  ('INV-TEST-1055-002', '1055', 'AHMED NABIL', CURRENT_DATE - INTERVAL '15 days', 8500, 'INV-002'),
  ('INV-TEST-1057-001', '1057C  AL RIYAH AL MUSMIRAT TRADING EST.', 'AHMED NABIL', CURRENT_DATE - INTERVAL '45 days', 12000, 'INV-003'),
  ('INV-TEST-1057-002', '1057C  AL RIYAH AL MUSMIRAT TRADING EST.', 'AHMED NABIL', CURRENT_DATE - INTERVAL '75 days', 15000, 'INV-004-C'),
  ('INV-TEST-1061-001', '1061C  AlTamel AlHasan Est.', 'AHMED NABIL', CURRENT_DATE - INTERVAL '25 days', 7500, 'INV-005'),
  ('INV-TEST-1071-001', '1071C  ART MART LIMITED', 'AHMED NABIL', CURRENT_DATE - INTERVAL '60 days', 22000, 'INV-006'),
  ('INV-TEST-1080-001', '1080', 'AHMED NABIL', CURRENT_DATE - INTERVAL '10 days', 3500, 'INV-007'),
  ('INV-TEST-1082-001', '1082', 'AHMED NABIL', CURRENT_DATE - INTERVAL '35 days', 9000, 'INV-008-C'),
  ('INV-TEST-1089-001', '1089C  Beauty of sense', 'AHMED NABIL', CURRENT_DATE - INTERVAL '20 days', 6200, 'INV-009'),
  ('INV-TEST-1102-001', '1102', 'AHMED NABIL', CURRENT_DATE - INTERVAL '90 days', 18500, 'INV-010'),
  ('INV-TEST-1120-001', '1120', 'AHMED NABIL', CURRENT_DATE - INTERVAL '55 days', 11000, 'INV-011'),
  ('INV-TEST-1126-001', '1126C  Five Trend Trading Company', 'AHMED NABIL', CURRENT_DATE - INTERVAL '30 days', 8800, 'INV-012-C')
ON CONFLICT (invoice_number) DO NOTHING;

-- Verify invoices were inserted
SELECT 
  c.customer_code,
  c.customer_name,
  i.invoice_number,
  i.due_date,
  i.pending_amount,
  i.ref_no
FROM invoices i
JOIN customers c ON i.customer_code = c.customer_code
WHERE i.salesman_code = 'AHMED NABIL'
ORDER BY i.due_date DESC;
