create table if not exists public.inactivity_email_cycle_log (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  report_date date not null,
  checked integer not null default 0,
  sent integer not null default 0,
  login_reminders_sent integer not null default 0,
  skipped boolean not null default false,
  skip_reason text,
  details jsonb not null default '[]'::jsonb
);

create index if not exists inactivity_email_cycle_log_date_ran_at_idx
  on public.inactivity_email_cycle_log (report_date, ran_at desc);

alter table public.inactivity_email_cycle_log enable row level security;

drop policy if exists "Admins read inactivity email cycle log" on public.inactivity_email_cycle_log;
create policy "Admins read inactivity email cycle log"
  on public.inactivity_email_cycle_log
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );
