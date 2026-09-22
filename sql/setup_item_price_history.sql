-- Item catalog price history (one row per price change per region).
-- Run in Supabase SQL Editor (local/dev and production).

begin;

create table if not exists public.item_price_history (
  id bigserial primary key,
  item_code text not null,
  region text not null default 'riyadh',
  price numeric(18,4) not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'price_sync'
);

create index if not exists idx_item_price_history_item_recorded
  on public.item_price_history (item_code, region, recorded_at desc);

create index if not exists idx_item_price_history_recorded
  on public.item_price_history (recorded_at desc);

alter table public.item_price_history enable row level security;

drop policy if exists "item_price_history_select" on public.item_price_history;
create policy "item_price_history_select" on public.item_price_history
  for select to authenticated
  using (true);

-- Optional: keep a compact price_map on snapshots for faster historic lookups.
alter table public.price_catalog_snapshots
  add column if not exists price_map jsonb;

commit;
