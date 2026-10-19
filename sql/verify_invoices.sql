-- Check how many invoices were actually inserted
SELECT COUNT(*) as total_invoices FROM invoices WHERE salesman_code = 'AHMED NABIL';

-- Check invoices by customer
SELECT 
  customer_code,
  COUNT(*) as invoice_count,
  SUM(pending_amount) as total_amount,
  MIN(due_date) as earliest_due_date
FROM invoices
WHERE salesman_code = 'AHMED NABIL'
GROUP BY customer_code
ORDER BY total_amount DESC;

-- Check if there are customers with no invoices
SELECT DISTINCT c.customer_code, c.customer_name
FROM customers c
WHERE c.current_salesman_code = 'AHMED NABIL'
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_code = c.customer_code)
LIMIT 20;
