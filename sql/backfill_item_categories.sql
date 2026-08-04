-- Run this once in Supabase SQL Editor to backfill item names/categories
-- for existing rows after the import mapping fix.

begin;

-- 1) Improve items_master from historical sales_raw where good values exist.
with ranked as (
  select distinct on (item_code)
    item_code,
    nullif(trim(regexp_replace(coalesce(item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '') as item_name,
    nullif(trim(category), '') as category,
    transaction_date,
    id
  from public.sales_raw
  where item_code is not null
  order by item_code, transaction_date desc nulls last, id desc
)
update public.items_master im
set
  item_name = coalesce(
    nullif(trim(regexp_replace(coalesce(im.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), ''),
    ranked.item_name,
    im.item_code
  ),
  category = coalesce(
    nullif(im.category, ''),
    ranked.category,
    'Unclassified'
  )
from ranked
where im.item_code = ranked.item_code
  and (
    im.item_name is null or trim(im.item_name) = '' or
    im.category is null or trim(im.category) = '' or upper(trim(im.category)) = 'UNCLASSIFIED' or
    coalesce(im.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

-- 2) Backfill sales_raw rows from items_master where category/name is missing.
update public.sales_raw sr
set
  item_name = coalesce(
    nullif(trim(regexp_replace(coalesce(sr.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), ''),
    im.item_name,
    sr.item_code
  ),
  category = coalesce(nullif(trim(sr.category), ''), im.category, 'Unclassified')
from public.items_master im
where sr.item_code = im.item_code
  and (
    sr.item_name is null or trim(sr.item_name) = '' or
    sr.category is null or trim(sr.category) = '' or upper(trim(sr.category)) = 'UNCLASSIFIED' or
    coalesce(sr.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

commit;
