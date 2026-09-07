ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activity_reminders_enabled boolean NOT NULL DEFAULT true;
