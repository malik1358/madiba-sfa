-- Run this once in Supabase SQL Editor to backfill item names/categories
-- for existing rows after the import mapping fix.

begin;

-- 1) Improve items_master from historical sales_raw where good values exist.
with ranked as (
  select distinct on (base.item_code)
    base.item_code,
    case
      when base.cleaned_item_name is null then null
      when upper(base.cleaned_item_name) = upper(trim(base.item_code)) then null
      else base.cleaned_item_name
    end as item_name,
    case
      when upper(trim(coalesce(base.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(base.category), '')
    end as category,
    base.transaction_date,
    base.id
  from (
  select
    item_code,
    nullif(trim(regexp_replace(coalesce(item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '') as cleaned_item_name,
    category,
    transaction_date,
    id
  from public.sales_raw
  where item_code is not null
  ) base
  order by
    base.item_code,
    case
      when base.cleaned_item_name is not null and upper(base.cleaned_item_name) <> upper(trim(base.item_code)) then 0
      else 1
    end,
    case
      when nullif(trim(base.category), '') is not null and upper(trim(base.category)) <> 'UNCLASSIFIED' then 0
      else 1
    end,
    base.transaction_date desc nulls last,
    base.id desc
)
update public.items_master im
set
  item_name = coalesce(
    case
      when nullif(trim(regexp_replace(coalesce(im.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '') is null then null
      when upper(trim(regexp_replace(coalesce(im.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi'))) = upper(trim(im.item_code)) then null
      else nullif(trim(regexp_replace(coalesce(im.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '')
    end,
    ranked.item_name,
    im.item_code
  ),
  category = coalesce(
    case
      when upper(trim(coalesce(im.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(im.category), '')
    end,
    ranked.category,
    'Unclassified'
  )
from ranked
where im.item_code = ranked.item_code
  and (
    im.item_name is null or trim(im.item_name) = '' or
    upper(trim(coalesce(im.item_name, ''))) = upper(trim(im.item_code)) or
    im.category is null or trim(im.category) = '' or upper(trim(im.category)) = 'UNCLASSIFIED' or
    coalesce(im.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

-- 2) Backfill sales_raw rows from items_master where category/name is missing.
update public.sales_raw sr
set
  item_name = coalesce(
    case
      when nullif(trim(regexp_replace(coalesce(sr.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '') is null then null
      when upper(trim(regexp_replace(coalesce(sr.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi'))) = upper(trim(sr.item_code)) then null
      else nullif(trim(regexp_replace(coalesce(sr.item_name, ''), '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M', '', 'gi')), '')
    end,
    im.item_name,
    sr.item_code
  ),
  category = coalesce(
    case
      when upper(trim(coalesce(sr.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(sr.category), '')
    end,
    case
      when upper(trim(coalesce(im.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(im.category), '')
    end,
    'Unclassified'
  )
from public.items_master im
where sr.item_code = im.item_code
  and (
    sr.item_name is null or trim(sr.item_name) = '' or
    upper(trim(coalesce(sr.item_name, ''))) = upper(trim(sr.item_code)) or
    sr.category is null or trim(sr.category) = '' or upper(trim(sr.category)) = 'UNCLASSIFIED' or
    coalesce(sr.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

commit;
