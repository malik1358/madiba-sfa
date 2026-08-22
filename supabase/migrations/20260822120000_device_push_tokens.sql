create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists "Users manage own push tokens" on public.device_push_tokens;
create policy "Users manage own push tokens"
  on public.device_push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins read push tokens" on public.device_push_tokens;
create policy "Admins read push tokens"
  on public.device_push_tokens
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );
