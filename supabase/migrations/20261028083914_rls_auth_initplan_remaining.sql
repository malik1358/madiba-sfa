-- Fix remaining advisor 0003_auth_rls_initplan warnings.
-- Wrap auth helpers so Postgres caches once per statement.
-- public.request_uid() is a SECURITY DEFINER stand-in for auth.uid() so
-- madiba_mig_owner can create policies without USAGE on schema auth
-- (production owns collection_visits / sales_orders as madiba_mig_owner).
-- Drop redundant daily_logs_select_own (covered by logs_select_own_or_admin).
--
-- Applied on production 2026-10-28 (MCP): postgres-owned tables directly;
-- mig-owned tables via temporary SET ROLE madiba_mig_owner after granting SET.

create or replace function public.request_uid()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select auth.uid();
$$;

revoke all on function public.request_uid() from public;
grant execute on function public.request_uid() to authenticated, anon, service_role;

-- collection_visits
drop policy if exists "collection_visits_insert_own" on public.collection_visits;
create policy "collection_visits_insert_own"
  on public.collection_visits
  for insert
  to authenticated
  with check (created_by = (select public.request_uid()));

drop policy if exists "collection_visits_select_own_or_management" on public.collection_visits;
create policy "collection_visits_select_own_or_management"
  on public.collection_visits
  for select
  to authenticated
  using (
    (created_by = (select public.request_uid()))
    or (select public.is_management())
  );

-- daily_activity_logs
drop policy if exists "daily_logs_insert_own" on public.daily_activity_logs;
create policy "daily_logs_insert_own"
  on public.daily_activity_logs
  for insert
  with check ((select public.request_uid()) = user_id);

drop policy if exists "daily_logs_select_own" on public.daily_activity_logs;

drop policy if exists "logs_select_own_or_admin" on public.daily_activity_logs;
create policy "logs_select_own_or_admin"
  on public.daily_activity_logs
  for select
  to authenticated
  using (
    (user_id = (select public.request_uid()))
    or (select public.is_admin())
  );

-- device_push_tokens
drop policy if exists "Users manage own push tokens" on public.device_push_tokens;
create policy "Users manage own push tokens"
  on public.device_push_tokens
  using ((select public.request_uid()) = user_id)
  with check ((select public.request_uid()) = user_id);

-- prospects
drop policy if exists "prospects_insert" on public.prospects;
create policy "prospects_insert"
  on public.prospects
  for insert
  to authenticated
  with check (
    (select public.is_management())
    or (created_by = (select public.request_uid()))
    or (
      public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code((select public.current_salesman_code()))
    )
    or public.is_subordinate_salesman_code(salesman_code)
  );

drop policy if exists "prospects_select" on public.prospects;
create policy "prospects_select"
  on public.prospects
  for select
  to authenticated
  using (
    (select public.is_management())
    or (created_by = (select public.request_uid()))
    or (
      public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code((select public.current_salesman_code()))
    )
    or public.is_subordinate_salesman_code(salesman_code)
  );

drop policy if exists "prospects_update" on public.prospects;
create policy "prospects_update"
  on public.prospects
  for update
  to authenticated
  using (
    (select public.is_management())
    or (created_by = (select public.request_uid()))
    or (
      public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code((select public.current_salesman_code()))
    )
    or public.is_subordinate_salesman_code(salesman_code)
  )
  with check (
    (select public.is_management())
    or (created_by = (select public.request_uid()))
    or (
      public.normalized_salesman_code(salesman_code)
      = public.normalized_salesman_code((select public.current_salesman_code()))
    )
    or public.is_subordinate_salesman_code(salesman_code)
  );

-- sales_orders
drop policy if exists "Authenticated users can create orders" on public.sales_orders;
create policy "Authenticated users can create orders"
  on public.sales_orders
  for insert
  to authenticated
  with check ((select public.request_uid()) = created_by);

drop policy if exists "Authenticated users can update orders" on public.sales_orders;
create policy "Authenticated users can update orders"
  on public.sales_orders
  for update
  to authenticated
  using (created_by = (select public.request_uid()))
  with check (created_by = (select public.request_uid()));

-- sales_order_items
drop policy if exists "Authenticated users can create order items" on public.sales_order_items;
create policy "Authenticated users can create order items"
  on public.sales_order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sales_orders
      where sales_orders.id = sales_order_items.order_id
        and sales_orders.created_by = (select public.request_uid())
    )
  );

drop policy if exists "Authenticated users can update order items" on public.sales_order_items;
create policy "Authenticated users can update order items"
  on public.sales_order_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.sales_orders
      where sales_orders.id = sales_order_items.order_id
        and sales_orders.created_by = (select public.request_uid())
    )
  );

drop policy if exists "Authenticated users can delete order items" on public.sales_order_items;
create policy "Authenticated users can delete order items"
  on public.sales_order_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.sales_orders
      where sales_orders.id = sales_order_items.order_id
        and sales_orders.created_by = (select public.request_uid())
    )
  );
