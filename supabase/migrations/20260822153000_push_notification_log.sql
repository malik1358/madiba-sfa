create table if not exists public.push_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_type text not null,
  title text,
  body text,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  sent_at timestamptz not null default now()
);

create index if not exists push_notification_log_user_type_sent_at_idx
  on public.push_notification_log (user_id, notification_type, sent_at desc);

alter table public.push_notification_log enable row level security;

drop policy if exists "Admins read push notification log" on public.push_notification_log;
create policy "Admins read push notification log"
  on public.push_notification_log
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );
