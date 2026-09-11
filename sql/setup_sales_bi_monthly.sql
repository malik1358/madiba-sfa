-- Optional monthly sales cube for Business Intelligence.
-- The app also stores a compact copy in system_settings (sales_bi_cube_v1)
-- and will keep working if this table is not created.

begin;

create table if not exists public.sales_bi_monthly (
  id bigserial primary key,
  month text not null,
  category text not null default '',
  salesman_code text not null default '',
  salesman_name text not null default '',
  customer_code text not null default '',
  customer_name text not null default '',
  item_code text not null default '',
  item_name text not null default '',
  voucher_type text not null default '',
  local_import text not null default '',
  abc_class text not null default '',
  sales_amount numeric not null default 0,
  quantity numeric not null default 0,
  line_count integer not null default 0
);

create index if not exists sales_bi_monthly_month_idx
  on public.sales_bi_monthly (month);

create index if not exists sales_bi_monthly_category_idx
  on public.sales_bi_monthly (category);

create index if not exists sales_bi_monthly_salesman_idx
  on public.sales_bi_monthly (salesman_code);

alter table public.sales_bi_monthly enable row level security;

commit;
