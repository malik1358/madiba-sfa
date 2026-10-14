-- One-off / manual apply of migration 20261014120000_one_morning_attendance_per_ksa_day.sql
-- Run in production Supabase SQL editor before relying on the unique-index hard stop.

DELETE FROM public.daily_activity_logs AS duplicate
USING public.daily_activity_logs AS keeper
WHERE duplicate.entry_type = 'MORNING_ATTENDANCE'
  AND keeper.entry_type = 'MORNING_ATTENDANCE'
  AND duplicate.user_id = keeper.user_id
  AND (timezone('Asia/Riyadh', duplicate.created_at))::date
    = (timezone('Asia/Riyadh', keeper.created_at))::date
  AND (
    duplicate.created_at > keeper.created_at
    OR (duplicate.created_at = keeper.created_at AND duplicate.id > keeper.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS daily_activity_logs_one_morning_per_ksa_day
  ON public.daily_activity_logs (
    user_id,
    ((timezone('Asia/Riyadh', created_at))::date)
  )
  WHERE entry_type = 'MORNING_ATTENDANCE';
