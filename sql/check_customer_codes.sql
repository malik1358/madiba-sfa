-- Check exact customer codes with length and formatting
SELECT 
  customer_code,
  LENGTH(customer_code) as code_length,
  customer_name,
  current_salesman_code
FROM customers
WHERE current_salesman_code = 'AHMED NABIL'
LIMIT 10;

-- Show the hex representation to see any hidden characters
SELECT 
  customer_code,
  ENCODE(customer_code::bytea, 'hex') as hex_code,
  customer_name
FROM customers
WHERE current_salesman_code = 'AHMED NABIL'
LIMIT 10;
