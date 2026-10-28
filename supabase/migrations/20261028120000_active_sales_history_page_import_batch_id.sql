-- Outstanding Compare rebuild needs import_batch_id so mergeSalesSnapshots keeps
-- same-signature duplicate lines inside the active batch (1171C understated open
-- by 2,437.58 when the column was omitted and LEGACY keys were per row id).

drop function if exists public.active_sales_history_page(text, date, bigint, integer);

create function public.active_sales_history_page(
  after_customer text,
  after_date date,
  after_id bigint,
  page_limit integer
)
returns table (
  id bigint,
  import_batch_id bigint,
  transaction_date date,
  voucher_number text,
  voucher_type text,
  reference text,
  customer_code text,
  customer_name text,
  salesman_name text,
  category text,
  item_code text,
  item_name text,
  quantity numeric,
  sales_amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    s.import_batch_id,
    s.transaction_date,
    s.voucher_number,
    s.voucher_type,
    s.reference,
    s.customer_code,
    s.customer_name,
    s.salesman_name,
    s.category,
    s.item_code,
    s.item_name,
    s.quantity,
    s.sales_amount
  from public.active_sales s
  where (
      after_customer is null
      and after_id is null
    )
    or (
      after_customer is not null
      and (
        s.customer_code > after_customer
        or (s.customer_code = after_customer and s.transaction_date > after_date)
        or (s.customer_code = after_customer and s.transaction_date = after_date and s.id > after_id)
        or (s.customer_code = after_customer and after_date is not null and s.transaction_date is null)
        or (s.customer_code = after_customer and after_date is null and s.transaction_date is null and s.id > after_id)
        or s.customer_code is null
      )
    )
    or (
      after_customer is null
      and after_id is not null
      and s.customer_code is null
      and (
        (after_date is not null and s.transaction_date > after_date)
        or (after_date is not null and s.transaction_date = after_date and s.id > after_id)
        or (after_date is not null and s.transaction_date is null)
        or (after_date is null and s.transaction_date is null and s.id > after_id)
      )
    )
  order by s.customer_code, s.transaction_date, s.id
  limit least(greatest(coalesce(page_limit, 1000), 1), 2000);
$$;

comment on function public.active_sales_history_page(text, date, bigint, integer) is
  'Keyset page of active_sales for outstanding reconcile (includes import_batch_id). service_role only.';

revoke all on function public.active_sales_history_page(text, date, bigint, integer) from public, anon, authenticated;
grant execute on function public.active_sales_history_page(text, date, bigint, integer) to service_role;
