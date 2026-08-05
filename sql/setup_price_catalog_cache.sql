-- Run once in Supabase SQL Editor.
-- Creates tables for scheduled price dump snapshots and cached reads.

begin;

create table if not exists public.price_catalog_cache (
  cache_key text primary key,
  price_map jsonb not null default '{}'::jsonb,
  sheet_items jsonb not null default '[]'::jsonb,
  source_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.price_catalog_snapshots (
  id bigserial primary key,
  source_url text not null,
  payload jsonb not null,
  price_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_catalog_snapshots_created_at
  on public.price_catalog_snapshots (created_at desc);

commit;
