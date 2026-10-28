-- Speed up profiles RLS (and helpers used by many policies).
-- Wrap auth.uid() / is_management() in (select ...) so Postgres caches once per
-- statement instead of re-evaluating per row (advisor 0003_auth_rls_initplan).
-- Drop redundant profiles_select_own_or_admin (subset of profiles_select).
-- Keep profiles_select to "own row only"; management ALL is covered by
-- profiles_management_all so SELECT does not evaluate is_management twice.

begin;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
  limit 1;
$$;

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
    where id = (select auth.uid())
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

drop policy if exists "profiles_select_own_or_admin" on public.profiles;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_management_all" on public.profiles;
create policy "profiles_management_all"
  on public.profiles
  to authenticated
  using ((select public.is_management()))
  with check ((select public.is_management()));

commit;
