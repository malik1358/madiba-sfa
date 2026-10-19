-- Run this in Supabase SQL Editor before handing the app to salesmen.
-- It removes order and visit test data while keeping master data like customers and items.

begin;

-- Remove order line items first, then orders.
delete from public.sales_order_items
where order_id in (select id from public.sales_orders);

delete from public.sales_orders;

-- Clear attendance / GPS / visit-report logs.
delete from public.daily_activity_logs
where entry_type in (
  'MORNING_ATTENDANCE',
  'GPS_PING',
  'VISIT_REPORT',
  'NOTE',
  'LUNCH_BREAK_OUT',
  'LUNCH_BREAK_IN',
  'END_OF_DAY'
);

-- Remove backup visit-report storage created when daily_activity_logs is unavailable.
delete from public.system_settings
where setting_key like 'visit_report_latest:%'
   or setting_key like 'visit_report_history:%';

commit;
