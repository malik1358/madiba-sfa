-- Run this once in Supabase SQL Editor before assigning the collector role.
-- It extends the profiles role constraint so collector users can be saved.

begin;

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (
  role is null
  or lower(role) in (
    'admin',
    'manager',
    'salesman',
    'invoice-maker',
    'invoice_maker',
    'product-promoter',
    'product_promoter',
    'collector'
  )
);

commit;
