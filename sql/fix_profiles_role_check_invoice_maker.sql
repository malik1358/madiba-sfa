-- Run this once in Supabase SQL Editor when creating invoice-maker users fails with:
-- new row for relation "profiles" violates check constraint "profiles_role_check"

begin;

-- Normalize any legacy underscore role values.
update public.profiles
set role = 'invoice-maker'
where lower(coalesce(role, '')) = 'invoice_maker';

-- Recreate role constraint to include invoice-maker.
alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (
  role is null
  or lower(role) in ('admin', 'manager', 'salesman', 'invoice-maker', 'invoice_maker')
);

commit;
