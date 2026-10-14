-- One MORNING_ATTENDANCE (Day-route "Login") punch per user per Asia/Riyadh calendar day.
-- Keep the earliest row when duplicates already exist, then enforce with a unique index.

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
