-- Run this once in the Supabase SQL editor to backfill item names and
-- categories for existing rows after the import mapping fix.

begin;

-- 1) Create missing items_master rows from historical sales_raw where values exist.
with ranked as (
  select distinct on (base.item_code)
    base.item_code,
    case
      when base.cleaned_item_name is null then null
      when base.cleaned_item_name ~* 'do\s*not\s*use+' then null
      when upper(base.cleaned_item_name) = upper(trim(base.item_code)) then null
      else base.cleaned_item_name
    end as item_name,
    case
      when upper(trim(coalesce(base.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(base.category), '')
    end as category
  from (
    select
      item_code,
      nullif(
        trim(
          regexp_replace(
            coalesce(item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      ) as cleaned_item_name,
      category
    from public.sales_raw
    where item_code is not null
      and trim(item_code) <> ''
  ) base
  order by
    base.item_code,
    case
      when base.cleaned_item_name is not null
        and upper(base.cleaned_item_name) <> upper(trim(base.item_code)) then 0
      else 1
    end,
    case
      when nullif(trim(base.category), '') is not null
        and upper(trim(base.category)) <> 'UNCLASSIFIED' then 0
      else 1
    end
)
insert into public.items_master (item_code, item_name, category)
select
  ranked.item_code,
  ranked.item_name,
  coalesce(ranked.category, 'Unclassified')
from ranked
left join public.items_master im
  on im.item_code = ranked.item_code
where im.item_code is null
  and ranked.item_code is not null
  and trim(ranked.item_code) <> ''
on conflict (item_code) do nothing;

-- 2) Improve existing items_master rows from historical sales_raw where good values exist.
with ranked as (
  select distinct on (base.item_code)
    base.item_code,
    case
      when base.cleaned_item_name is null then null
      when base.cleaned_item_name ~* 'do\s*not\s*use+' then null
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
      nullif(
        trim(
          regexp_replace(
            coalesce(item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      ) as cleaned_item_name,
      category,
      transaction_date,
      id
    from public.sales_raw
    where item_code is not null
      and trim(item_code) <> ''
  ) base
  order by
    base.item_code,
    case
      when base.cleaned_item_name is not null
        and upper(base.cleaned_item_name) <> upper(trim(base.item_code)) then 0
      else 1
    end,
    case
      when nullif(trim(base.category), '') is not null
        and upper(trim(base.category)) <> 'UNCLASSIFIED' then 0
      else 1
    end,
    base.transaction_date desc nulls last,
    base.id desc
)
update public.items_master im
set
  item_name = coalesce(
    case
      when nullif(
        trim(
          regexp_replace(
            coalesce(im.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      ) is null then null
      when upper(
        trim(
          regexp_replace(
            coalesce(im.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        )
      ) = upper(trim(im.item_code)) then null
      when trim(
        regexp_replace(
          coalesce(im.item_name, ''),
          '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
          '',
          'gi'
        )
      ) ~* 'do\\s*not\\s*use+' then null
      else nullif(
        trim(
          regexp_replace(
            coalesce(im.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      )
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
    im.item_name is null
    or trim(im.item_name) = ''
    or upper(trim(coalesce(im.item_name, ''))) = upper(trim(im.item_code))
    or im.category is null
    or trim(im.category) = ''
    or upper(trim(im.category)) = 'UNCLASSIFIED'
    or coalesce(im.item_name, '') ~* 'do\s*not\s*use+'
    or coalesce(im.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

-- 3) Backfill sales_raw rows from items_master where category/name is missing.
update public.sales_raw sr
set
  item_name = coalesce(
    case
      when nullif(
        trim(
          regexp_replace(
            coalesce(sr.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      ) is null then null
      when upper(
        trim(
          regexp_replace(
            coalesce(sr.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        )
      ) = upper(trim(sr.item_code)) then null
      when trim(
        regexp_replace(
          coalesce(sr.item_name, ''),
          '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
          '',
          'gi'
        )
      ) ~* 'do\\s*not\\s*use+' then null
      else nullif(
        trim(
          regexp_replace(
            coalesce(sr.item_name, ''),
            '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M',
            '',
            'gi'
          )
        ),
        ''
      )
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
    sr.item_name is null
    or trim(sr.item_name) = ''
    or upper(trim(coalesce(sr.item_name, ''))) = upper(trim(sr.item_code))
    or sr.category is null
    or trim(sr.category) = ''
    or upper(trim(sr.category)) = 'UNCLASSIFIED'
    or coalesce(sr.item_name, '') ~* 'do\s*not\s*use+'
    or coalesce(sr.item_name, '') ~* '\\m(?:(?:[A-Za-z]\\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\\s*)new)\\M'
  );

-- 4) Backfill from the cached price sheet rows so valid catalog items keep
-- their sheet category even when sales history is missing or stale.
with cache_items as (
  select
    upper(trim(item ->> 'item_code')) as item_code,
    nullif(trim(item ->> 'item_name'), '') as item_name,
    nullif(trim(item ->> 'category'), '') as category
  from public.price_catalog_cache pcc
  cross join lateral jsonb_array_elements(coalesce(pcc.sheet_items, '[]'::jsonb)) as item
  where pcc.cache_key = 'default'
), ranked_cache as (
  select distinct on (item_code)
    item_code,
    case
      when item_name is null then null
      when item_name ~* 'do\s*not\s*use+' then null
      when upper(item_name) = upper(item_code) then null
      else item_name
    end as item_name,
    case
      when upper(trim(coalesce(category, ''))) = 'UNCLASSIFIED' then null
      else category
    end as category
  from cache_items
  where item_code is not null
    and trim(item_code) <> ''
  order by
    item_code,
    case when category is not null and upper(trim(category)) <> 'UNCLASSIFIED' then 0 else 1 end,
    case when item_name is not null and upper(item_name) <> upper(item_code) then 0 else 1 end
)
update public.items_master im
set
  item_name = coalesce(
    case
      when nullif(trim(im.item_name), '') is null then null
      when trim(im.item_name) ~* 'do\s*not\s*use+' then null
      when upper(trim(im.item_name)) = upper(trim(im.item_code)) then null
      else nullif(trim(im.item_name), '')
    end,
    ranked_cache.item_name,
    im.item_code
  ),
  category = coalesce(
    case
      when upper(trim(coalesce(im.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(im.category), '')
    end,
    ranked_cache.category,
    'Unclassified'
  )
from ranked_cache
where im.item_code = ranked_cache.item_code
  and (
    im.item_name is null
    or trim(im.item_name) = ''
    or coalesce(im.item_name, '') ~* 'do\s*not\s*use+'
    or upper(trim(coalesce(im.item_name, ''))) = upper(trim(im.item_code))
    or im.category is null
    or trim(im.category) = ''
    or upper(trim(im.category)) = 'UNCLASSIFIED'
  );

with cache_items as (
  select
    upper(trim(item ->> 'item_code')) as item_code,
    nullif(trim(item ->> 'item_name'), '') as item_name,
    nullif(trim(item ->> 'category'), '') as category
  from public.price_catalog_cache pcc
  cross join lateral jsonb_array_elements(coalesce(pcc.sheet_items, '[]'::jsonb)) as item
  where pcc.cache_key = 'default'
), ranked_cache as (
  select distinct on (item_code)
    item_code,
    case
      when item_name is null then null
      when item_name ~* 'do\s*not\s*use+' then null
      when upper(item_name) = upper(item_code) then null
      else item_name
    end as item_name,
    case
      when upper(trim(coalesce(category, ''))) = 'UNCLASSIFIED' then null
      else category
    end as category
  from cache_items
  where item_code is not null
    and trim(item_code) <> ''
  order by
    item_code,
    case when category is not null and upper(trim(category)) <> 'UNCLASSIFIED' then 0 else 1 end,
    case when item_name is not null and upper(item_name) <> upper(item_code) then 0 else 1 end
)
update public.sales_raw sr
set
  item_name = coalesce(
    case
      when nullif(trim(sr.item_name), '') is null then null
      when trim(sr.item_name) ~* 'do\s*not\s*use+' then null
      when upper(trim(sr.item_name)) = upper(trim(sr.item_code)) then null
      else nullif(trim(sr.item_name), '')
    end,
    ranked_cache.item_name,
    sr.item_code
  ),
  category = coalesce(
    case
      when upper(trim(coalesce(sr.category, ''))) = 'UNCLASSIFIED' then null
      else nullif(trim(sr.category), '')
    end,
    ranked_cache.category,
    'Unclassified'
  )
from ranked_cache
where sr.item_code = ranked_cache.item_code
  and (
    sr.item_name is null
    or trim(sr.item_name) = ''
    or coalesce(sr.item_name, '') ~* 'do\s*not\s*use+'
    or upper(trim(coalesce(sr.item_name, ''))) = upper(trim(sr.item_code))
    or sr.category is null
    or trim(sr.category) = ''
    or upper(trim(sr.category)) = 'UNCLASSIFIED'
  );

commit;
