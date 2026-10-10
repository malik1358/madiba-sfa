-- Run this once in Supabase SQL Editor before assigning the report-user role
-- if the migration has not been applied yet.
-- Extends profiles_role_check and treats report-user as admin/management for RLS.

begin;

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (
  role is null
  or lower(role) in (
    'admin',
    'report-user',
    'report_user',
    'manager',
    'salesman',
    'invoice-maker',
    'invoice_maker',
    'product-promoter',
    'product_promoter',
    'collector'
  )
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(coalesce(role, '')) in ('admin', 'report-user', 'report_user')
  );
$$;

create or replace function public.is_management()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.current_user_role() in ('admin', 'report-user', 'report_user', 'manager'),
    false
  );
$$;

do $$
begin
  if to_regclass('public.device_push_tokens') is not null then
    drop policy if exists "Admins read push tokens" on public.device_push_tokens;
    create policy "Admins read push tokens"
      on public.device_push_tokens
      for select
      using (public.is_management());
  end if;

  if to_regclass('public.push_notification_log') is not null then
    drop policy if exists "Admins read push notification log" on public.push_notification_log;
    create policy "Admins read push notification log"
      on public.push_notification_log
      for select
      using (public.is_management());
  end if;

  if to_regclass('public.inactivity_email_cycle_log') is not null then
    drop policy if exists "Admins read inactivity email cycle log" on public.inactivity_email_cycle_log;
    create policy "Admins read inactivity email cycle log"
      on public.inactivity_email_cycle_log
      for select
      using (public.is_management());
  end if;
end $$;

commit;
