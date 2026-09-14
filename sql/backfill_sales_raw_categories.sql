-- Backfill blank sales_raw.category from items_master.
-- Real master categories win; remaining blanks become Unclassified.
-- After running, rebuild the sales BI cube (or delete sales_bi_cube_v1) so dashboards refresh.

begin;

update public.sales_raw s
set category = btrim(i.category)
from public.items_master i
where (s.category is null or btrim(s.category) = '')
  and i.item_code = s.item_code
  and nullif(btrim(i.category), '') is not null
  and upper(btrim(i.category)) <> 'UNCLASSIFIED';

update public.sales_raw
set category = 'Unclassified'
where category is null or btrim(category) = '';

commit;
