-- Store GP amount from the sales file for Business Intelligence only.
-- Cost, margin %, and the original Excel row stay out of the SFA.

alter table public.sales_raw
  add column if not exists profit_amount numeric not null default 0;

drop view if exists public.active_sales;

create view public.active_sales as
 select sr.id,
    sr.import_batch_id,
    sr.source_row_number,
    sr.reference,
    sr.voucher_number,
    sr.voucher_type,
    sr.transaction_date,
    sr.customer_code,
    sr.customer_name,
    sr.salesman_code,
    sr.salesman_name,
    sr.item_code,
    sr.item_name,
    sr.category,
    sr.local_import,
    sr.quantity,
    sr.rate,
    sr.sales_amount,
    sr.profit_amount,
    sr.first_purchase_date,
    sr.abc_class,
    sr.source_data,
    sr.created_at
   from sales_raw sr
     join system_settings ss
       on ss.setting_key = 'active_sales_batch_id'::text
      and ss.setting_value = sr.import_batch_id::text;

grant select on public.active_sales to authenticated, anon, service_role;
