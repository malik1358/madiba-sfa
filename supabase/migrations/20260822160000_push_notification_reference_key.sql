alter table public.push_notification_log
  add column if not exists reference_key text;

create index if not exists push_notification_log_reference_key_idx
  on public.push_notification_log (reference_key)
  where reference_key is not null;
