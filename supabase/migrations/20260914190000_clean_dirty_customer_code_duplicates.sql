-- Clean duplicate customer master rows where customer_code is "CODE  Company Name"
-- and a clean twin row already exists as CODE.
--
-- Example:
--   dirty: 1109C  Dhajja Al Tawfeer Trading Company  (often wrongly on another salesman)
--   clean: 1109C
--
-- Steps:
-- 1) Remap sales_raw / sales_orders / invoices from dirty -> clean code
-- 2) Preserve newer latest_transaction_date on the clean row
-- 3) Delete the dirty duplicate master rows
--
-- Safe scope: only numeric/C-prefix codes with whitespace + trailing name, when a twin exists.
-- Does not touch name-only codes (e.g. "Al-muntaj Al-Raqi trading company").

begin;

create temporary table dirty_customer_map on commit drop as
select
  c.id as dirty_id,
  c.customer_code as dirty_code,
  c.customer_name as dirty_name,
  c.latest_transaction_date as dirty_latest_txn,
  x.customer_code as clean_code,
  x.customer_name as clean_name,
  x.id as clean_id
from customers c
join customers x
  on upper(trim(x.customer_code)) = upper(trim(substring(c.customer_code from '^([0-9]+C?)[[:space:]]+')))
 and x.customer_code is distinct from c.customer_code
where c.customer_code ~ '^[0-9]+C?[[:space:]]+.+';

update sales_raw s
set customer_code = m.clean_code,
    customer_name = coalesce(nullif(trim(m.clean_name), ''), s.customer_name)
from dirty_customer_map m
where s.customer_code = m.dirty_code;

update sales_orders s
set customer_code = m.clean_code,
    customer_name = coalesce(nullif(trim(m.clean_name), ''), s.customer_name)
from dirty_customer_map m
where s.customer_code = m.dirty_code;

update invoices i
set customer_code = m.clean_code
from dirty_customer_map m
where i.customer_code = m.dirty_code;

update customers c
set latest_transaction_date = greatest(c.latest_transaction_date, m.dirty_latest_txn),
    updated_at = now()
from dirty_customer_map m
where c.id = m.clean_id
  and m.dirty_latest_txn is not null
  and (c.latest_transaction_date is null or m.dirty_latest_txn > c.latest_transaction_date);

delete from customers c
using dirty_customer_map m
where c.id = m.dirty_id;

commit;
