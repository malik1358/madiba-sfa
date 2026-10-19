-- Run this once in Supabase SQL Editor before creating product-promoter users.
-- It extends the profiles role constraint so the new role can be saved.

begin;

-- Normalize any legacy underscore role values.
update public.profiles
set role = 'product-promoter'
where lower(coalesce(role, '')) = 'product_promoter';

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (
  role is null
  or lower(role) in ('admin', 'manager', 'salesman', 'invoice-maker', 'invoice_maker', 'product-promoter', 'product_promoter')
);

commit;