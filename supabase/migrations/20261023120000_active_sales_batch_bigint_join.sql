-- active_sales was joining import_batch_id::text to system_settings.setting_value.
-- That cast blocked idx_sales_raw_batch and made every read of the view a sequential scan.
--
-- Checked on production before this change (read-only, 2026-10-23):
-- setting_value for active_sales_batch_id is exactly "10" (digits only).
-- Every sales_raw.import_batch_id is numeric. The text join and this bigint
-- predicate both return 17,518 rows. A non-numeric setting matches no rows,
-- which is the same as an empty snapshot, and it does not raise a cast error.
--
-- The view stays security-definer (owner) semantics. Do not set security_invoker.
-- No indexes are created or dropped.
--
-- The functions below are service-role only. App callers fall back to the
-- previous queries when a function is not deployed yet.

create or replace view public.active_sales as
select
  sr.id,
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
from public.sales_raw sr
where sr.import_batch_id = (
  select case
    when ss.setting_value ~ '^[0-9]+$' then ss.setting_value::bigint
    else null
  end
  from public.system_settings ss
  where ss.setting_key = 'active_sales_batch_id'
);

comment on view public.active_sales is
  'Live sales_raw batch. import_batch_id equals active_sales_batch_id only when that setting is all digits.';

-- One page of customer history in (customer_code, transaction_date, id) order.
-- The first call passes null cursors. Later calls pass the last row of the previous page.
-- Null customer codes and null dates sort last, matching ORDER BY ... ASC default nulls.
create or replace function public.active_sales_history_page(
  after_customer text,
  after_date date,
  after_id bigint,
  page_limit integer
)
returns table (
  id bigint,
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
  'Keyset page of active_sales for outstanding reconcile. service_role only.';

-- Six-month sales totals that follow mergeSalesSnapshots:
-- signature is date, voucher, reference, customer, item, quantity text, sales_amount text.
-- Rate is not part of the signature. The batch with the most rows wins; a tie keeps
-- the higher import_batch_id. Every row of that winning batch is kept.
-- Amounts below zero add nothing. Month totals include positive amounts only.
create or replace function public.recent_sales_customer_totals(
  customer_codes text[],
  from_date date,
  from_30_date date
)
returns table (
  customer_code text,
  recent_sales_value numeric,
  recent_30d_sales_value numeric,
  latest_transaction_date date,
  positive_sales_by_month jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      sr.id,
      sr.import_batch_id,
      sr.transaction_date,
      sr.customer_code,
      sr.sales_amount,
      (
        upper(trim(coalesce(sr.transaction_date::text, ''))) || '|' ||
        upper(trim(coalesce(sr.voucher_number, ''))) || '|' ||
        upper(trim(coalesce(sr.reference, ''))) || '|' ||
        upper(trim(coalesce(sr.customer_code, ''))) || '|' ||
        upper(trim(coalesce(sr.item_code, ''))) || '|' ||
        upper(trim(coalesce(sr.quantity::text, ''))) || '|' ||
        upper(trim(coalesce(sr.sales_amount::text, '')))
      ) as signature,
      case
        when sr.import_batch_id is null then 'LEGACY:' || sr.id::text
        else sr.import_batch_id::text
      end as batch_key
    from public.sales_raw sr
    where from_date is not null
      and sr.transaction_date >= from_date
      and cardinality(coalesce(customer_codes, array[]::text[])) > 0
      and sr.customer_code = any(customer_codes)
  ),
  batch_counts as (
    select signature, batch_key, count(*)::integer as batch_rows
    from scoped
    group by signature, batch_key
  ),
  winners as (
    select distinct on (signature)
      signature,
      batch_key
    from batch_counts
    order by
      signature,
      batch_rows desc,
      case
        when batch_key like 'LEGACY:%' then null
        else batch_key::bigint
      end desc nulls last
  ),
  kept as (
    select s.customer_code, s.transaction_date, s.sales_amount
    from scoped s
    join winners w
      on w.signature = s.signature
     and w.batch_key = s.batch_key
  ),
  positive as (
    select
      customer_code,
      transaction_date,
      greatest(coalesce(sales_amount, 0), 0) as amount
    from kept
  ),
  month_totals as (
    select
      customer_code,
      to_char(transaction_date, 'YYYY-MM') as month_key,
      sum(amount) as month_total
    from positive
    where amount > 0
      and transaction_date is not null
    group by customer_code, to_char(transaction_date, 'YYYY-MM')
  ),
  month_json as (
    select
      customer_code,
      jsonb_object_agg(month_key, month_total) as positive_sales_by_month
    from month_totals
    group by customer_code
  )
  select
    p.customer_code,
    coalesce(sum(p.amount), 0) as recent_sales_value,
    coalesce(sum(p.amount) filter (where p.transaction_date >= from_30_date), 0) as recent_30d_sales_value,
    max(p.transaction_date) as latest_transaction_date,
    coalesce(m.positive_sales_by_month, '{}'::jsonb) as positive_sales_by_month
  from positive p
  left join month_json m on m.customer_code = p.customer_code
  group by p.customer_code, m.positive_sales_by_month;
$$;

comment on function public.recent_sales_customer_totals(text[], date, date) is
  'Per customer_code six-month totals after sales snapshot merge. service_role only.';

-- Distinct salesman code/name pairs on the live batch. Callers match the old
-- %pattern% rule in application code and then filter by the stored salesman_code.
-- On the live batch each salesman_code has one salesman_name, so filtering by
-- those codes matches the old salesman_code OR salesman_name ILIKE.
create or replace function public.active_salesman_pairs()
returns table (
  salesman_code text,
  salesman_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct s.salesman_code, s.salesman_name
  from public.active_sales s
  where coalesce(s.salesman_code, '') <> ''
     or coalesce(s.salesman_name, '') <> '';
$$;

comment on function public.active_salesman_pairs() is
  'Distinct salesman code and name pairs on the live sales batch. service_role only.';

revoke all on function public.active_sales_history_page(text, date, bigint, integer) from public;
revoke all on function public.recent_sales_customer_totals(text[], date, date) from public;
revoke all on function public.active_salesman_pairs() from public;

revoke execute on function public.active_sales_history_page(text, date, bigint, integer) from anon, authenticated;
revoke execute on function public.recent_sales_customer_totals(text[], date, date) from anon, authenticated;
revoke execute on function public.active_salesman_pairs() from anon, authenticated;

grant execute on function public.active_sales_history_page(text, date, bigint, integer) to service_role;
grant execute on function public.recent_sales_customer_totals(text[], date, date) to service_role;
grant execute on function public.active_salesman_pairs() to service_role;
