ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS report_email text;
